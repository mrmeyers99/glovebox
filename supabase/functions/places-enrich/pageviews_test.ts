import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  averageMonthlyViews,
  fetchPageviews,
  pageviewsUrl,
} from './pageviews.ts'
import {
  fakeWikimedia,
  pageviewsAnswer,
  testClient,
} from './testdata/fake_wikimedia.ts'

const now = new Date('2026-11-27T01:00:00Z')

Deno.test('pageviewsUrl asks for the last 12 full months of user views', () => {
  assertEquals(
    pageviewsUrl('Corn_Palace', now),
    'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Corn_Palace/monthly/2025110100/2026103100',
  )
  // January: the year before, through December.
  assertEquals(
    pageviewsUrl(
      'Prehistoric Indian Village/Mitchell',
      new Date('2027-01-05T00:00:00Z'),
    ).split('/user/')[1],
    'Prehistoric_Indian_Village%2FMitchell/monthly/2026010100/2026123100',
  )
})

Deno.test(
  'averageMonthlyViews averages over 12 months, missing months as 0',
  async () => {
    assertEquals(
      averageMonthlyViews(await pageviewsAnswer(Array(12).fill(1000)).json()),
      1000,
    )
    assertEquals(
      averageMonthlyViews(await pageviewsAnswer([6000, 3001]).json()),
      750,
    )
    assertEquals(
      averageMonthlyViews({ items: [{ views: 'x' }, { views: -5 }, {}] }),
      0,
    )
    assertEquals(averageMonthlyViews({ items: [] }), 0)
    assertThrows(
      () => averageMonthlyViews({ detail: 'oops' }),
      Error,
      'no items',
    )
  },
)

Deno.test(
  'fetchPageviews: average views, 0 when there is no data',
  async () => {
    const { requests, fetchFn } = fakeWikimedia({
      pageviews: (r) =>
        r.url.includes('/Corn_Palace/')
          ? pageviewsAnswer(Array(12).fill(2400))
          : new Response('', { status: 404 }),
    })
    const client = testClient(fetchFn)
    assertEquals(await fetchPageviews('Corn_Palace', client, now), 2400)
    assertEquals(await fetchPageviews('New_article', client, now), 0)
    assertEquals(requests.length, 2)
  },
)

Deno.test('fetchPageviews passes other errors on', async () => {
  const { fetchFn } = fakeWikimedia({
    pageviews: () => new Response('', { status: 400 }),
  })
  await assertRejects(
    () => fetchPageviews('A', testClient(fetchFn), now),
    Error,
    'HTTP 400',
  )
})
