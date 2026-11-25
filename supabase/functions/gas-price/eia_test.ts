import { assertEquals, assertRejects } from '@std/assert'
import {
  EIA_URL,
  eiaUrl,
  fetchLatestPrice,
  parseEiaResponse,
  US_REGULAR_SERIES,
} from './eia.ts'
// A real-shaped EIA v2 response, saved from the API.
import sample from './testdata/eia_weekly_us_regular.json' with { type: 'json' }

const row = (period: string, value: unknown, series = US_REGULAR_SERIES) => ({
  period,
  value,
  series,
})
const body = (...data: unknown[]) => ({ response: { data } })

Deno.test('parses the saved EIA sample', () => {
  assertEquals(parseEiaResponse(sample), {
    price_per_gallon: 3.061,
    as_of: '2026-11-23',
  })
})

Deno.test('accepts numeric values and rounds to 3 decimals', () => {
  assertEquals(parseEiaResponse(body(row('2026-11-16', 3.12345))), {
    price_per_gallon: 3.123,
    as_of: '2026-11-16',
  })
})

Deno.test('picks the newest period whatever the order', () => {
  assertEquals(
    parseEiaResponse(
      body(
        row('2026-11-09', '3.2'),
        row('2026-11-23', '3.0'),
        row('2026-11-16', '3.1'),
      ),
    ),
    { price_per_gallon: 3, as_of: '2026-11-23' },
  )
})

Deno.test('skips rows that are not usable', () => {
  assertEquals(
    parseEiaResponse(
      body(
        null,
        row('2026-11-30', null),
        row('2026-11-30', ''),
        row('2026-11-30', 'n/a'),
        row('2026-11-30', -1),
        row('2026-11', '3.5'),
        row('2026-11-30', '3.5', 'EMM_EPM0_PTE_NUS_DPG'),
        row('2026-11-23', '3.061'),
      ),
    ),
    { price_per_gallon: 3.061, as_of: '2026-11-23' },
  )
})

Deno.test('returns null for responses without a price', () => {
  for (const bad of [
    null,
    'nope',
    {},
    { response: {} },
    { response: { data: 'x' } },
    body(),
    { error: 'API_KEY_INVALID' },
  ]) {
    assertEquals(parseEiaResponse(bad), null)
  }
})

Deno.test('asks EIA for the latest weekly U.S. regular price', () => {
  const url = new URL(eiaUrl('k&y'))
  assertEquals(`${url.origin}${url.pathname}`, EIA_URL)
  const params = url.searchParams
  assertEquals(params.get('api_key'), 'k&y')
  assertEquals(params.get('frequency'), 'weekly')
  assertEquals(params.get('data[0]'), 'value')
  assertEquals(params.get('facets[series][]'), US_REGULAR_SERIES)
  assertEquals(params.get('sort[0][column]'), 'period')
  assertEquals(params.get('sort[0][direction]'), 'desc')
  assertEquals(params.get('length'), '1')
})

Deno.test(
  'fetchLatestPrice throws on HTTP errors and empty responses',
  async () => {
    const answer = (res: Response) =>
      (() => Promise.resolve(res)) as unknown as typeof fetch
    await assertRejects(() =>
      fetchLatestPrice('k', answer(new Response('nope', { status: 403 }))),
    )
    await assertRejects(() =>
      fetchLatestPrice('k', answer(Response.json(body()))),
    )
    assertEquals(await fetchLatestPrice('k', answer(Response.json(sample))), {
      price_per_gallon: 3.061,
      as_of: '2026-11-23',
    })
  },
)
