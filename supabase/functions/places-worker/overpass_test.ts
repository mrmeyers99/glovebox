import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import {
  ARTWORK_TYPES,
  HISTORIC_NEEDS_WIKIDATA,
  HISTORIC_SITES,
  isCandidate,
  MEMORIAL_STATUES,
  NATURAL,
  PARKS,
  TOURISM_ATTRACTIONS,
  TOURISM_CAMPGROUNDS,
} from '../_shared/places/mod.ts'
import {
  buildQuery,
  fetchOverpass,
  OVERPASS_SERVERS,
  type OverpassElement,
  parseElements,
} from './overpass.ts'
import { tileBounds } from './tiles.ts'
import fixture from './testdata/overpass_tile.json' with { type: 'json' }

const elements = fixture.elements as unknown as OverpassElement[]

Deno.test(
  'buildQuery limits the query to the tile and asks for every candidate tag',
  () => {
    const query = buildQuery(tileBounds('43.5_-98.5'))
    assertStringIncludes(
      query,
      '[out:json][timeout:90][bbox:43.5,-98.5,44,-98];',
    )
    assertStringIncludes(
      query,
      'nwr["tourism"~"^(attraction|museum|viewpoint|zoo|theme_park|gallery|aquarium|camp_site|caravan_site)$"]["name"];',
    )
    assertStringIncludes(
      query,
      'nwr["boundary"="national_park"]["wikidata"]["name"];',
    )
    assertStringIncludes(query, 'node.found;\nout body qt;')
    assertStringIncludes(
      query,
      '(way.found; relation.found;);\nout tags bb qt;',
    )
  },
)

Deno.test('every tag combination the query asks for is a candidate', () => {
  // The query is built from candidates.ts's lists; this keeps the two in step.
  const name = 'X'
  const tagSets = [
    ...[...TOURISM_ATTRACTIONS, ...TOURISM_CAMPGROUNDS].map((tourism) => ({
      tourism,
    })),
    ...[...ARTWORK_TYPES].map((artwork_type) => ({
      tourism: 'artwork',
      artwork_type,
    })),
    ...[...HISTORIC_SITES, 'windmill'].map((historic) => ({ historic })),
    ...[...MEMORIAL_STATUES].map((memorial) => ({
      historic: 'memorial',
      memorial,
    })),
    ...[...HISTORIC_NEEDS_WIKIDATA].map((historic) => ({
      historic,
      wikidata: 'Q1',
    })),
    ...[...NATURAL].map((natural) => ({ natural })),
    { waterway: 'waterfall' },
    { man_made: 'windmill' },
    ...PARKS.map(([key, value]) => ({ [key]: value, wikidata: 'Q1' })),
  ]
  for (const tags of tagSets) {
    assert(isCandidate({ name, ...tags }), JSON.stringify(tags))
  }
})

Deno.test('parseElements keeps named candidates with a position', () => {
  const places = parseElements(elements)
  assertEquals(
    places.map((p) => p.id),
    [
      'node/101',
      'node/104',
      'node/105',
      'way/201',
      'way/202',
      'way/203',
      'relation/301',
    ],
  )
  const camp = places.find((p) => p.id === 'node/104')!
  assertEquals(camp.kind, 'campground')
  assertEquals(camp.category, 'tourism=camp_site')
  assertEquals(camp.outline, null)
  // Only the tags the app uses are kept.
  assertEquals(camp.tags, {
    tourism: 'camp_site',
    tents: 'yes',
    shower: 'yes',
    'addr:city': 'Mitchell',
  })
  const park = places.find((p) => p.id === 'way/202')!
  assertAlmostEquals(park.lat, 43.74)
  assertAlmostEquals(park.lng, -98.05)
  assertEquals(park.outline, [
    [43.72, -98.08],
    [43.72, -98.02],
    [43.76, -98.02],
    [43.76, -98.08],
  ])
  assertEquals(park.wikidata, 'Q6477924')
  // A malformed Wikidata tag is dropped (places.wikidata must be a QID).
  assertEquals(places.find((p) => p.id === 'node/105')!.wikidata, null)
})

