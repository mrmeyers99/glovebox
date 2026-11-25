import { assertEquals, assertThrows } from '@std/assert'
import { HttpError } from '../_shared/http.ts'
import { legFilter } from './cache.ts'
import {
  chainCoordinates,
  chainLegs,
  decodePolyline,
  encodePolyline,
  type Leg,
  legError,
  legKey,
  type LegResult,
  parseRouteRequest,
  roundCoord,
  shapeResults,
  splitDirections,
  uniqueLegs,
} from './legs.ts'

const p = (lat: number, lng: number) => ({ lat, lng })
const leg = (from: [number, number], to: [number, number]): Leg => ({
  from: p(...from),
  to: p(...to),
})

Deno.test('roundCoord rounds to 5 decimals like tripMath', () => {
  assertEquals(roundCoord(38.573312), 38.57331)
  assertEquals(roundCoord(38.573315), 38.57332)
  assertEquals(roundCoord(-109.549849), -109.54985)
  assertEquals(roundCoord(40), 40)
})

Deno.test('parseRouteRequest rounds coordinates', () => {
  assertEquals(
    parseRouteRequest({
      pairs: [{ from: p(38.5733123, -109.5498456), to: p(39.1, -108.2) }],
    }),
    [leg([38.57331, -109.54985], [39.1, -108.2])],
  )
  assertEquals(parseRouteRequest({ pairs: [] }), [])
})

Deno.test('parseRouteRequest rejects bad input', () => {
  const ok = { from: p(1, 2), to: p(3, 4) }
  for (const body of [
    null,
    [],
    {},
    { pairs: 'x' },
    { pairs: [null] },
    { pairs: [{ from: p(1, 2) }] },
    { pairs: [{ from: p(91, 0), to: p(0, 0) }] },
    { pairs: [{ from: p(0, 0), to: p(0, -181) }] },
    { pairs: [{ from: { lat: '1', lng: 2 }, to: p(0, 0) }] },
    { pairs: [{ from: p(NaN, 0), to: p(0, 0) }] },
    { pairs: Array(51).fill(ok) },
  ]) {
    assertThrows(() => parseRouteRequest(body), HttpError, undefined)
  }
  assertEquals(parseRouteRequest({ pairs: Array(50).fill(ok) }).length, 50)
})

Deno.test('uniqueLegs drops repeats, keeping first-seen order', () => {
  const a = leg([1, 2], [3, 4])
  const b = leg([3, 4], [1, 2])
  assertEquals(uniqueLegs([a, b, { ...a }, b]), [a, b])
})

Deno.test('chainLegs joins connected legs into one request', () => {
  const ab = leg([40, -75], [40.1, -75.1])
  const bc = leg([40.1, -75.1], [40.2, -75.2])
  const cd = leg([40.2, -75.2], [40.3, -75.3])
  const xy = leg([35, -110], [35.1, -110.1])
  const yz = leg([35.1, -110.1], [35.2, -110.2])
  assertEquals(chainLegs([ab, bc, cd, xy, yz]), [
    [ab, bc, cd],
    [xy, yz],
  ])
  // Not connected: separate requests.
  assertEquals(chainLegs([ab, cd]), [[ab], [cd]])
  assertEquals(chainLegs([]), [])
  assertEquals(chainCoordinates([ab, bc]), [
    [-75, 40],
    [-75.1, 40.1],
    [-75.2, 40.2],
  ])
})

Deno.test('chainLegs caps waypoints per request', () => {
  const legs = Array.from({ length: 50 }, (_, i) =>
    leg([40, -75 + i * 0.01], [40, -75 + (i + 1) * 0.01]),
  )
  const chains = chainLegs(legs)
  assertEquals(
    chains.map((c) => c.length),
    [49, 1],
  )
  assertEquals(chainCoordinates(chains[0]).length, 50)
})

Deno.test('chainLegs caps the straight-line length of a request', () => {
  // ~1,100 km per leg along the equator.
  const legs = [0, 10, 20, 30, 40].map((lng) => leg([0, lng], [0, lng + 10]))
  assertEquals(
    chainLegs(legs, { maxStraightLineM: 2_500_000 }).map((c) => c.length),
    [2, 2, 1],
  )
})

Deno.test('encodePolyline matches the Google reference example', () => {
  const points: [number, number][] = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]
  const encoded = encodePolyline(points)
  assertEquals(encoded, '_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  assertEquals(decodePolyline(encoded), points)
  assertEquals(encodePolyline([]), '')
})

function orsResponse(
  coordinates: [number, number][],
  wayPoints: number[],
  segments: unknown[],
) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: { segments, way_points: wayPoints },
      },
    ],
  }
}

Deno.test('splitDirections gives each leg its own line and totals', () => {
  const coords: [number, number][] = [
    [-75, 40],
    [-75.05, 40.05],
    [-75.1, 40.1],
    [-75.2, 40.2],
  ]
  const routes = splitDirections(
    orsResponse(
      coords,
      [0, 2, 3],
      [
        { distance: 15000.5, duration: 900.1 },
        { distance: 14000, duration: 800 },
      ],
    ),
    2,
  )
  assertEquals(routes.length, 2)
  assertEquals(routes[0].distance_m, 15000.5)
  assertEquals(routes[0].duration_s, 900.1)
  assertEquals(decodePolyline(routes[0].geometry), [
    [40, -75],
    [40.05, -75.05],
    [40.1, -75.1],
  ])
  assertEquals(decodePolyline(routes[1].geometry), [
    [40.1, -75.1],
    [40.2, -75.2],
  ])
})

Deno.test('splitDirections treats a segment without totals as zero', () => {
  const routes = splitDirections(orsResponse([[-75, 40]], [0, 0], [{}]), 1)
  assertEquals(routes[0].distance_m, 0)
  assertEquals(routes[0].duration_s, 0)
})

Deno.test('splitDirections rejects responses that do not match', () => {
  const coords: [number, number][] = [
    [-75, 40],
    [-75.1, 40.1],
  ]
  const seg = { distance: 1, duration: 1 }
  for (const response of [
    null,
    {},
    { features: [] },
    { features: [{ geometry: {}, properties: {} }] },
    orsResponse(coords, [0, 1], [seg, seg]),
    orsResponse(coords, [0], [seg]),
    orsResponse(coords, [0, 5], [seg]),
    orsResponse(coords, [0, 1], [{ distance: -1, duration: 1 }]),
    orsResponse(
      [
        [-75, 40],
        ['x' as unknown as number, 1],
      ],
      [0, 1],
      [seg],
    ),
  ]) {
    assertThrows(() => splitDirections(response, 1))
  }
})

Deno.test('shapeResults keeps input order and repeats duplicates', () => {
  const a = leg([1, 2], [3, 4])
  const b = leg([3, 4], [5, 6])
  const ok = { distance_m: 1, duration_s: 2, geometry: 'x', cached: true }
  const byKey = new Map<string, LegResult>([
    [legKey(a), ok],
    [legKey(b), legError('no_route')],
  ])
  assertEquals(shapeResults([b, a, a], byKey), [legError('no_route'), ok, ok])
  assertEquals(shapeResults([leg([9, 9], [8, 8])], byKey), [
    legError('unavailable'),
  ])
})

Deno.test('legFilter matches the full primary key', () => {
  assertEquals(
    legFilter(leg([38.5, -109.54985], [39, -108])),
    'and(from_lat.eq.38.5,from_lng.eq.-109.54985,to_lat.eq.39,to_lng.eq.-108)',
  )
})
