import { describe, expect, it } from 'vitest'
import {
  CORRIDOR_RADIUS_KM,
  SAMPLE_STEP_KM,
  corridorTiles,
  distanceFromRoute,
  haversineKm,
  legLines,
  sampleLine,
  tileKey,
  tilesNear,
  type LatLng,
} from './corridor'
import type { Leg, StopInput } from './tripMath'

const sorted = (keys: Set<string>) => [...keys].sort()

/** A straight line from a to b with n evenly spaced vertices. */
function line(a: LatLng, b: LatLng, n: number): LatLng[] {
  return Array.from({ length: n }, (_, i): LatLng => {
    const t = i / (n - 1)
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  })
}

describe('tileKey', () => {
  it('keys a tile by its south-west corner, like place_tile_key()', () => {
    expect(tileKey(42.7, -96.2)).toBe('42.5_-96.5')
    expect(tileKey(42.2, -97.0)).toBe('42.0_-97.0')
    expect(tileKey(-33.9, 151.2)).toBe('-34.0_151.0')
  })

  it('puts a point on a grid line in the tile to its north / east', () => {
    expect(tileKey(42.5, -96.5)).toBe('42.5_-96.5')
    expect(tileKey(42.4999, -96.5001)).toBe('42.0_-97.0')
  })

  it('never writes negative zero', () => {
    expect(tileKey(0.2, 0.3)).toBe('0.0_0.0')
    expect(tileKey(-0, -0)).toBe('0.0_0.0')
    expect(tileKey(-0.2, -0.3)).toBe('-0.5_-0.5')
  })
})

describe('haversineKm', () => {
  it('measures a degree of latitude as about 111 km', () => {
    expect(haversineKm([42, -96], [43, -96])).toBeCloseTo(111.2, 1)
  })

  it('is zero for the same point', () => {
    expect(haversineKm([42, -96], [42, -96])).toBe(0)
  })
})

describe('tilesNear', () => {
  it('is just the containing tile for a point in the middle of it', () => {
    expect(sorted(tilesNear([42.25, -96.25], 5))).toEqual(['42.0_-96.5'])
  })

  it('includes neighbours the radius reaches, but not far corners', () => {
    // About 2 km south-west of the corner shared by four tiles.
    const point: LatLng = [42.49, -96.52]
    expect(sorted(tilesNear(point, 1))).toEqual(['42.0_-97.0'])
    expect(sorted(tilesNear(point, 3))).toEqual([
      '42.0_-96.5',
      '42.0_-97.0',
      '42.5_-96.5',
      '42.5_-97.0',
    ])
  })

  it('reaches as far as the radius in every direction', () => {
    const point: LatLng = [42.25, -96.25]
    const keys = tilesNear(point, CORRIDOR_RADIUS_KM)
    // 40 km is about 0.36° of latitude and 0.49° of longitude here.
    expect(keys.has('41.5_-96.5')).toBe(true)
    expect(keys.has('42.5_-96.5')).toBe(true)
    expect(keys.has('42.0_-97.0')).toBe(true)
    expect(keys.has('42.0_-96.0')).toBe(true)
    expect(keys.has('42.5_-97.0')).toBe(true)
    expect(keys.has('41.0_-96.5')).toBe(false)
    expect(keys.has('42.0_-97.5')).toBe(false)
    expect(keys.size).toBe(9)
  })

  it('wraps across the antimeridian', () => {
    const keys = tilesNear([52.25, 179.9], 20)
    expect(keys.has('52.0_179.5')).toBe(true)
    expect(keys.has('52.0_-180.0')).toBe(true)
  })

  it('stays within the poles', () => {
    const keys = tilesNear([89.9, 0], 50)
    expect(keys.has('89.5_0.0')).toBe(true)
    expect([...keys].every((k) => Number(k.split('_')[0]) <= 89.5)).toBe(true)
  })
})

