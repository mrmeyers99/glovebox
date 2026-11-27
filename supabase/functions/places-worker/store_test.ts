import '../_shared/test_env.ts'
import { assertEquals, assertRejects } from '@std/assert'
import { createClient } from '@supabase/supabase-js'
import { type StoredPlace, supabaseTileStore } from './store.ts'

interface Call {
  method: string
  url: URL
  body: unknown
}

/** A supabase-js client whose requests go to `reply` instead of the network. */
function fakeClient(reply: (call: Call) => Response) {
  const calls: Call[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const text = await request.text()
    const call = {
      method: request.method,
      url: new URL(request.url),
      body: text ? JSON.parse(text) : null,
    }
    calls.push(call)
    return reply(call)
  }) as typeof fetch
  const client = createClient('http://127.0.0.1:54321', 'sb_secret_test', {
    global: { fetch: fetchFn },
    auth: { persistSession: false },
  })
  return { calls, store: supabaseTileStore(() => client) }
}

const ok = (body: unknown) => Response.json(body)
const failure = () =>
  Response.json(
    { message: 'permission denied', code: '42501' },
    { status: 403 },
  )

const place: StoredPlace = {
  source_id: 'node/1',
  name: 'Corn Palace',
  kind: 'attraction',
  category: 'tourism=attraction',
  lat: 43.71,
  lng: -98.03,
  wikidata: 'Q1135328',
  tags: {},
  parent_source_id: null,
}

Deno.test('claim calls claim_place_tiles', async () => {
  const { calls, store } = fakeClient(() =>
    ok([{ tile_key: '43.5_-98.5', attempts: 1 }]),
  )
  assertEquals(await store.claim(2), [{ tile_key: '43.5_-98.5', attempts: 1 }])
  assertEquals(calls[0].method, 'POST')
  assertEquals(calls[0].url.pathname, '/rest/v1/rpc/claim_place_tiles')
  assertEquals(calls[0].body, { p_limit: 2 })
})

Deno.test('claim returns nothing when no tile is due', async () => {
  const { store } = fakeClient(() => ok(null))
  assertEquals(await store.claim(1), [])
})

Deno.test('store calls store_place_tile', async () => {
  const { calls, store } = fakeClient(() => ok(1))
  assertEquals(await store.store('43.5_-98.5', [place]), 1)
  assertEquals(calls[0].url.pathname, '/rest/v1/rpc/store_place_tile')
  assertEquals(calls[0].body, { p_tile_key: '43.5_-98.5', p_places: [place] })
})

Deno.test('fail marks the tile failed with its retry time', async () => {
  const { calls, store } = fakeClient(() => new Response(null, { status: 204 }))
  await store.fail(
    '43.5_-98.5',
    'Overpass unavailable',
    new Date('2026-11-27T02:00:00Z'),
  )
  assertEquals(calls[0].method, 'PATCH')
  assertEquals(calls[0].url.pathname, '/rest/v1/place_tiles')
  assertEquals(calls[0].url.searchParams.get('tile_key'), 'eq.43.5_-98.5')
  assertEquals(calls[0].url.searchParams.get('status'), 'eq.fetching')
  assertEquals(calls[0].body, {
    status: 'failed',
    error: 'Overpass unavailable',
    next_attempt_at: '2026-11-27T02:00:00.000Z',
  })
})

Deno.test('pause upserts the worker pause', async () => {
  const { calls, store } = fakeClient(() => new Response(null, { status: 201 }))
  await store.pause(new Date('2026-11-27T02:00:00Z'), 'Overpass unavailable')
  assertEquals(calls[0].method, 'POST')
  assertEquals(calls[0].url.pathname, '/rest/v1/worker_pauses')
  assertEquals(calls[0].body, {
    worker: 'places-worker',
    paused_until: '2026-11-27T02:00:00.000Z',
    reason: 'Overpass unavailable',
  })
})

Deno.test('database errors are thrown', async () => {
  const { store } = fakeClient(failure)
  await assertRejects(() => store.claim(1))
  await assertRejects(() => store.store('43.5_-98.5', []))
  await assertRejects(() => store.fail('43.5_-98.5', 'x', new Date()))
  await assertRejects(() => store.pause(new Date(), 'x'))
})
