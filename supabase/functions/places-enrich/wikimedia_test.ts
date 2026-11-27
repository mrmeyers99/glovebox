import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert'
import {
  DEFAULT_RETRY_AFTER_MS,
  MAX_RETRY_AFTER_MS,
  OutOfTimeError,
  RateLimitedError,
  RequestError,
  retryAfterMs,
  wikimediaClient,
} from './wikimedia.ts'
import { fakeClock, testClient } from './testdata/fake_wikimedia.ts'

function replies(...responses: (Response | Error)[]) {
  const requests: Request[] = []
  const fetchFn = ((input: URL | string, init?: RequestInit) => {
    requests.push(new Request(input, init))
    const next = responses.shift() ?? Response.json({ ok: true })
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }) as typeof fetch
  return { requests, fetchFn }
}

const busy = (status: number, retryAfter?: string) =>
  new Response('slow down', {
    status,
    headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
  })

Deno.test('sends the User-Agent and parses JSON', async () => {
  const { requests, fetchFn } = replies(Response.json({ a: 1 }))
  const client = testClient(fetchFn)
  assertEquals(
    await client.getJson('https://commons.wikimedia.org/w/api.php?x=1'),
    { a: 1 },
  )
  assertEquals(
    requests[0].headers.get('user-agent'),
    'Glovebox/1.0 (road-trip planner; ops@example.com)',
  )
  assertEquals(requests[0].headers.get('accept'), 'application/json')
  assertEquals(requests[0].method, 'GET')
})

Deno.test(
  'posts a form body with its content type and accept header',
  async () => {
    const { requests, fetchFn } = replies()
    await testClient(fetchFn).getJson('https://query.wikidata.org/sparql', {
      method: 'POST',
      body: new URLSearchParams({ query: 'ASK {}' }),
      accept: 'application/sparql-results+json',
    })
    assertEquals(requests[0].method, 'POST')
    assertEquals(
      requests[0].headers.get('content-type'),
      'application/x-www-form-urlencoded',
    )
    assertEquals(
      requests[0].headers.get('accept'),
      'application/sparql-results+json',
    )
    assertEquals(await requests[0].text(), 'query=ASK+%7B%7D')
  },
)

Deno.test('waits between requests to one host, not across hosts', async () => {
  const clock = fakeClock()
  const client = testClient(replies().fetchFn, clock)
  await client.getJson('https://wikimedia.org/a')
  await client.getJson('https://query.wikidata.org/sparql')
  clock.time += 500
  await client.getJson('https://wikimedia.org/b')
  await client.getJson('https://example.org/c')
  await client.getJson('https://example.org/d')
  assertEquals(clock.sleeps, [2000, 1000])
})

Deno.test('waits out a short Retry-After and retries once', async () => {
  const clock = fakeClock()
  const { requests, fetchFn } = replies(
    busy(429, '3'),
    Response.json({ ok: 1 }),
  )
  const client = testClient(fetchFn, clock)
  assertEquals(
    await client.getJson('https://commons.wikimedia.org/w/api.php'),
    { ok: 1 },
  )
  assertEquals(requests.length, 2)
  assertEquals(clock.sleeps, [3000])
})

Deno.test('a second rate limit in a row throws RateLimitedError', async () => {
  const clock = fakeClock()
  const { fetchFn } = replies(busy(503, '1'), busy(503, '2'))
  const error = await assertRejects(
    () => testClient(fetchFn, clock).getJson('https://wikimedia.org/x'),
    RateLimitedError,
  )
  assertEquals(error.status, 503)
  assertEquals(error.host, 'wikimedia.org')
  assertEquals(error.retryAt, clock.time + 2000)
})

Deno.test('a long Retry-After throws at once, with when to retry', async () => {
  const clock = fakeClock()
  const start = clock.time
  const { requests, fetchFn } = replies(busy(429, '22'))
  const error = await assertRejects(
    () => testClient(fetchFn, clock).getJson('https://wikimedia.org/x'),
    RateLimitedError,
  )
  assertEquals(error.retryAt, start + 22_000)
  assertEquals(
    error.message,
    'wikimedia.org: HTTP 429, retry after 2026-11-27T00:00:22.000Z',
  )
  assertEquals(requests.length, 1)
})

