import { assertEquals } from '@std/assert'
import {
  amenities,
  osmUrl,
  placeImage,
  rankingTiles,
  shapeSuggestions,
  wikipediaUrl,
} from './shape.ts'
import type { PlaceRow, TileStatus } from './store.ts'

const A = '43.5_-98.5'
const B = '43.5_-98.0' // A's eastern neighbour
const FAR = '40.0_-75.0'

let nextId = 1
function row(fields: Partial<PlaceRow> = {}): PlaceRow {
  const id = fields.id ?? nextId++
  return {
    id,
    source: 'osm',
    source_id: `node/${id}`,
    wikidata: null,
    name: `Place ${id}`,
    kind: 'attraction',
    category: 'tourism=museum',
    lat: 43.7,
    lng: -98.2,
    tile_key: A,
    tags: {},
    image_file: null,
    image_credit: null,
    image_license: null,
    score: 1,
    parent_place_id: null,
    ...fields,
  }
}

const statuses = (entries: Record<string, TileStatus>) =>
  new Map(Object.entries(entries))

Deno.test('rankingTiles is each tile and its neighbours, once', () => {
  const keys = rankingTiles([A, B])
  assertEquals(keys.length, 12)
  assertEquals(new Set(keys).size, 12)
  assertEquals(keys.includes('43.0_-99.0') && keys.includes('44.0_-97.5'), true)
  assertEquals(rankingTiles([]), [])
})

Deno.test('sorts tiles into done, pending and failed', () => {
  const result = shapeSuggestions(
    [A, B, FAR, '0.0_0.0', '0.5_0.0'],
    statuses({
      [A]: 'done',
      [B]: 'fetching',
      [FAR]: 'failed',
      '0.0_0.0': 'pending',
    }),
    [],
  )
  // A tile missing from statuses was queued by a concurrent request.
  assertEquals(result, {
    places: [],
    pending: [B, '0.0_0.0', '0.5_0.0'],
    failed: [FAR],
    scoring: [],
  })
})

Deno.test(
  'lists done tiles still being scored, with their scored places',
  () => {
    const result = shapeSuggestions(
      [A, B, FAR],
      statuses({ [A]: 'done', [B]: 'done', [FAR]: 'pending' }),
      [row({ score: 1 })],
      new Set([A, FAR]),
    )
    // FAR isn't done, so it's only pending.
    assertEquals(result.scoring, [A])
    assertEquals(result.pending, [FAR])
    assertEquals(result.places.length, 1)
  },
)

Deno.test(
  'ranks by local percentile, using neighbours only for ranking',
  () => {
    const low = row({ score: 1 })
    const high = row({ score: 3 })
    const neighbour = row({ score: 2, tile_key: B, lng: -97.9 })
    const result = shapeSuggestions([A], statuses({ [A]: 'done' }), [
      low,
      neighbour,
      high,
    ])
    assertEquals(
      result.places.map((p) => [p.id, p.percentile]),
      [
        [high.id, 1],
        [low.id, 0],
      ],
    )
  },
)

Deno.test('ties on percentile are broken by score, then id', () => {
  // Alone in their (far apart) neighbourhoods, both are the best around.
  const a = row({ score: 1 })
  const b = row({ score: 5, tile_key: FAR })
  const c = row({ score: 1, tile_key: '0.0_0.0' })
  const result = shapeSuggestions(
    [A, FAR, '0.0_0.0'],
    statuses({ [A]: 'done', [FAR]: 'done', '0.0_0.0': 'done' }),
    [c, a, b],
  )
  assertEquals(
    result.places.map((p) => p.id),
    [b.id, a.id, c.id],
  )
})

Deno.test('hides children whose parent is suggested too', () => {
  const park = row({ score: 4, name: 'Lost Island Theme Park' })
  const ride = row({ score: 2, parent_place_id: park.id })
  const orphan = row({ score: 3, parent_place_id: 999_999 })
  // The parent is only in a neighbouring tile, so it isn't suggested.
  const outside = row({ score: 5, tile_key: B })
  const inOutside = row({ score: 2, parent_place_id: outside.id })
  // A neighbouring tile's child of a neighbouring parent isn't ranked.
  const besideOutside = row({
    score: 100,
    tile_key: B,
    parent_place_id: outside.id,
  })
  const result = shapeSuggestions([A], statuses({ [A]: 'done' }), [
    park,
    ride,
    orphan,
    outside,
    inOutside,
    besideOutside,
  ])
  // Ranked among 2, 3, 4 and 5 (the neighbouring parent).
  assertEquals(
    result.places.map((p) => [p.name, p.percentile]),
    [
      [park.name, 2 / 3],
      [orphan.name, 1 / 3],
      [inOutside.name, 0],
    ],
  )
})

