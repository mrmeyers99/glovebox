import { assertEquals } from '@std/assert'
import { classifyCandidate, isCandidate, type OsmTags } from './candidates.ts'

const named = (tags: OsmTags): OsmTags => ({ name: 'Somewhere', ...tags })
const category = (tags: OsmTags) => classifyCandidate(named(tags))?.category

Deno.test('tourism attractions are candidates', () => {
  for (const value of [
    'attraction',
    'museum',
    'viewpoint',
    'zoo',
    'theme_park',
    'gallery',
    'aquarium',
  ]) {
    assertEquals(classifyCandidate(named({ tourism: value })), {
      kind: 'attraction',
      category: `tourism=${value}`,
    })
  }
})

Deno.test('prototype top places are candidates', () => {
  // Mitchell, SD → Waterloo, IA prototype.
  assertEquals(
    category({
      name: 'Corn Palace',
      tourism: 'attraction',
      wikidata: 'Q1131206',
    }),
    'tourism=attraction',
  )
  assertEquals(
    category({ name: 'Falls Park', leisure: 'park', wikidata: 'Q5432956' }),
    'leisure=park',
  )
  assertEquals(
    category({ name: 'Great Plains Zoo', tourism: 'zoo' }),
    'tourism=zoo',
  )
  assertEquals(
    category({
      name: 'Lost Island Theme Park',
      tourism: 'theme_park',
    }),
    'tourism=theme_park',
  )
})

Deno.test('campgrounds are their own kind', () => {
  assertEquals(classifyCandidate(named({ tourism: 'camp_site' })), {
    kind: 'campground',
    category: 'tourism=camp_site',
  })
  assertEquals(
    classifyCandidate(named({ tourism: 'caravan_site' }))?.kind,
    'campground',
  )
})

Deno.test('statues and sculptures, but not other artwork', () => {
  assertEquals(
    category({ tourism: 'artwork', artwork_type: 'statue' }),
    'tourism=artwork',
  )
  assertEquals(
    category({ tourism: 'artwork', artwork_type: 'sculpture' }),
    'tourism=artwork',
  )
  assertEquals(
    category({ tourism: 'artwork', artwork_type: 'mural' }),
    undefined,
  )
  assertEquals(category({ tourism: 'artwork' }), undefined)
  assertEquals(
    category({ historic: 'memorial', memorial: 'statue' }),
    'historic=memorial',
  )
})

Deno.test('notable historic sites', () => {
  assertEquals(category({ historic: 'fort' }), 'historic=fort')
  assertEquals(category({ historic: 'battlefield' }), 'historic=battlefield')
  // Memorials and old buildings need a Wikidata item: most are plaques.
  assertEquals(category({ historic: 'memorial' }), undefined)
  assertEquals(
    category({
      name: 'USS South Dakota Battleship Memorial',
      historic: 'memorial',
      wikidata: 'Q7866283',
    }),
    'historic=memorial',
  )
  assertEquals(category({ historic: 'building' }), undefined)
  assertEquals(
    category({ historic: 'building', wikidata: 'Q1' }),
    'historic=building',
  )
  assertEquals(
    category({ historic: 'building', wikidata: 'not a qid' }),
    undefined,
  )
})

Deno.test('parks and reserves only with Wikidata', () => {
  for (const [key, value] of [
    ['leisure', 'park'],
    ['leisure', 'nature_reserve'],
    ['boundary', 'national_park'],
    ['boundary', 'protected_area'],
  ]) {
    assertEquals(category({ [key]: value }), undefined)
    assertEquals(category({ [key]: value, wikidata: 'Q42' }), `${key}=${value}`)
  }
})

Deno.test('natural features and windmills', () => {
  assertEquals(category({ natural: 'waterfall' }), 'natural=waterfall')
  assertEquals(category({ waterway: 'waterfall' }), 'natural=waterfall')
  assertEquals(category({ natural: 'peak' }), 'natural=peak')
  assertEquals(category({ natural: 'cave_entrance' }), 'natural=cave_entrance')
  assertEquals(category({ natural: 'tree' }), undefined)
  assertEquals(category({ man_made: 'windmill' }), 'man_made=windmill')
  assertEquals(category({ historic: 'windmill' }), 'man_made=windmill')
})

Deno.test('rejects roads tagged historic=yes, like "239th Street"', () => {
  assertEquals(
    isCandidate({
      name: '239th Street',
      highway: 'residential',
      historic: 'yes',
    }),
    false,
  )
  assertEquals(isCandidate(named({ historic: 'yes', wikidata: 'Q5' })), false)
  // Even a "historic site" value is dropped on a road.
  assertEquals(
    isCandidate(named({ highway: 'track', historic: 'ruins' })),
    false,
  )
})

Deno.test('rejects districts, plain churches and cemeteries', () => {
  assertEquals(
    isCandidate(named({ historic: 'district', wikidata: 'Q9' })),
    false,
  )
  assertEquals(
    isCandidate(
      named({
        amenity: 'place_of_worship',
        religion: 'christian',
        wikidata: 'Q9',
      }),
    ),
    false,
  )
  assertEquals(
    isCandidate(
      named({ building: 'church', historic: 'building', wikidata: 'Q9' }),
    ),
    false,
  )
  assertEquals(
    isCandidate(named({ building: 'chapel', historic: 'monument' })),
    false,
  )
  assertEquals(
    isCandidate(named({ building: 'cathedral', historic: 'monument' })),
    false,
  )
  assertEquals(
    isCandidate(named({ landuse: 'cemetery', historic: 'monument' })),
    false,
  )
  assertEquals(
    isCandidate(named({ amenity: 'grave_yard', historic: 'monument' })),
    false,
  )
})

Deno.test('excluded features count when tourism-tagged', () => {
  assertEquals(
    category({ amenity: 'place_of_worship', tourism: 'attraction' }),
    'tourism=attraction',
  )
  assertEquals(
    category({ landuse: 'cemetery', tourism: 'attraction' }),
    'tourism=attraction',
  )
  assertEquals(
    category({ historic: 'yes', highway: 'pedestrian', tourism: 'viewpoint' }),
    'tourism=viewpoint',
  )
})

Deno.test('needs a name', () => {
  assertEquals(isCandidate({ tourism: 'museum' }), false)
  assertEquals(isCandidate({ tourism: 'museum', name: '  ' }), false)
  assertEquals(
    isCandidate({ tourism: 'museum', name: 'Dakota Discovery Museum' }),
    true,
  )
})

Deno.test('everything else is not a candidate', () => {
  assertEquals(
    isCandidate(named({ amenity: 'university', wikidata: 'Q1' })),
    false,
  )
  assertEquals(
    isCandidate(named({ aeroway: 'aerodrome', wikidata: 'Q1' })),
    false,
  )
  assertEquals(isCandidate(named({ tourism: 'hotel' })), false)
  assertEquals(isCandidate(named({ tourism: 'information' })), false)
  assertEquals(isCandidate(named({})), false)
})
