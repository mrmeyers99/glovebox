import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import { dedupe, type LatLngTuple } from '../_shared/places/mod.ts'
import {
  campgroundName,
  distanceToOutlineM,
  findPark,
  finishCampgrounds,
  insideOutline,
  PARK_RADIUS_M,
  type ParkOutline,
  parseParks,
} from './campgrounds.ts'
import type { OsmPlace, OverpassElement } from './overpass.ts'

/** A rectangle's points, as Overpass gives a way's geometry. */
const rect = (south: number, west: number, north: number, east: number) => [
  { lat: south, lon: west },
  { lat: south, lon: east },
  { lat: north, lon: east },
  { lat: north, lon: west },
  { lat: south, lon: west },
]

const square = (
  south: number,
  west: number,
  north: number,
  east: number,
): LatLngTuple[] => rect(south, west, north, east).map((p) => [p.lat, p.lon])

function park(
  id: string,
  lines: LatLngTuple[][],
  name: string | null = id,
): ParkOutline {
  const area =
    (Math.max(...lines.flat().map((p) => p[0])) -
      Math.min(...lines.flat().map((p) => p[0]))) *
    (Math.max(...lines.flat().map((p) => p[1])) -
      Math.min(...lines.flat().map((p) => p[1])))
  return { id, name, lines, area }
}

Deno.test('parseParks reads way and relation outlines', () => {
  const elements: OverpassElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { name: ' Palisades State Park ', leisure: 'park' },
      // Not closed: closed for it.
      geometry: rect(43, -97, 44, -96).slice(0, 4),
    },
    {
      type: 'relation',
      id: 2,
      tags: { boundary: 'protected_area' },
      members: [
        {
          type: 'way',
          ref: 10,
          role: 'outer',
          geometry: rect(40, -100, 42, -98),
        },
        { type: 'node', ref: 11, role: 'label' },
        // A missing point splits the line; a single point is no line.
        {
          type: 'way',
          ref: 12,
          role: 'inner',
          geometry: [
            { lat: 41, lon: -99.5 },
            { lat: 41, lon: -99 },
            null,
            { lat: 41.5, lon: -99 },
          ],
        },
      ],
    },
    // Not a park, or no outline: skipped.
    {
      type: 'way',
      id: 3,
      tags: { tourism: 'museum' },
      geometry: rect(0, 0, 1, 1),
    },
    { type: 'way', id: 4, tags: { leisure: 'park' } },
    { type: 'relation', id: 5, tags: { leisure: 'nature_reserve' } },
    { type: 'node', id: 6, lat: 1, lon: 1, tags: { leisure: 'park' } },
  ]
  const parks = parseParks(elements)
  assertEquals(
    parks.map((p) => [p.id, p.name, p.lines.length]),
    [
      ['way/1', 'Palisades State Park', 1],
      ['relation/2', null, 2],
    ],
  )
  const [way, relation] = parks
  assertEquals(way.lines[0].length, 5)
  assertEquals(way.lines[0][0], way.lines[0][4])
  assertEquals(way.area, 1)
  assertEquals(relation.area, 4)
  assertEquals(relation.lines[1], [
    [41, -99.5],
    [41, -99],
  ])
})

Deno.test('insideOutline handles holes (inner rings)', () => {
  const lines = [square(0, 0, 10, 10), square(4, 4, 6, 6)]
  assert(insideOutline({ lat: 2, lng: 2 }, lines))
  assert(!insideOutline({ lat: 5, lng: 5 }, lines))
  assert(!insideOutline({ lat: 11, lng: 5 }, lines))
  // A multipolygon's ring split across member ways still closes.
  const [a, b] = [
    square(0, 0, 10, 10).slice(0, 3),
    square(0, 0, 10, 10).slice(2),
  ]
  assert(insideOutline({ lat: 5, lng: 5 }, [a, b]))
})

Deno.test('distanceToOutlineM measures to the nearest edge', () => {
  const lines = [square(43, -97, 43.1, -96.9)]
  // 0.009° of latitude is about 1 km.
  assertAlmostEquals(
    distanceToOutlineM({ lat: 43.109, lng: -96.95 }, lines),
    1002,
    5,
  )
  // Past a corner, the distance is to the corner.
  const corner = distanceToOutlineM({ lat: 43.109, lng: -96.9 + 0.009 }, lines)
  assert(corner > 1002 && corner < 1500)
  assertEquals(
    distanceToOutlineM({ lat: 0, lng: 0 }, [
      [
        [0, 0],
        [0, 0],
      ],
    ]),
    0,
  )
})

