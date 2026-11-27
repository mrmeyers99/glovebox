import { assertAlmostEquals, assertEquals } from '@std/assert'
import { CATEGORY_BONUS, scorePlace } from '../_shared/places/mod.ts'
import { enrichment, enrichPlaces, ERROR_PAUSE_MS } from './enrich.ts'
import type { PlaceToEnrich } from './store.ts'
import {
  fakeClock,
  fakeWikimedia,
  pageviewsAnswer,
  testClient,
} from './testdata/fake_wikimedia.ts'

const cornPalace: PlaceToEnrich = {
  id: 1,
  wikidata: 'Q1135328',
  category: 'tourism=attraction',
}
const village: PlaceToEnrich = {
  id: 2,
  wikidata: 'Q5432100',
  category: 'historic=archaeological_site',
}
const tower: PlaceToEnrich = {
  id: 3,
  wikidata: 'Q7000001',
  category: 'man_made=windmill',
}
const deleted: PlaceToEnrich = {
  id: 4,
  wikidata: 'Q999999999',
  category: 'tourism=museum',
}
const plain: PlaceToEnrich = { id: 5, wikidata: null, category: 'tourism=zoo' }

Deno.test(
  'a place with no Wikidata item gets its category bonus only, with no requests',
  async () => {
    const { requests, fetchFn } = fakeWikimedia()
    const result = await enrichPlaces([plain], testClient(fetchFn))
    assertEquals(requests.length, 0)
    assertEquals(result, {
      enriched: [
        {
          id: 5,
          wikidata: null,
          sitelinks: null,
          pageviews_month: null,
          commons_files: null,
          image_file: null,
          image_credit: null,
          image_license: null,
          score: CATEGORY_BONUS['tourism=zoo'],
        },
      ],
      unfinished: [],
      deferred: [],
      stopped: null,
    })
  },
)

Deno.test(
  'enriches linked places from Wikidata, Commons and pageviews',
  async () => {
    const { requests, fetchFn } = fakeWikimedia({
      pageviews: (r) =>
        r.url.includes('/Corn_Palace/')
          ? pageviewsAnswer(Array(12).fill(9000))
          : pageviewsAnswer([120]),
    })
    const clock = fakeClock()
    const result = await enrichPlaces(
      [cornPalace, village, tower, deleted, plain],
      testClient(fetchFn, clock),
      clock.now,
    )
    assertEquals(result.unfinished, [])
    assertEquals(result.deferred, [])
    assertEquals(result.stopped, null)
    const byId = new Map(result.enriched.map((e) => [e.id, e]))
    assertEquals(byId.get(1), {
      id: 1,
      wikidata: 'Q1135328',
      sitelinks: 14,
      pageviews_month: 9000,
      commons_files: 120,
      image_file: 'Corn Palace 2017.jpg',
      image_credit: 'Jane Doe & friends',
      image_license: 'CC BY-SA 4.0',
      score: scorePlace(
        {
          pageviewsMonth: 9000,
          commonsFiles: 120,
          sitelinks: 14,
          hasPhoto: true,
        },
        'tourism=attraction',
      ),
    })
    assertEquals(byId.get(2)?.pageviews_month, 10)
    assertEquals(byId.get(2)?.commons_files, null)
    assertEquals(byId.get(3)?.commons_files, 0) // its category doesn't exist
    assertEquals(byId.get(3)?.pageviews_month, null) // no English article
    // An item Wikidata no longer has: category bonus only.
    assertEquals(byId.get(4)?.sitelinks, null)
    assertEquals(byId.get(4)?.score, CATEGORY_BONUS['tourism=museum'])
    assertEquals(byId.get(5)?.score, CATEGORY_BONUS['tourism=zoo'])
    // One SPARQL query, one categoryinfo, one imageinfo, two pageviews.
    assertEquals(
      requests.map((r) => new URL(r.url).host),
      [
        'query.wikidata.org',
        'commons.wikimedia.org',
        'commons.wikimedia.org',
        'wikimedia.org',
        'wikimedia.org',
      ],
    )
  },
)

Deno.test('an article shared by two places is fetched once', async () => {
  const { requests, fetchFn } = fakeWikimedia()
  const twin = { ...cornPalace, id: 9 }
  const result = await enrichPlaces([cornPalace, twin], testClient(fetchFn))
  assertEquals(
    result.enriched.map((e) => [e.id, e.pageviews_month]),
    [
      [1, 1200],
      [9, 1200],
    ],
  )
  assertEquals(
    requests.filter((r) => new URL(r.url).host === 'wikimedia.org').length,
    1,
  )
})