Deno.test('parseElements drops nodes without coordinates', () => {
  assertEquals(
    parseElements([
      { type: 'node', id: 1, tags: { name: 'A', tourism: 'museum' } },
    ]),
    [],
  )
})

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(
  answers: Record<string, () => Response | Promise<Response>>,
) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchFn = ((input: string, init?: RequestInit) => {
    calls.push({ url: input, init })
    const reply = answers[new URL(input).host]
    return reply
      ? Promise.resolve().then(reply)
      : Promise.reject(new TypeError('connection reset'))
  }) as typeof fetch
  return { calls, fetchFn }
}

const options = {
  userAgent: 'Glovebox/1.0 (test; ops@example.com)',
  deadline: Date.now() + 60_000,
}

Deno.test(
  'fetchOverpass posts the query with a contact User-Agent',
  async () => {
    const { calls, fetchFn } = fakeFetch({
      'overpass-api.de': () => answer(fixture),
    })
    const result = await fetchOverpass('[out:json];node(1);out;', {
      ...options,
      fetchFn,
    })
    assertEquals(result.length, elements.length)
    assertEquals(calls.length, 1)
    assertEquals(calls[0].url, OVERPASS_SERVERS[0])
    const headers = new Headers(calls[0].init?.headers)
    assertEquals(headers.get('user-agent'), options.userAgent)
    assertEquals(
      (calls[0].init?.body as URLSearchParams).get('data'),
      '[out:json];node(1);out;',
    )
  },
)

Deno.test('fetchOverpass tries the next server when one fails', async () => {
  const { calls, fetchFn } = fakeFetch({
    'overpass-api.de': () => answer({ error: 'busy' }, 429),
    'overpass.kumi.systems': () =>
      answer({
        elements: [],
        remark: 'runtime error: Query timed out in "query" at line 3',
      }),
    'overpass.private.coffee': () => answer({ elements: [elements[0]] }),
  })
  const result = await fetchOverpass('q', { ...options, fetchFn })
  assertEquals(result, [elements[0]])
  assertEquals(calls.length, 3)
})

Deno.test('fetchOverpass reports every server when none answers', async () => {
  const { fetchFn } = fakeFetch({
    'overpass.kumi.systems': () => answer({ nothing: true }),
    'overpass.private.coffee': () => new Response('<html>oops</html>'),
  })
  const error = await assertRejects(() =>
    fetchOverpass('q', { ...options, fetchFn }),
  )
  assertStringIncludes(String(error), 'overpass-api.de: connection reset')
  assertStringIncludes(
    String(error),
    'overpass.kumi.systems: no elements in answer',
  )
  assertStringIncludes(String(error), 'overpass.private.coffee:')
})

Deno.test(
  'fetchOverpass reports timeouts and stops at the deadline',
  async () => {
    let clock = 0
    const fetchFn = (() => {
      clock = 1000
      return Promise.reject(
        new DOMException('Signal timed out.', 'TimeoutError'),
      )
    }) as typeof fetch
    const error = await assertRejects(() =>
      fetchOverpass('q', {
        ...options,
        fetchFn,
        deadline: 1000,
        now: () => clock,
      }),
    )
    assertStringIncludes(
      String(error),
      'overpass-api.de: timed out; overpass.kumi.systems: out of time',
    )
  },
)

Deno.test('fetchOverpass reports non-Error failures', async () => {
  const fetchFn = (() => Promise.reject('boom')) as typeof fetch
  const error = await assertRejects(() =>
    fetchOverpass('q', {
      ...options,
      fetchFn,
      servers: ['https://a.example/api'],
    }),
  )
  assertStringIncludes(String(error), 'a.example: boom')
})