describe('sampleLine', () => {
  it('returns nothing for an empty line and the point for a single one', () => {
    expect(sampleLine([])).toEqual([])
    expect(sampleLine([[42, -96]])).toEqual([[42, -96]])
  })

  it('spaces samples evenly along the line, keeping both ends', () => {
    // About 111 km, with a vertex every ~1 km.
    const route = line([42, -96], [43, -96], 112)
    const samples = sampleLine(route, 10)
    expect(samples[0]).toEqual([42, -96])
    expect(samples[samples.length - 1]).toEqual([43, -96])
    expect(samples).toHaveLength(13)
    for (let i = 1; i < samples.length - 1; i++) {
      expect(haversineKm(samples[i - 1], samples[i])).toBeCloseTo(10, 5)
    }
  })

  it('carries spacing across vertices and skips zero-length segments', () => {
    const samples = sampleLine(
      [
        [42, -96],
        [42, -96],
        [42.03, -96],
        [42.06, -96],
      ],
      5,
    )
    // ~6.7 km: one sample at 5 km, inside the second segment, then the end.
    expect(samples).toHaveLength(3)
    expect(haversineKm([42, -96], samples[1])).toBeCloseTo(5, 5)
  })
})

describe('corridorTiles', () => {
  it('is empty without route lines', () => {
    expect(corridorTiles([])).toEqual(new Set())
    expect(corridorTiles([[]])).toEqual(new Set())
  })

  it('covers every tile a route crosses, diagonally across boundaries', () => {
    // Des Moines to Minneapolis, roughly: about 3° north, 2° east.
    const route = line([41.6, -93.6], [44.95, -93.27], 50)
    const keys = corridorTiles([route], 0)
    for (const point of line(route[0], route[route.length - 1], 1000)) {
      expect(keys.has(tileKey(...point))).toBe(true)
    }
    // With no radius, only tiles within half a sample step of the line.
    expect(keys.has('41.5_-94.0')).toBe(true)
    expect(keys.has('44.5_-93.5')).toBe(true)
    expect(keys.has('43.0_-95.0')).toBe(false)
  })

  it('includes tiles on both sides of a route along a grid line', () => {
    // Along latitude 42.0 from -96.9 to -96.1: on the boundary between rows.
    const route = line([42, -96.9], [42, -96.1], 20)
    expect(sorted(corridorTiles([route], 1))).toEqual([
      '41.5_-96.5',
      '41.5_-97.0',
      '42.0_-96.5',
      '42.0_-97.0',
    ])
  })

  it('includes every place within the radius of the route', () => {
    const route = line([41.6, -93.6], [44.95, -93.27], 50)
    const keys = corridorTiles([route])
    // Points either side of the route at just under 40 km.
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      const lat = 41.6 + 3.35 * t
      const lng = -93.6 + 0.33 * t
      for (const side of [-1, 1]) {
        const offset = (side * 39.9) / (111.2 * Math.cos((lat * Math.PI) / 180))
        const place: LatLng = [lat, lng + offset]
        expect(distanceFromRoute(place, [route])).toBeLessThan(40)
        expect(keys.has(tileKey(...place))).toBe(true)
      }
    }
  })

  it('leaves out tiles beyond the radius plus half a sample step', () => {
    const route = line([42, -96.9], [42, -96.1], 20)
    const reach = CORRIDOR_RADIUS_KM + SAMPLE_STEP_KM / 2
    for (const key of corridorTiles([route])) {
      const [s, w] = key.split('_').map(Number)
      const nearest: LatLng = [
        Math.min(Math.max(42, s), s + 0.5),
        Math.min(Math.max(-96.5, w), w + 0.5),
      ]
      expect(distanceFromRoute(nearest, [route])).toBeLessThanOrEqual(
        reach + 0.5,
      )
    }
  })

  it('tiles a 3,000 km route with dense vertices quickly', () => {
    // About 3,000 km along latitude 40, a vertex every ~100 m.
    const route = line([40, -120], [40, -84.6], 30_000)
    expect(haversineKm(route[0], route[route.length - 1])).toBeGreaterThan(
      2_990,
    )
    const started = performance.now()
    const keys = corridorTiles([route])
    expect(performance.now() - started).toBeLessThan(500)
    // Two rows of tiles (the 40 km reach, ~0.38°, stays inside 39.5–40.5)
    // across ~72 columns.
    expect(keys.has('39.5_-120.5')).toBe(true)
    expect(keys.has('40.0_-85.0')).toBe(true)
    expect(keys.has('40.5_-100.0')).toBe(false)
    expect(keys.size).toBeGreaterThan(140)
    expect(keys.size).toBeLessThan(160)
  })
})

