import { assertEquals } from '@std/assert'
import { invokeRequest, userToken } from '../_shared/test_env.ts'
import type { CachedGasPrice, GasPriceCache } from './cache.ts'
import { createHandler, isDue, REGION } from './index.ts'
import sample from './testdata/eia_weekly_us_regular.json' with { type: 'json' }

Deno.env.set('EIA_API_KEY', 'eia-test-key')

// Wednesday, two days after the 2026-11-23 price was published.
const NOW = new Date('2026-11-25T12:00:00Z')
const HOUR = 60 * 60 * 1000

function memoryCache(initial?: CachedGasPrice) {
  const rows = new Map<string, CachedGasPrice>()
  if (initial) rows.set(REGION, initial)
  const cache: GasPriceCache = {
    get: (region) => Promise.resolve(rows.get(region) ?? null),
    put: (region, price) => {
      rows.set(region, price)
      return Promise.resolve()
    },
  }
  return { cache, rows }
}

function fakeEia(answer: () => Response = () => Response.json(sample)) {
  const urls: string[] = []
  const fetchFn = ((input: string) => {
    urls.push(String(input))
    return Promise.resolve(answer())
  }) as typeof fetch
  return { urls, fetchFn }
}

function setup(
  initial?: CachedGasPrice,
  answer?: () => Response,
  now: Date = NOW,
) {
  const { cache, rows } = memoryCache(initial)
  const { urls, fetchFn } = fakeEia(answer)
  const handler = createHandler({ cache, fetchFn, now: () => now })
  return { handler, rows, urls }
}

async function call(
  handler: (req: Request) => Promise<Response>,
  method = 'POST',
) {
  const token = await userToken(crypto.randomUUID())
  const res = await handler(
    invokeRequest(token, method, undefined, 'gas-price'),
  )
  return { status: res.status, body: await res.json() }
}

const lastWeek: CachedGasPrice = {
  price_per_gallon: 3.1,
  as_of: '2026-11-16',
  fetched_at: '2026-11-17T09:00:00.000Z',
}

Deno.test('fetches from EIA and caches when nothing is cached', async () => {
  const { handler, rows, urls } = setup()
  const { status, body } = await call(handler)
  assertEquals(status, 200)
  assertEquals(body, {
    region: 'US',
    price_per_gallon: 3.061,
    as_of: '2026-11-23',
    fetched_at: NOW.toISOString(),
    stale: false,
  })
  assertEquals(urls.length, 1)
  assertEquals(new URL(urls[0]).searchParams.get('api_key'), 'eia-test-key')
  assertEquals(rows.get('US'), {
    price_per_gallon: 3.061,
    as_of: '2026-11-23',
    fetched_at: NOW.toISOString(),
  })
})

Deno.test('answers from the cache without calling EIA', async () => {
  const cached = { ...lastWeek, as_of: '2026-11-23', price_per_gallon: 3.05 }
  const { handler, urls } = setup(cached)
  for (const method of ['GET', 'POST']) {
    const { status, body } = await call(handler, method)
    assertEquals(status, 200)
    assertEquals(body.price_per_gallon, 3.05)
    assertEquals(body.stale, false)
  }
  assertEquals(urls.length, 0)
})

Deno.test('calls EIA about once a week across many requests', async () => {
  const start = Date.parse('2026-11-02T00:00:00Z') // a Monday
  let clock = new Date(start)
  const { cache } = memoryCache()
  const { urls, fetchFn } = fakeEia(() =>
    Response.json({
      response: { data: [{ period: latestPublished(clock), value: '3.000' }] },
    }),
  )
  const handler = createHandler({ cache, fetchFn, now: () => clock })
  // Four weeks of page loads, one every three hours.
  for (let i = 0; i < 4 * 7 * 8; i++) {
    clock = new Date(start + i * 3 * HOUR)
    const { status } = await call(handler)
    assertEquals(status, 200)
  }
  // The first load, then once each Tuesday (11-03, 11-10, 11-17, 11-24).
  assertEquals(urls.length, 5)
})

Deno.test('refreshes a price from more than a week ago', async () => {
  const { handler, rows, urls } = setup(lastWeek)
  const { body } = await call(handler)
  assertEquals(urls.length, 1)
  assertEquals(body.as_of, '2026-11-23')
  assertEquals(rows.get('US')?.price_per_gallon, 3.061)
})