Deno.test(
  'a rate limit on pageviews keeps finished places and stops',
  async () => {
    let calls = 0
    const { fetchFn } = fakeWikimedia({
      pageviews: () =>
        ++calls === 1
          ? pageviewsAnswer(Array(12).fill(500))
          : new Response('slow down', {
              status: 429,
              headers: { 'retry-after': '120' },
            }),
    })
    const clock = fakeClock()
    const result = await enrichPlaces(
      [cornPalace, village, tower, plain],
      testClient(fetchFn, clock),
      clock.now,
    )
    assertEquals(result.enriched.map((e) => e.id).sort(), [1, 3, 5])
    assertEquals(result.unfinished, [2])
    assertEquals(result.deferred, [])
    assertEquals(result.stopped?.retryAt, clock.time + 120_000)
    assertEquals(
      result.stopped?.error.startsWith('wikimedia.org: HTTP 429'),
      true,
    )
  },
)

Deno.test(
  'a Wikidata or Commons failure hands back every linked place',
  async () => {
    for (const replies of [
      {
        sparql: () =>
          new Response('', { status: 429, headers: { 'retry-after': '60' } }),
      },
      { categoryinfo: () => new Response('', { status: 500 }) },
      { imageinfo: () => Response.json({}) },
    ]) {
      const { fetchFn } = fakeWikimedia(replies)
      const clock = fakeClock()
      const result = await enrichPlaces(
        [cornPalace, village, plain],
        testClient(fetchFn, clock),
        clock.now,
      )
      assertEquals(
        result.enriched.map((e) => e.id),
        [5],
      )
      assertEquals(result.unfinished, [1, 2])
      assertEquals(result.stopped !== null, true)
    }
  },
)

Deno.test(
  'a failure other than a rate limit pauses for ERROR_PAUSE_MS',
  async () => {
    const { fetchFn } = fakeWikimedia({
      sparql: () => Promise.reject(new TypeError('dns error')),
    })
    const clock = fakeClock()
    const result = await enrichPlaces(
      [cornPalace],
      testClient(fetchFn, clock),
      clock.now,
    )
    assertEquals(result.stopped, {
      error: 'query.wikidata.org: dns error',
      retryAt: clock.time + ERROR_PAUSE_MS,
    })
  },
)

Deno.test('one article’s HTTP error defers that place only', async () => {
  const { fetchFn } = fakeWikimedia({
    pageviews: (r) =>
      r.url.includes('/Corn_Palace/')
        ? new Response('', { status: 400 })
        : pageviewsAnswer([12]),
  })
  const result = await enrichPlaces([cornPalace, village], testClient(fetchFn))
  assertEquals(result.deferred, [1])
  assertEquals(
    result.enriched.map((e) => e.id),
    [2],
  )
  assertEquals(result.stopped, null)
})

Deno.test(
  'running out of time leaves the rest for the next run, without pausing',
  async () => {
    const clock = fakeClock()
    const fake = fakeWikimedia()
    // The imageinfo answer comes after the deadline.
    const fetchFn = (async (input: URL | string, init?: RequestInit) => {
      const response = await fake.fetchFn(input, init)
      if (new URL(input).searchParams.get('prop') === 'imageinfo')
        clock.time += 5_000
      return response
    }) as typeof fetch
    const result = await enrichPlaces(
      [cornPalace, village, tower],
      testClient(fetchFn, clock, 3_000),
      clock.now,
    )
    assertEquals(
      result.enriched.map((e) => e.id),
      [3],
    )
    assertEquals(result.unfinished, [1, 2])
    assertEquals(result.stopped, null)
    assertEquals(
      fake.requests.filter((r) => new URL(r.url).host === 'wikimedia.org')
        .length,
      0,
    )
  },
)

Deno.test(
  'time running out during the throttle wait does not pause',
  async () => {
    const clock = fakeClock()
    const { fetchFn } = fakeWikimedia()
    // The second pageviews request waits 2.5 s, past the deadline.
    const result = await enrichPlaces(
      [cornPalace, village, tower],
      testClient(fetchFn, clock, 3_000),
      clock.now,
    )
    assertEquals(result.enriched.map((e) => e.id).sort(), [1, 3])
    assertEquals(result.unfinished, [2])
    assertEquals(result.stopped, null)
  },
)

Deno.test('a thrown non-Error stops with its text', async () => {
  const fetchFn = ((input: URL | string) =>
    new URL(input).host === 'wikimedia.org'
      ? Promise.reject('boom')
      : fakeWikimedia().fetchFn(input)) as typeof fetch
  const result = await enrichPlaces([cornPalace], testClient(fetchFn))
  assertEquals(result.stopped?.error, 'wikimedia.org: boom')
})

Deno.test('enrichment scores an item’s signals', () => {
  const item = {
    sitelinks: 9,
    image: 'A.jpg',
    commonsCategory: null,
    enwikiTitle: null,
  }
  const e = enrichment(cornPalace, item)
  assertEquals(e.image_file, null) // not on Commons
  assertAlmostEquals(
    e.score,
    scorePlace({ sitelinks: 9 }, 'tourism=attraction'),
  )
})