describe('distanceFromRoute', () => {
  const route: LatLng[] = [
    [42, -96],
    [42, -95],
    [43, -95],
  ]

  it('is Infinity without a route', () => {
    expect(distanceFromRoute([42, -96], [])).toBe(Infinity)
    expect(distanceFromRoute([42, -96], [[]])).toBe(Infinity)
  })

  it('is zero on the route', () => {
    expect(distanceFromRoute([42, -95.5], [route])).toBeCloseTo(0, 6)
    expect(distanceFromRoute([43, -95], [route])).toBeCloseTo(0, 6)
  })

  it('measures perpendicular distance to the nearest segment', () => {
    // 0.1° north of the first segment: about 11 km.
    expect(distanceFromRoute([42.1, -95.5], [route])).toBeCloseTo(11.1, 1)
    // East of the second segment by 0.1° of longitude at 42.5°: ~8.2 km.
    expect(distanceFromRoute([42.5, -94.9], [route])).toBeCloseTo(8.2, 1)
  })

  it('measures to the end point beyond the end of a line', () => {
    const place: LatLng = [41.9, -96.1]
    expect(distanceFromRoute(place, [route])).toBeCloseTo(
      haversineKm(place, [42, -96]),
      0,
    )
  })

  it('takes the nearest of several lines, including single points', () => {
    const far: LatLng[] = [
      [30, -80],
      [31, -80],
    ]
    expect(distanceFromRoute([42.1, -95.5], [far, route])).toBeCloseTo(11.1, 1)
    expect(distanceFromRoute([42, -96], [[[42, -96]]])).toBe(0)
  })

  it('handles segments across the antimeridian', () => {
    const across: LatLng[] = [
      [52, 179.5],
      [52, -179.5],
    ]
    expect(distanceFromRoute([52, 180], [across])).toBeLessThan(1)
  })

  it('handles a zero-length segment', () => {
    expect(
      distanceFromRoute(
        [42.1, -96],
        [
          [
            [42, -96],
            [42, -96],
          ],
        ],
      ),
    ).toBeCloseTo(11.1, 1)
  })
})

describe('legLines', () => {
  const stop = (id: string, lat: number, lng: number): StopInput => ({
    id,
    dayId: 'd1',
    position: 'a0',
    kind: 'waypoint',
    skipped: false,
    lat,
    lng,
    costAmount: null,
    costCategory: null,
  })
  const leg = (geometry?: string, ok = true): Leg => ({
    from: stop('a', 38.5, -120.2),
    to: stop('b', 43.252, -126.453),
    dayId: 'd1',
    route: ok ? { distanceM: 1, durationS: 1, geometry } : undefined,
    status: ok ? 'ok' : 'pending',
    miles: 0,
    gasCost: 0,
  })

  it("decodes each leg's driving line", () => {
    expect(legLines([leg('_p~iF~ps|U_ulLnnqC_mqNvxq`@')])).toEqual([
      [
        [38.5, -120.2],
        [40.7, -120.95],
        [43.252, -126.453],
      ],
    ])
  })

  it('falls back to a straight line between the stops', () => {
    const straight = [
      [38.5, -120.2],
      [43.252, -126.453],
    ]
    expect(legLines([leg(undefined, false)])).toEqual([straight])
    expect(legLines([leg(undefined)])).toEqual([straight])
    expect(legLines([leg('_p~iF')])).toEqual([straight])
    expect(legLines([leg('_p~iF~ps|U')])).toEqual([straight])
  })
})
