import { invokeRequest, userToken } from '../_shared/test_env.ts'
import { assertEquals } from '@std/assert'
import { CATEGORY_BONUS } from '../_shared/places/mod.ts'
import { PLACE_RETRY_MS } from './enrich.ts'
import {
  createHandler,
  type Deps,
  LINKED_PER_RUN,
  PLAIN_PER_RUN,
} from './index.ts'
import type { EnrichedPlace, EnrichStore, PlaceToEnrich } from './store.ts'
import { fakeClock, fakeWikimedia } from './testdata/fake_wikimedia.ts'

Deno.env.set('CONTACT_EMAIL', 'ops@example.com')

const places: PlaceToEnrich[] = [
  { id: 1, wikidata: 'Q1135328', category: 'tourism=attraction' },
  { id: 2, wikidata: 'Q5432100', category: 'historic=archaeological_site' },
  { id: 5, wikidata: null, category: 'tourism=zoo' },
]

function memoryStore(
  due: PlaceToEnrich[] = places,
  overrides: Partial<EnrichStore> = {},
) {
  const log = {
    claims: [] as [number, number][],
    stored: [] as EnrichedPlace[],
    released: [] as { ids: number[]; retryAt: Date }[],
    paused: [] as { until: Date; reason: string }[],
  }
  const store: EnrichStore = {
    claim(linked, plain) {
      log.claims.push([linked, plain])
      return Promise.resolve(due)
    },
    store(rows) {
      log.stored.push(...rows)
      return Promise.resolve(rows.length)
    },
    release(ids, retryAt) {
      log.released.push({ ids, retryAt })
      return Promise.resolve()
    },
    pause(until, reason) {
      log.paused.push({ until, reason })
      return Promise.resolve()
    },
    ...overrides,
  }
  return { store, log }
}

function cronRequest(method = 'POST'): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/places-enrich', {
    method,
    headers: { apikey: 'sb_secret_test', 'content-type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
  })
}

function run(deps: Deps, req = cronRequest()) {
  const clock = fakeClock()
  return createHandler({ now: clock.now, sleep: clock.sleep, ...deps })(req)
}

Deno.test('enriches claimed places and stores them', async () => {
  const { store, log } = memoryStore()
  const { requests, fetchFn } = fakeWikimedia()
  const res = await run({ store, fetchFn })
  assertEquals(res.status, 200)
  assertEquals(await res.json(), {
    enriched: 3,
    unfinished: 0,
    deferred: 0,
    paused_until: null,
  })
  assertEquals(log.claims, [[LINKED_PER_RUN, PLAIN_PER_RUN]])
  assertEquals(
    log.stored.find((p) => p.id === 5)?.score,
    CATEGORY_BONUS['tourism=zoo'],
  )
  assertEquals(log.stored.find((p) => p.id === 1)?.sitelinks, 14)
  assertEquals(log.released, [])
  assertEquals(log.paused, [])
  for (const r of requests) {
    assertEquals(
      r.headers.get('user-agent'),
      'Glovebox/1.0 (road-trip planner; ops@example.com)',
    )
  }
})

Deno.test(
  'on a rate limit: pauses, stores what it finished, hands the rest back',
  async () => {
    const { store, log } = memoryStore()
    let calls = 0
    const { fetchFn } = fakeWikimedia({
      pageviews: () =>
        ++calls === 1
          ? Response.json({ items: [] })
          : new Response('', {
              status: 429,
              headers: { 'retry-after': '600' },
            }),
    })
    const clock = fakeClock()
    const res = await createHandler({
      store,
      fetchFn,
      now: clock.now,
      sleep: clock.sleep,
    })(cronRequest())
    const body = await res.json()
    assertEquals([body.enriched, body.unfinished, body.deferred], [2, 1, 0])
    assertEquals(
      body.paused_until,
      new Date(clock.time + 600_000).toISOString(),
    )
    assertEquals(log.paused.length, 1)
    assertEquals(log.paused[0].until.toISOString(), body.paused_until)
    assertEquals(
      log.paused[0].reason.startsWith('wikimedia.org: HTTP 429'),
      true,
    )
    assertEquals(log.stored.map((p) => p.id).sort(), [1, 5])
    // Due again at once; the pause keeps it from being claimed until then.
    assertEquals(log.released, [{ ids: [2], retryAt: new Date(clock.time) }])
  },
)

Deno.test('a place whose own request fails is retried later', async () => {
  const { store, log } = memoryStore()
  const { fetchFn } = fakeWikimedia({
    pageviews: () => new Response('', { status: 400 }),
  })
  const clock = fakeClock()
  const res = await createHandler({
    store,
    fetchFn,
    now: clock.now,
    sleep: clock.sleep,
  })(cronRequest())
  assertEquals((await res.json()).deferred, 2)
  assertEquals(log.released, [
    { ids: [1, 2], retryAt: new Date(clock.time + PLACE_RETRY_MS) },
  ])
})

Deno.test('does nothing when no place is due', async () => {
  const { store, log } = memoryStore([])
  const { requests, fetchFn } = fakeWikimedia()
  const res = await run({ store, fetchFn })
  assertEquals(await res.json(), {
    enriched: 0,
    unfinished: 0,
    deferred: 0,
    paused_until: null,
  })
  assertEquals(requests.length, 0)
  assertEquals(log.stored, [])
})

Deno.test('a database error is a 500', async () => {
  const { store } = memoryStore(places, {
    store: () => Promise.reject(new Error('deadlock detected')),
  })
  const res = await run({ store, fetchFn: fakeWikimedia().fetchFn })
  assertEquals(res.status, 500)
})

Deno.test(
  'rejects signed-in users and callers without a secret key',
  async () => {
    const { store, log } = memoryStore()
    const user = await userToken('00000000-0000-0000-0000-000000000001')
    for (const req of [
      invokeRequest(user, 'POST', {}, 'places-enrich'),
      invokeRequest(undefined, 'POST', {}, 'places-enrich'),
    ]) {
      const res = await run({ store }, req)
      assertEquals(res.status, 401)
      assertEquals(await res.json(), { error: 'Service role required' })
    }
    assertEquals(log.claims, [])
  },
)

Deno.test('returns 405 for other methods', async () => {
  const res = await run({ store: memoryStore().store }, cronRequest('GET'))
  assertEquals(res.status, 405)
})

Deno.test(
  'returns 503 without CONTACT_EMAIL, before claiming anything',
  async () => {
    const { store, log } = memoryStore()
    Deno.env.delete('CONTACT_EMAIL')
    try {
      const res = await run({ store })
      assertEquals(res.status, 503)
      assertEquals(await res.json(), { error: 'CONTACT_EMAIL is not set' })
      assertEquals(log.claims, [])
    } finally {
      Deno.env.set('CONTACT_EMAIL', 'ops@example.com')
    }
  },
)
