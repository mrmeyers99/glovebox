import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  formatReport,
  runReport,
  TEST_CORRIDOR,
  tileCampgrounds,
} from './campground_report.ts'
import type { OverpassElement } from './overpass.ts'
import fixture from './testdata/overpass_tile.json' with { type: 'json' }

const elements = fixture.elements as unknown as OverpassElement[]
const TILE = '43.5_-98.5'

Deno.test('the test corridor is the 68 tiles from Mitchell to Waterloo', () => {
  assertEquals(TEST_CORRIDOR.length, 68)
  assertEquals(new Set(TEST_CORRIDOR).size, 68)
  assertEquals(TEST_CORRIDOR[0], '41.5_-95.0')
  assertEquals(TEST_CORRIDOR.includes('43.5_-98.0'), true) // Mitchell
  assertEquals(TEST_CORRIDOR.includes('42.0_-92.5'), true) // Waterloo
  assertEquals(TEST_CORRIDOR.at(-1), '44.0_-95.0')
})

Deno.test('tileCampgrounds: what the worker stores, with park facts', () => {
  const camps = tileCampgrounds(elements, TILE)
  assertEquals(
    camps.map((c) => [c.place.source_id, c.namedInOsm, c.nearPark]),
    [
      ['node/104', true, true],
      ['node/106', false, true],
      ['node/108', false, false],
    ],
  )
  assertEquals(camps[0].amenities.tents, true)
})

Deno.test('formatReport counts campgrounds, links and amenity tags', () => {
  const report = formatReport(tileCampgrounds(elements, TILE), {
    done: 1,
    failed: [],
  })
  assertStringIncludes(report, '**3 campgrounds** in 1 tiles\n')
  assertStringIncludes(
    report,
    '| Caravan sites (tourism=caravan_site) | 1 | 33% |',
  )
  assertStringIncludes(report, '| Named in OSM | 1 | 33% |')
  assertStringIncludes(report, '| Unnamed, named after their park | 1 | 33% |')
  assertStringIncludes(report, '| Unnamed, no park ("Campground") | 1 | 33% |')
  assertStringIncludes(
    report,
    '| Linked to a ranked park (parent_place_id) | 1 | 33% |',
  )
  assertStringIncludes(report, '| In or within 1 km of any park | 2 | 67% |')
  // Tents: one tagged yes. Fee: node/106 is free. RVs: the caravan site.
  assertStringIncludes(report, '| tents | 1 | 33% | 100% |')
  assertStringIncludes(report, '| fee | 1 | 33% | 0% |')
  assertStringIncludes(report, '| rvs | 1 | 33% | 100% |')
  assertStringIncludes(report, '| website | 0 | 0% | – |')
  assertStringIncludes(report, 'Mean amenity completeness: 15%')
})

Deno.test('formatReport with no campgrounds and failed tiles', () => {
  const report = formatReport([], { done: 1, failed: ['1.0_1.0', '2.0_2.0'] })
  assertStringIncludes(
    report,
    '**0 campgrounds** in 1 tiles (2 tiles failed: 1.0_1.0, 2.0_2.0)',
  )
  assertStringIncludes(report, '| Named in OSM | 0 | – |')
  assertStringIncludes(report, 'Mean amenity completeness: 0%')
})

Deno.test('runReport fetches each tile and lists those that fail', async () => {
  const log: string[] = []
  const queries: string[] = []
  const fetchFn = ((url: string) => {
    const query = new URL(url).searchParams.get('data')!
    queries.push(query)
    return Promise.resolve(
      query.includes('[bbox:1,1,1.5,1.5]')
        ? new Response('', { status: 504 })
        : Response.json(fixture),
    )
  }) as typeof fetch
  const report = await runReport([TILE, '1.0_1.0'], {
    fetchFn,
    servers: ['https://overpass.example/api/interpreter'],
    userAgent: 'test',
    pauseMs: 1,
    log: (line) => log.push(line),
  })
  assertEquals(queries.length, 2)
  assertStringIncludes(
    report,
    '**3 campgrounds** in 1 tiles (1 tiles failed: 1.0_1.0)',
  )
  assertEquals(log[0], `${TILE}: 3 campgrounds (${elements.length} elements)`)
  assertStringIncludes(log[1], '1.0_1.0: failed: Overpass unavailable')
})
