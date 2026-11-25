import { assert, assertEquals } from '@std/assert'
import { invokeRequest, userToken } from '../_shared/test_env.ts'
import type { RouteCache } from './cache.ts'
import { createHandler } from './index.ts'
import { type Leg, legKey, type Route } from './legs.ts'

Deno.env.set('ORS_API_KEY', 'ors-test-key')

const NOW = new Date('2026-11-25T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

/** An in-memory route_cache that records fetched_at like the table does. */
function memoryCache() {
  const rows = new Map<string, Route & { fetchedAt: Date }>()
  const cache: RouteCache = {
    lookup(legs, freshSince) {
      const found = new Map<string, Route>()
      for (const leg of legs) {
        const row = rows.get(legKey(leg))
        if (row && row.fetchedAt >= freshSince) {
          const { fetchedAt: _, ...route } = row
          found.set(legKey(leg), route)
        }
      }
      return Promise.resolve(found)
    },
    store(entries, fetchedAt) {
      for (const { leg, route } of entries) {
        rows.set(legKey(leg), { ...route, fetchedAt })
      }
      return Promise.resolve()
    },
  }
  return { cache, rows }
}

/** Waypoints ([lng, lat]) of each ORS request. */
type Calls = [number, number][][]

/**
 * A fake ORS: routes each leg as a straight line, 1,000 m and 60 s per leg,
 * unless `answer` returns a response for that request.
 */
function fakeOrs(
  answer?: (coords: [number, number][]) => Response | undefined,
) {
  const calls: Calls = []
  const headers: Headers[] = []
  const fetchFn = ((_input: string, init?: RequestInit) => {
    const { coordinates } = JSON.parse(String(init?.body)) as {
      coordinates: [number, number][]
    }
    calls.push(coordinates)
    headers.push(new Headers(init?.headers))
    const custom = answer?.(coordinates)
    if (custom) return Promise.resolve(custom)
    return Promise.resolve(
      Response.json({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {
              way_points: coordinates.map((_, i) => i),
              segments: coordinates
                .slice(1)
                .map(() => ({ distance: 1000, duration: 60 })),
            },
          },
        ],
      }),
    )
  }) as typeof fetch
  return { calls, headers, fetchFn }
}

const p = (lat: number, lng: number) => ({ lat, lng })
const A = p(40, -75)
const B = p(40.1, -75.1)
const C = p(40.2, -75.2)
const D = p(40.3, -75.3)

async function post(
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  token?: string,
) {
  const res = await handler(
    invokeRequest(
      token ?? (await userToken(crypto.randomUUID())),
      'POST',
      body,
      'route',
    ),
  )
  return { status: res.status, body: await res.json() }
}

function setup(answer?: Parameters<typeof fakeOrs>[0]) {
  const ors = fakeOrs(answer)
  const memory = memoryCache()
  const handler = createHandler({
    fetchFn: ors.fetchFn,
    cache: memory.cache,
    now: () => NOW,
  })
  return { ...ors, ...memory, handler }
}

Deno.test(
  'routes a trip in one ORS call, then serves it from cache',
  async () => {
    const { handler, calls, headers, rows } = setup()
    const pairs = [
      { from: A, to: B },
      { from: B, to: C },
      { from: C, to: D },
    ]
    const first = await post(handler, { pairs })
    assertEquals(first.status, 200)
    assertEquals(first.body.results.length, 3)
    for (const result of first.body.results) {
      assertEquals(result.distance_m, 1000)
      assertEquals(result.duration_s, 60)
      assertEquals(result.cached, false)
      assert(typeof result.geometry === 'string' && result.geometry !== '')
    }
    assertEquals(calls, [
      [
        [-75, 40],
        [-75.1, 40.1],
        [-75.2, 40.2],
        [-75.3, 40.3],
      ],
    ])
    assertEquals(headers[0].get('authorization'), 'ors-test-key')
    assertEquals(rows.size, 3)

    const again = await post(handler, { pairs })
    assertEquals(calls.length, 1, 'no ORS call for cached legs')
    assertEquals(
      again.body.results,
      first.body.results.map((r: object) => ({ ...r, cached: true })),
    )
  },
)