Deno.test('shapes each place for the client', () => {
  const place = row({
    id: 42,
    source_id: 'way/42',
    wikidata: 'Q1048837',
    name: 'Corn Palace',
    category: 'tourism=attraction',
    lat: 43.714,
    lng: -98.0298,
    score: 5.1,
    tags: { wikipedia: 'en:Corn Palace', website: 'https://cornpalace.com' },
    image_file: 'Corn Palace (2019).jpg',
    image_credit: 'Jane Doe',
    image_license: 'CC BY-SA 4.0',
  })
  const [suggestion] = shapeSuggestions([A], statuses({ [A]: 'done' }), [
    place,
  ]).places
  assertEquals(suggestion, {
    id: 42,
    name: 'Corn Palace',
    kind: 'attraction',
    category: 'tourism=attraction',
    lat: 43.714,
    lng: -98.0298,
    tile_key: A,
    score: 5.1,
    percentile: 1,
    image: {
      thumbnail_url:
        'https://commons.wikimedia.org/wiki/Special:FilePath/Corn_Palace_(2019).jpg?width=320',
      page_url:
        'https://commons.wikimedia.org/wiki/File:Corn_Palace_(2019).jpg',
      credit: 'Jane Doe',
      license: 'CC BY-SA 4.0',
    },
    wikipedia_url: 'https://en.wikipedia.org/wiki/Corn_Palace',
    osm_url: 'https://www.openstreetmap.org/way/42',
    amenities: null,
  })
})

Deno.test('campgrounds come with their amenities', () => {
  const camp = row({
    kind: 'campground',
    category: 'tourism=camp_site',
    tags: null,
  })
  const [suggestion] = shapeSuggestions([A], statuses({ [A]: 'done' }), [
    camp,
  ]).places
  assertEquals(suggestion.amenities?.tents, null)
  assertEquals(suggestion.wikipedia_url, null)
  assertEquals(suggestion.image, null)
})

Deno.test('placeImage strips a File: prefix and skips blank names', () => {
  assertEquals(
    placeImage(row({ image_file: 'File:A b/c.jpg' }))?.page_url,
    'https://commons.wikimedia.org/wiki/File:A_b%2Fc.jpg',
  )
  assertEquals(placeImage(row({ image_file: '  ' })), null)
})

Deno.test('wikipediaUrl prefers the OSM tag, then Wikidata', () => {
  assertEquals(
    wikipediaUrl('de:Kölner Dom', 'Q4176'),
    'https://de.wikipedia.org/wiki/K%C3%B6lner_Dom',
  )
  assertEquals(
    wikipediaUrl('en:AC/DC', null),
    'https://en.wikipedia.org/wiki/AC/DC',
  )
  assertEquals(
    wikipediaUrl('Corn Palace', 'Q1048837'),
    'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q1048837',
  )
  assertEquals(wikipediaUrl(undefined, 'not a qid'), null)
  assertEquals(wikipediaUrl(undefined, null), null)
})

Deno.test('osmUrl links OSM elements only', () => {
  assertEquals(
    osmUrl({ source: 'osm', source_id: 'relation/7' }),
    'https://www.openstreetmap.org/relation/7',
  )
  assertEquals(osmUrl({ source: 'osm', source_id: 'bogus' }), null)
  assertEquals(osmUrl({ source: 'ridb', source_id: '232447' }), null)
})

Deno.test('amenities reads campground tags', () => {
  assertEquals(
    amenities('tourism=camp_site', {
      tents: 'yes',
      caravans: 'no',
      motorhome: 'yes',
      power_supply: 'cee_blue',
      shower: 'hot',
      toilets: 'yes',
      drinking_water: 'no',
      fee: '25 USD',
      reservation: 'required',
      capacity: '42',
      'contact:website': 'https://example.com/camp',
    }),
    {
      tents: true,
      rvs: false,
      hookups: true,
      showers: true,
      toilets: true,
      drinking_water: false,
      fee: true,
      reservation: 'required',
      capacity: 42,
      website: 'https://example.com/camp',
    },
  )
  const unknown = amenities('tourism=caravan_site', {
    capacity: 'lots',
    website: 'javascript:alert(1)',
    reservation: ' ',
  })
  assertEquals(unknown, {
    tents: null,
    rvs: true, // a caravan site takes RVs unless tagged otherwise
    hookups: null,
    showers: null,
    toilets: null,
    drinking_water: null,
    fee: null,
    reservation: null,
    capacity: null,
    website: null,
  })
  assertEquals(amenities('tourism=camp_site', { motorhome: 'yes' }).rvs, true)
  assertEquals(amenities('tourism=camp_site', {}).rvs, null)
})
