import '../_shared/test_env.ts'
import { assertEquals, assertRejects } from '@std/assert'
import { createClient } from '@supabase/supabase-js'
import { type EnrichedPlace, supabaseEnrichStore } from './store.ts'

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
  return { calls, store: supabaseEnrichStore(() => client) }
}

const ok = (body: unknown) => Response.json(body)
const failure = () =>
  Response.json(
    { message: 'permission denied', code: '42501' },
    { status: 403 },
  )

const row: EnrichedPlace = {
  id: 1,
  wikidata: 'Q1135328',
  sitelinks: 14,
  pageviews_month: 9000,
  commons_files: 120,
  image_file: 'Corn Palace 2017.jpg',
  image_credit: 'Jane Doe',
  image_license: 'CC BY-SA 4.0',
  score: 6.1,
}

Deno.test('claim calls claim_places_to_enrich', async () => {
  // PostgREST may send bigint ids as strings.
  const { calls, store } = fakeClient(() =>
    ok([{ id: '7', wikidata: null, category: 'tourism=zoo' }]),
  )
  assertEquals(await store.claim(20, 1000), [
    { id: 7, wikidata: null, category: 'tourism=zoo' },
  ])
  assertEquals(calls[0].url.pathname, '/rest/v1/rpc/claim_places_to_enrich')
  assertEquals(calls[0].body, { p_linked_limit: 20, p_plain_limit: 1000 })
})

Deno.test('claim of nothing is an empty list', async () => {
  const { store } = fakeClient(() => ok(null))
  assertEquals(await store.claim(1, 1), [])
})

Deno.test('store calls store_place_enrichment', async () => {
  const { calls, store } = fakeClient(() => ok(1))
  assertEquals(await store.store([row]), 1)
  assertEquals(calls[0].url.pathname, '/rest/v1/rpc/store_place_enrichment')
  assertEquals(calls[0].body, { p_places: [row] })
})

Deno.test('release sets when the places may be claimed again', async () => {
  const { calls, store } = fakeClient(() => new Response(null, { status: 204 }))
  await store.release([1, 2], new Date('2026-11-27T01:00:00Z'))
  assertEquals(calls[0].method, 'PATCH')
  assertEquals(calls[0].url.pathname, '/rest/v1/places')
  assertEquals(calls[0].url.searchParams.get('id'), 'in.(1,2)')
  assertEquals(calls[0].body, {
    enrich_next_attempt_at: '2026-11-27T01:00:00.000Z',
  })
})

Deno.test('pause upserts the worker’s pause', async () => {
  const { calls, store } = fakeClient(() => new Response(null, { status: 201 }))
  await store.pause(new Date('2026-11-27T01:00:00Z'), 'HTTP 429')
  assertEquals(calls[0].method, 'POST')
  assertEquals(calls[0].url.pathname, '/rest/v1/worker_pauses')
  assertEquals(calls[0].body, {
    worker: 'places-enrich',
    paused_until: '2026-11-27T01:00:00.000Z',
    reason: 'HTTP 429',
  })
})

Deno.test('database errors are thrown', async () => {
  const { store } = fakeClient(failure)
  await assertRejects(() => store.claim(1, 1))
  await assertRejects(() => store.store([row]))
  await assertRejects(() => store.release([1], new Date()))
  await assertRejects(() => store.pause(new Date(), 'x'))
})