Deno.test(
  'rounds coordinates so nearby points share a cache entry',
  async () => {
    const { handler, calls, rows } = setup()
    await post(handler, { pairs: [{ from: p(40.000001, -75), to: B }] })
    assertEquals(calls[0][0], [-75, 40])
    assert(rows.has(legKey({ from: A, to: B })))
    const { body } = await post(handler, {
      pairs: [{ from: p(39.999999, -75.000002), to: B }],
    })
    assertEquals(body.results[0].cached, true)
    assertEquals(calls.length, 1)
  },
)

Deno.test('fetches only the misses, keeping input order', async () => {
  const { handler, calls } = setup()
  await post(handler, { pairs: [{ from: B, to: C }] })
  const { body } = await post(handler, {
    pairs: [
      { from: A, to: B },
      { from: B, to: C },
      { from: C, to: D },
      { from: A, to: B },
    ],
  })
  assertEquals(
    body.results.map((r: { cached: boolean }) => r.cached),
    [false, true, false, false],
  )
  // A→B and C→D aren't connected, so two requests.
  assertEquals(calls.slice(1), [
    [
      [-75, 40],
      [-75.1, 40.1],
    ],
    [
      [-75.2, 40.2],
      [-75.3, 40.3],
    ],
  ])
})

Deno.test('refetches entries older than 90 days', async () => {
  const { handler, calls, rows, cache } = setup()
  const leg: Leg = { from: A, to: B }
  await cache.store(
    [{ leg, route: { distance_m: 5, duration_s: 5, geometry: 'old' } }],
    new Date(NOW.getTime() - 91 * DAY),
  )
  const { body } = await post(handler, { pairs: [leg] })
  assertEquals(body.results[0].cached, false)
  assertEquals(body.results[0].distance_m, 1000)
  assertEquals(calls.length, 1)
  assertEquals(rows.get(legKey(leg))?.fetchedAt, NOW)

  await cache.store(
    [{ leg, route: { distance_m: 7, duration_s: 7, geometry: 'recent' } }],
    new Date(NOW.getTime() - 89 * DAY),
  )
  const cached = await post(handler, { pairs: [leg] })
  assertEquals(cached.body.results[0], {
    distance_m: 7,
    duration_s: 7,
    geometry: 'recent',
    cached: true,
  })
})

const noRoute = () =>
  Response.json(
    { error: { code: 2009, message: 'Route could not be found' } },
    { status: 404 },
  )

Deno.test('a leg with no route fails alone, not the batch', async () => {
  // Any request that includes the C→D leg has no route (e.g. across water).
  const crossesWater = (coords: [number, number][]) =>
    coords.some((c, i) => i > 0 && c[1] === 40.3 && coords[i - 1][1] === 40.2)
  const { handler, calls, rows } = setup((coords) =>
    crossesWater(coords) ? noRoute() : undefined,
  )
  const { status, body } = await post(handler, {
    pairs: [
      { from: A, to: B },
      { from: B, to: C },
      { from: C, to: D },
    ],
  })
  assertEquals(status, 200)
  assertEquals(body.results[0].distance_m, 1000)
  assertEquals(body.results[1].distance_m, 1000)
  assertEquals(body.results[2], {
    error: 'no_route',
    message: 'No driving route found between these points',
  })
  // One chain request, then one per leg.
  assertEquals(calls.length, 4)
  assertEquals(rows.size, 2, 'failures are not cached')
})

Deno.test('a too-long leg is reported as too_long', async () => {
  const { handler } = setup(() =>
    Response.json(
      { error: { code: 2004, message: 'distance must not be greater than' } },
      { status: 400 },
    ),
  )
  const { body } = await post(handler, { pairs: [{ from: A, to: B }] })
  assertEquals(body.results[0].error, 'too_long')
})

