import { assertAlmostEquals, assertEquals } from '@std/assert'
import {
  dedupe,
  type DedupePlace,
  distanceM,
  type LatLngTuple,
  normalizeName,
} from './dedupe.ts'

/** A rectangle around (lat, lng), half-size d degrees. */
const box = (lat: number, lng: number, d: number): LatLngTuple[] => [
  [lat - d, lng - d],
  [lat - d, lng + d],
  [lat + d, lng + d],
  [lat + d, lng - d],
]

const place = (p: Partial<DedupePlace> & { id: string }): DedupePlace => ({
  name: p.id,
  kind: 'attraction',
  lat: 42.43,
  lng: -92.35,
  ...p,
})

Deno.test('Matugani is nested under Lost Island Theme Park', () => {
  const [park, ride] = dedupe([
    place({
      id: 'way/1',
      name: 'Lost Island Theme Park',
      wikidata: 'Q6684056',
      outline: box(42.43, -92.35, 0.004),
    }),
    place({ id: 'node/2', name: 'Matugani', lat: 42.431, lng: -92.351 }),
  ])
  assertEquals(park.parentId, null)
  assertEquals(ride.parentId, 'way/1')
})

Deno.test(
  'a campground in a state park nests under the smallest container',
  () => {
    const result = dedupe([
      place({
        id: 'relation/1',
        name: 'Big State Forest',
        outline: box(42, -92, 0.5),
      }),
      place({
        id: 'way/2',
        name: 'Little State Park',
        outline: box(42.1, -92.1, 0.05),
      }),
      place({
        id: 'way/3',
        name: 'Little State Park Campground',
        kind: 'campground',
        lat: 42.11,
        lng: -92.09,
        outline: box(42.11, -92.09, 0.005),
      }),
      place({ id: 'node/4', name: 'Outside', lat: 45, lng: -92 }),
    ])
    assertEquals(
      result.map((p) => [p.id, p.parentId]),
      [
        ['relation/1', null],
        ['way/2', 'relation/1'],
        ['way/3', 'way/2'],
        ['node/4', null],
      ],
    )
  },
)

Deno.test('same-size outlines do not nest in each other', () => {
  const result = dedupe([
    place({ id: 'way/1', name: 'A', outline: box(42, -92, 0.1) }),
    place({ id: 'way/2', name: 'B', outline: box(42, -92, 0.1) }),
  ])
  assertEquals(
    result.map((p) => p.parentId),
    [null, null],
  )
})

Deno.test('merges the same Wikidata QID', () => {
  const result = dedupe([
    place({ id: 'node/1', name: 'Corn Palace', wikidata: 'Q1131206' }),
    place({
      id: 'way/2',
      name: 'The World’s Only Corn Palace',
      wikidata: 'Q1131206',
      lat: 43.71,
      lng: -98.03,
      outline: box(43.71, -98.03, 0.001),
      tags: { tourism: 'attraction', website: 'https://cornpalace.com' },
    }),
  ])
  assertEquals(result.length, 1)
  assertEquals(result[0].id, 'way/2')
  assertEquals(result[0].mergedIds, ['node/1'])
})

Deno.test('merges the same name within 2 km, filling in missing fields', () => {
  const result = dedupe([
    place({
      id: 'node/1',
      name: 'The Great Plains Zoo',
      lat: 43.53,
      lng: -96.77,
      tags: { tourism: 'zoo', website: 'https://example.org/node' },
    }),
    place({
      id: 'way/2',
      name: 'Great Plains Zoo',
      lat: 43.535,
      lng: -96.775,
      outline: box(43.535, -96.775, 0.003),
      tags: { tourism: 'zoo', opening_hours: '9-5' },
    }),
    place({
      id: 'node/3',
      name: 'Great Plains ZOO',
      wikidata: 'Q5599385',
      lat: 43.531,
      lng: -96.771,
      tags: { phone: '1' },
    }),
  ])
  assertEquals(result.length, 1)
  const zoo = result[0]
  // The entry with a QID is kept, the outline comes from the way.
  assertEquals(zoo.id, 'node/3')
  assertEquals(zoo.wikidata, 'Q5599385')
  assertEquals(zoo.outline, box(43.535, -96.775, 0.003))
  assertEquals(zoo.mergedIds, ['node/1', 'way/2'])
  assertEquals(zoo.tags, {
    tourism: 'zoo',
    website: 'https://example.org/node',
    opening_hours: '9-5',
    phone: '1',
  })
})

Deno.test(
  'keeps same-name places that are far apart, or have different QIDs',
  () => {
    const result = dedupe([
      place({ id: 'a', name: 'Veterans Memorial', lat: 42.0, lng: -92.0 }),
      place({ id: 'b', name: 'Veterans Memorial', lat: 42.1, lng: -92.0 }),
      place({ id: 'c', name: 'City Park', wikidata: 'Q1' }),
      place({ id: 'd', name: 'City Park', wikidata: 'Q2' }),
    ])
    assertEquals(
      result.map((p) => p.id),
      ['a', 'b', 'c', 'd'],
    )
    assertEquals(
      result.every((p) => p.mergedIds.length === 0),
      true,
    )
  },
)

Deno.test('a QID-less duplicate joins a group that has a QID', () => {
  const result = dedupe([
    place({ id: 'a', name: 'Falls Park', wikidata: 'Q5432956' }),
    place({ id: 'b', name: 'Falls Park' }),
    place({ id: 'c', name: 'Falls Park', wikidata: 'Q5432956', lat: 50 }),
  ])
  assertEquals(result.length, 1)
  assertEquals(result[0].mergedIds, ['b', 'c'])
})

Deno.test('does not merge a park and a campground with the same name', () => {
  const result = dedupe([
    place({ id: 'a', name: 'Lake Park', outline: box(42.43, -92.35, 0.01) }),
    place({ id: 'b', name: 'Lake Park', kind: 'campground' }),
  ])
  assertEquals(
    result.map((p) => [p.id, p.parentId]),
    [
      ['a', null],
      ['b', 'a'],
    ],
  )
})

Deno.test('places without names or tags pass through', () => {
  const result = dedupe([
    place({ id: 'a', name: '!!!' }),
    place({ id: 'b', name: '!!!' }),
  ])
  assertEquals(result.length, 2)
  assertEquals(result[0].tags, {})
  assertEquals(result[0].wikidata, null)
  assertEquals(result[0].outline, null)
})

Deno.test('normalizeName ignores case, accents, punctuation and "the"', () => {
  assertEquals(normalizeName('The Corn  Palace!'), 'corn palace')
  assertEquals(normalizeName('Musée d’Orsay'), 'musee d orsay')
  assertEquals(
    normalizeName('Arts & Science Center'),
    'arts and science center',
  )
  assertEquals(normalizeName('Theater Park'), 'theater park')
})

Deno.test('distanceM', () => {
  assertEquals(distanceM({ lat: 1, lng: 2 }, { lat: 1, lng: 2 }), 0)
  // One degree of latitude is about 111.2 km.
  assertAlmostEquals(
    distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }),
    111_195,
    1,
  )
})