Deno.test(
  'findPark: the smallest containing park, else the closest near',
  () => {
    const forest = park('relation/1', [square(42, -98, 44, -96)])
    const state = park('way/2', [square(43, -97, 43.1, -96.9)])
    const city = park('way/3', [square(43.2, -97, 43.21, -96.99)])
    const parks = [forest, state, city]
    assertEquals(findPark({ lat: 43.05, lng: -96.95 }, parks), state)
    assertEquals(findPark({ lat: 42.5, lng: -97.5 }, parks), forest)
    // Outside every park: the closest within PARK_RADIUS_M.
    const near = [state, city]
    assertEquals(findPark({ lat: 43.105, lng: -96.95 }, near), state)
    assertEquals(findPark({ lat: 43.195, lng: -96.995 }, near), city)
    assertEquals(findPark({ lat: 43.15, lng: -96.95 }, near), null)
    assertEquals(PARK_RADIUS_M, 1000)
    assertEquals(findPark({ lat: 0, lng: 0 }, []), null)
  },
)

Deno.test('campgroundName names an unnamed campground after its park', () => {
  assertEquals(
    campgroundName(park('way/1', [square(0, 0, 1, 1)], 'Palisades State Park')),
    'Campground at Palisades State Park',
  )
  assertEquals(
    campgroundName(park('way/1', [square(0, 0, 1, 1)], null)),
    'Campground',
  )
  assertEquals(campgroundName(null), 'Campground')
})

function place(fields: Partial<OsmPlace> & { id: string }): OsmPlace {
  return {
    name: '',
    kind: 'campground',
    category: 'tourism=camp_site',
    wikidata: null,
    lat: 43.05,
    lng: -96.95,
    outline: null,
    tags: {},
    ...fields,
  }
}

Deno.test('finishCampgrounds links, names and dedupes campgrounds', () => {
  const stateOutline = square(43, -97, 43.1, -96.9)
  const places = dedupe([
    // The park, mapped twice: the node merges into the way.
    place({
      id: 'node/1',
      name: 'Palisades State Park',
      kind: 'attraction',
      category: 'leisure=park',
      wikidata: 'Q1',
    }),
    place({
      id: 'way/2',
      name: 'Palisades State Park',
      kind: 'attraction',
      category: 'leisure=park',
      wikidata: 'Q1',
      outline: stateOutline,
    }),
    place({ id: 'node/3', name: 'Split Rock Camp', lat: 43.02 }),
    // Unnamed, 100 m from Split Rock Camp: the same campground.
    place({ id: 'way/4', lat: 43.0209 }),
    // Unnamed, in the park, far from the named one.
    place({ id: 'node/5', lat: 43.08 }),
    // Unnamed, in a park that isn't a place (no Wikidata item).
    place({ id: 'node/6', lat: 44.05 }),
    // Nowhere near a park.
    place({ id: 'node/7', lat: 45 }),
  ])
  const parks = [
    // Its id is the node's, which merged into way/2.
    park('node/1', [stateOutline], 'Palisades State Park'),
    park('way/8', [square(44, -97, 44.1, -96.9)], 'Lake Park'),
  ]
  const result = finishCampgrounds(places, parks)
  assertEquals(
    result.map((p) => [p.id, p.name, p.parentId]),
    [
      ['way/2', 'Palisades State Park', null],
      ['node/3', 'Split Rock Camp', 'way/2'],
      ['node/5', 'Campground at Palisades State Park', 'way/2'],
      ['node/6', 'Campground at Lake Park', null],
      ['node/7', 'Campground', null],
    ],
  )
})

Deno.test('finishCampgrounds replaces outline nesting for campgrounds', () => {
  // A campground inside a theme park's bounding box isn't its child.
  const places = dedupe([
    place({
      id: 'way/1',
      name: 'Fun Land',
      kind: 'attraction',
      category: 'tourism=theme_park',
      outline: square(43, -97, 43.1, -96.9),
    }),
    place({ id: 'node/2', name: 'Fun Land RV Park' }),
  ])
  assertEquals(places[1].parentId, 'way/1')
  assertEquals(finishCampgrounds(places, [])[1].parentId, null)
})