Deno.test('stops calling ORS once rate-limited', async () => {
  const { handler, calls } = setup(
    () => new Response('{"error":"Rate limit exceeded"}', { status: 429 }),
  )
  const { status, body } = await post(handler, {
    pairs: [
      { from: A, to: B },
      { from: C, to: D },
    ],
  })
  assertEquals(status, 200)
  assertEquals(calls.length, 1)
  assertEquals(
    body.results.map((r: { error: string }) => r.error),
    ['rate_limited', 'rate_limited'],
  )
})

Deno.test('does not leak ORS details when ORS fails', async () => {
  const { handler } = setup(
    () =>
      new Response('{"error":"Access to this API has been disallowed"}', {
        status: 403,
      }),
  )
  const { body } = await post(handler, { pairs: [{ from: A, to: B }] })
  assertEquals(body.results[0], {
    error: 'unavailable',
    message: 'Routing is unavailable right now',
  })
})

Deno.test('answers cached legs even when ORS is unreachable', async () => {
  const { cache } = memoryCache()
  const route = { distance_m: 3, duration_s: 4, geometry: 'g' }
  await cache.store([{ leg: { from: A, to: B }, route }], NOW)
  const failing = (() =>
    Promise.reject(new TypeError('network'))) as typeof fetch
  const handler = createHandler({ fetchFn: failing, cache, now: () => NOW })
  const { body } = await post(handler, {
    pairs: [
      { from: A, to: B },
      { from: C, to: D },
    ],
  })
  assertEquals(body.results, [
    { ...route, cached: true },
    { error: 'unavailable', message: 'Routing is unavailable right now' },
  ])
})

Deno.test('still routes when the cache cannot be read or written', async () => {
  const broken: RouteCache = {
    lookup: () => Promise.reject(new Error('db down')),
    store: () => Promise.reject(new Error('db down')),
  }
  const { fetchFn, calls } = fakeOrs()
  const handler = createHandler({ fetchFn, cache: broken, now: () => NOW })
  const { status, body } = await post(handler, { pairs: [{ from: A, to: B }] })
  assertEquals(status, 200)
  assertEquals(body.results[0].distance_m, 1000)
  assertEquals(calls.length, 1)
})

Deno.test('a leg to the same point needs no ORS call', async () => {
  const { handler, calls } = setup()
  const { body } = await post(handler, {
    pairs: [{ from: A, to: p(40.000001, -75) }],
  })
  assertEquals(body.results[0].distance_m, 0)
  assertEquals(body.results[0].duration_s, 0)
  assertEquals(calls.length, 0)
})

Deno.test('returns 401 when signed out, without calling ORS', async () => {
  const { handler, calls } = setup()
  const res = await handler(
    invokeRequest(undefined, 'POST', { pairs: [{ from: A, to: B }] }, 'route'),
  )
  assertEquals(res.status, 401)
  await res.body?.cancel()
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 for invalid input and 405 for GET', async () => {
  const { handler, calls } = setup()
  const bad = await post(handler, { pairs: [{ from: A }] })
  assertEquals(bad.status, 400)
  assert(typeof bad.body.error === 'string')
  const token = await userToken(crypto.randomUUID())
  const res = await handler(invokeRequest(token, 'GET', undefined, 'route'))
  assertEquals(res.status, 405)
  await res.body?.cancel()
  assertEquals(calls.length, 0)
})

Deno.test('reports unavailable when the ORS key is not set', async () => {
  Deno.env.delete('ORS_API_KEY')
  try {
    const { handler, calls } = setup()
    const { status, body } = await post(handler, {
      pairs: [{ from: A, to: B }],
    })
    assertEquals(status, 200)
    assertEquals(body.results[0].error, 'unavailable')
    assertEquals(calls.length, 0)
  } finally {
    Deno.env.set('ORS_API_KEY', 'ors-test-key')
  }
})