Deno.test('a Retry-After past the deadline throws at once', async () => {
  const clock = fakeClock()
  const { fetchFn } = replies(busy(429, '5'))
  await assertRejects(
    () => testClient(fetchFn, clock, 4000).getJson('https://wikimedia.org/x'),
    RateLimitedError,
  )
  assertEquals(clock.sleeps, [])
})

Deno.test('a 404 is null when allowed, an error otherwise', async () => {
  const { fetchFn } = replies(
    new Response('', { status: 404 }),
    new Response('', { status: 404 }),
  )
  const client = testClient(fetchFn)
  assertEquals(
    await client.getJson('https://wikimedia.org/x', { allow404: true }),
    null,
  )
  const error = await assertRejects(
    () => client.getJson('https://wikimedia.org/y'),
    RequestError,
  )
  assertEquals(error.status, 404)
  assertEquals(error.message, 'wikimedia.org: HTTP 404')
})

Deno.test(
  'network errors, timeouts and bad JSON are RequestErrors',
  async () => {
    const { fetchFn } = replies(
      new TypeError('connection reset'),
      new DOMException('signal timed out', 'TimeoutError'),
      new Response('<html>', { status: 200 }),
    )
    const client = testClient(fetchFn)
    const reset = await assertRejects(
      () => client.getJson('https://a.example/'),
      RequestError,
    )
    assertEquals(
      [reset.message, reset.status],
      ['a.example: connection reset', undefined],
    )
    const timeout = await assertRejects(
      () => client.getJson('https://b.example/'),
      RequestError,
    )
    assertEquals(timeout.message, 'b.example: timed out')
    const bad = await assertRejects(
      () => client.getJson('https://c.example/'),
      RequestError,
    )
    assertEquals(bad.status, 200)
  },
)

Deno.test('a thrown non-Error is reported as text', async () => {
  const fetchFn = (() => Promise.reject('boom')) as typeof fetch
  const error = await assertRejects(
    () => testClient(fetchFn).getJson('https://a.example/'),
    RequestError,
  )
  assertEquals(error.message, 'a.example: boom')
})

Deno.test('no request starts after the deadline', async () => {
  const clock = fakeClock()
  const { requests, fetchFn } = replies()
  const client = testClient(fetchFn, clock, 500)
  assertEquals(client.hasTime(), true)
  await client.getJson('https://commons.wikimedia.org/a')
  // The throttle waits 1 s, past the deadline.
  const error = await assertRejects(() =>
    client.getJson('https://commons.wikimedia.org/b'),
  )
  assertInstanceOf(error, OutOfTimeError)
  assertEquals(client.hasTime(), false)
  assertEquals(requests.length, 1)
})

Deno.test('works with the real clock and sleep', async () => {
  const { fetchFn } = replies()
  const client = wikimediaClient({
    userAgent: 'test',
    fetchFn,
    deadline: Date.now() + 10_000,
  })
  assertEquals(await client.getJson('https://x.example/'), { ok: true })
  assertEquals(await client.getJson('https://y.example/'), { ok: true })
  // The real sleep, briefly: x.example's next request waits up to 1 s.
  const start = Date.now()
  await client.getJson('https://x.example/')
  assertEquals(Date.now() - start >= 900, true)
})

Deno.test(
  'retryAfterMs reads seconds and HTTP dates, with a default and a cap',
  () => {
    const now = Date.parse('2026-11-27T00:00:00Z')
    assertEquals(retryAfterMs('22', now), 22_000)
    assertEquals(retryAfterMs(' 0 ', now), 0)
    assertEquals(retryAfterMs('Fri, 27 Nov 2026 00:01:00 GMT', now), 60_000)
    assertEquals(retryAfterMs('Thu, 26 Nov 2026 00:00:00 GMT', now), 0)
    assertEquals(retryAfterMs(null, now), DEFAULT_RETRY_AFTER_MS)
    assertEquals(retryAfterMs('soon', now), DEFAULT_RETRY_AFTER_MS)
    assertEquals(retryAfterMs('999999', now), MAX_RETRY_AFTER_MS)
  },
)