Deno.test(
  'keeps serving the old price while EIA is down, retrying daily',
  async () => {
    const down = () => new Response('oops', { status: 500 })
    const { handler, rows, urls } = setup(lastWeek, down)
    const first = await call(handler)
    assertEquals(first.status, 200)
    assertEquals(first.body.price_per_gallon, 3.1)
    assertEquals(first.body.stale, true)
    assertEquals(rows.get('US')?.fetched_at, NOW.toISOString())
    await call(handler)
    assertEquals(urls.length, 1)

    const later = new Date(NOW.getTime() + 25 * HOUR)
    const retry = setup(rows.get('US'), undefined, later)
    const { body } = await call(retry.handler)
    assertEquals(retry.urls.length, 1)
    assertEquals(body.as_of, '2026-11-23')
  },
)

Deno.test('returns 503 when EIA fails and nothing is cached', async () => {
  const { handler, rows } = setup(undefined, () => Response.json({}))
  const { status, body } = await call(handler)
  assertEquals(status, 503)
  assertEquals(typeof body.error, 'string')
  assertEquals(rows.size, 0)
})

Deno.test(
  'returns 503 or the old price when the EIA key is not set',
  async () => {
    Deno.env.delete('EIA_API_KEY')
    try {
      const empty = setup()
      assertEquals((await call(empty.handler)).status, 503)
      const old = setup(lastWeek)
      const { status, body } = await call(old.handler)
      assertEquals(status, 200)
      assertEquals(body.stale, true)
      assertEquals(empty.urls.length + old.urls.length, 0)
    } finally {
      Deno.env.set('EIA_API_KEY', 'eia-test-key')
    }
  },
)

Deno.test('never replaces a newer cached price with an older one', async () => {
  const newer = {
    price_per_gallon: 2.9,
    as_of: '2026-11-30',
    fetched_at: '2026-12-01T00:00:00.000Z',
  }
  const at = new Date('2026-12-10T00:00:00Z')
  const { handler, rows } = setup(newer, undefined, at)
  const { body } = await call(handler)
  assertEquals(body.as_of, '2026-11-30')
  assertEquals(rows.get('US')?.fetched_at, at.toISOString())
})

Deno.test('returns 401 when signed out, without calling EIA', async () => {
  const { handler, urls } = setup()
  const res = await handler(
    invokeRequest(undefined, 'POST', undefined, 'gas-price'),
  )
  assertEquals(res.status, 401)
  await res.body?.cancel()
  assertEquals(urls.length, 0)
})

Deno.test('returns 405 for other methods', async () => {
  const { handler, urls } = setup()
  const { status } = await call(handler, 'DELETE')
  assertEquals(status, 405)
  assertEquals(urls.length, 0)
})

Deno.test('isDue', () => {
  const at = (iso: string) => new Date(iso)
  assertEquals(isDue(null, NOW), true)
  const cur = { ...lastWeek, as_of: '2026-11-23' }
  // The 2026-11-23 price is replaced from Tuesday 2026-12-01 (UTC).
  assertEquals(isDue(cur, at('2026-11-30T23:59:00Z')), false)
  assertEquals(isDue(cur, at('2026-12-01T00:00:00Z')), true)
  // ...but not within a day of the last attempt.
  const tried = { ...cur, fetched_at: '2026-12-01T06:00:00Z' }
  assertEquals(isDue(tried, at('2026-12-01T12:00:00Z')), false)
  assertEquals(isDue(tried, at('2026-12-02T06:00:00Z')), true)
  assertEquals(isDue({ ...cur, as_of: 'bad' }, NOW), true)
})

/**
 * The as_of (a Monday, YYYY-MM-DD) of EIA's newest price at `date`: this
 * week's Monday from Tuesday on (it's published Monday afternoon), otherwise
 * last week's.
 */
function latestPublished(date: Date): string {
  const day = date.getUTCDay() // 0 = Sunday
  const sinceMonday = (day + 6) % 7
  const back = sinceMonday >= 1 ? sinceMonday : sinceMonday + 7
  const monday = new Date(date.getTime() - back * 24 * HOUR)
  return monday.toISOString().slice(0, 10)
}
