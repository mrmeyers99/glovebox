import { assert, assertEquals } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { invokeRequest, userToken } from '../_shared/test_env.ts'
import { createHandler, handler as defaultHandler } from './index.ts'
import type { PlaceRow, TileStatus } from './store.ts'

const A = '43.5_-98.5'
const B = '42.0_-92.5'

const corn: PlaceRow = {
  id: 1,
  source: 'osm',
  source_id: 'way/1',
  wikidata: 'Q1048837',
  name: 'Corn Palace',
  kind: 'attraction',
  category: 'tourism=attraction',
  lat: 43.714,
  lng: -98.0298,
  tile_key: A,
  tags: {},
  image_file: null,
  image_credit: null,
  image_license: null,
  score: 5.1,
  parent_place_id: null,
  parent_score: null,
}

/**
 * An in-memory place_tiles queue (insert if missing, never change an existing
 * tile) and places table, recording what each request read.
 */
function setup(
  tiles: Record<string, TileStatus> = {},
  rows = [corn],
  scoringTiles: string[] = [],
) {
  const table = new Map(Object.entries(tiles))
  const loads: { supabase: SupabaseClient; tiles: string[]; kind: string }[] =
    []
  const handler = createHandler({
    queue(keys) {
      for (const key of keys) if (!table.has(key)) table.set(key, 'pending')
      return Promise.resolve(new Map(keys.map((k) => [k, table.get(k)!])))
    },
    load(supabase, keys, kind) {
      loads.push({ supabase, tiles: keys, kind })
      return Promise.resolve(
        rows.filter((r) => keys.includes(r.tile_key) && r.kind === kind),
      )
    },
    scoring(_supabase, keys) {
      return Promise.resolve(
        new Set(scoringTiles.filter((key) => keys.includes(key))),
      )
    },
  })
  return { handler, table, loads }
}

async function post(
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  { method = 'POST', token }: { method?: string; token?: string | null } = {},
) {
  const auth =
    token === null ? undefined : (token ?? (await userToken('user-1')))
  const res = await handler(invokeRequest(auth, method, body, 'suggestions'))
  return { status: res.status, body: await res.json() }
}

Deno.test('requires a signed-in user', async () => {
  const { handler, table } = setup()
  const res = await post(
    handler,
    { tiles: [A], kind: 'attraction' },
    { token: null },
  )
  assertEquals(res, { status: 401, body: { error: 'Sign in required' } })
  assertEquals(table.size, 0)
})

Deno.test('accepts only POST with a valid JSON body', async () => {
  const { handler } = setup()
  assertEquals((await post(handler, undefined, { method: 'GET' })).status, 405)

  const req = invokeRequest(
    await userToken('user-1'),
    'POST',
    undefined,
    'suggestions',
  )
  const notJson = await handler(
    new Request(req, { body: '{nope', headers: req.headers }),
  )
  assertEquals(notJson.status, 400)
  assertEquals(await notJson.json(), { error: 'Body must be JSON' })

  const invalid = await post(handler, { tiles: ['nope'], kind: 'attraction' })
  assertEquals(invalid.status, 400)
})

Deno.test(
  'queues missing tiles once and answers filled ones from the cache',
  async () => {
    // Any external call would fail the test.
    const realFetch = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new Error('no network in tests'))
    try {
      const { handler, table, loads } = setup({ [A]: 'done' })
      const first = await post(handler, {
        tiles: [A, B, A],
        kind: 'attraction',
      })
      assertEquals(first.status, 200)
      assertEquals(first.body.pending, [B])
      assertEquals(first.body.failed, [])
      assertEquals(
        first.body.places.map((p: { name: string }) => p.name),
        ['Corn Palace'],
      )
      assertEquals(first.body.places[0].percentile, 1)
      assertEquals(table.get(B), 'pending')
      // Only the done tile (and its neighbours, for ranking) is read.
      assertEquals(loads[0].tiles.length, 9)
      assert(loads[0].tiles.includes(A) && !loads[0].tiles.includes(B))
      assertEquals(loads[0].kind, 'attraction')
      // Read as the caller, not with the service role.
      assert(typeof loads[0].supabase.rpc === 'function')

      const again = await post(handler, { tiles: [A, B], kind: 'attraction' })
      assertEquals(again.body, first.body)
      assertEquals(table.size, 2)
    } finally {
      globalThis.fetch = realFetch
    }
  },
)

Deno.test(
  'a done tile is never downgraded; failed tiles are reported',
  async () => {
    const { handler, table } = setup({ [A]: 'done', [B]: 'failed' })
    const res = await post(handler, { tiles: [A, B], kind: 'campground' })
    assertEquals(res.body, {
      places: [],
      pending: [],
      failed: [B],
      scoring: [],
    })
    assertEquals(table.get(A), 'done')
    assertEquals(table.get(B), 'failed')
  },
)

Deno.test(
  'reports done tiles whose places are still being scored',
  async () => {
    const { handler } = setup({ [A]: 'done' }, [corn], [A, B])
    const res = await post(handler, { tiles: [A, B], kind: 'attraction' })
    assertEquals(res.body.scoring, [A])
    assertEquals(res.body.pending, [B])
    assertEquals(res.body.places.length, 1)
  },
)

Deno.test('the deployed handler answers an empty request', async () => {
  const res = await post(defaultHandler, { tiles: [], kind: 'attraction' })
  assertEquals(res, {
    status: 200,
    body: { places: [], pending: [], failed: [], scoring: [] },
  })
})
