import { invokeRequest, userToken } from '../_shared/test_env.ts'
import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  createHandler,
  type Deps,
  MAX_TILES_PER_RUN,
  START_BEFORE_MS,
} from './index.ts'
import type { ClaimedTile, StoredPlace, TileStore } from './store.ts'
import fixture from './testdata/overpass_tile.json' with { type: 'json' }

Deno.env.set('CONTACT_EMAIL', 'ops@example.com')

/** An in-memory queue: `due` tiles are handed out in order. */
function memoryStore(due: string[], overrides: Partial<TileStore> = {}) {
  const stored = new Map<string, StoredPlace[]>()
  const failed: { tileKey: string; error: string; retryAt: Date }[] = []
  const queue = [...due]
  const store: TileStore = {
    claim(limit) {
      const tiles: ClaimedTile[] = queue
        .splice(0, limit)
        .map((tile_key) => ({ tile_key, attempts: 2 }))
      return Promise.resolve(tiles)
    },
    store(tileKey, places) {
      stored.set(tileKey, places)
      return Promise.resolve(places.length)
    },
    fail(tileKey, error, retryAt) {
      failed.push({ tileKey, error, retryAt })
      return Promise.resolve()
    },
    ...overrides,
  }
  return { store, stored, failed, queue }
}

function overpass(reply: () => Response = () => Response.json(fixture)) {
  const requests: Request[] = []
  const fetchFn = ((input: string, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Promise.resolve(reply())
  }) as typeof fetch
  return { requests, fetchFn }
}

/** A request like pg_cron's (pg_net), with the secret key. */
function cronRequest(method = 'POST'): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/places-worker', {
    method,
    headers: { apikey: 'sb_secret_test', 'content-type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
  })
}

function run(deps: Deps, req = cronRequest()) {
  return createHandler({ servers: ['https://overpass.example/api'], ...deps })(
    req,
  )
}

Deno.test('fills a due tile with its candidate places', async () => {
  const { store, stored } = memoryStore(['43.5_-98.5'])
  const { requests, fetchFn } = overpass()
  const res = await run({ store, fetchFn })
  assertEquals(res.status, 200)
  assertEquals(await res.json(), {
    tiles: [{ tile_key: '43.5_-98.5', status: 'done', places: 5 }],
  })

  assertEquals(requests.length, 1)
  assertEquals(
    requests[0].headers.get('user-agent'),
    'Glovebox/1.0 (road-trip planner; ops@example.com)',
  )
  const query = new URLSearchParams(await requests[0].text()).get('data')!
  assertStringIncludes(query, '[bbox:43.5,-98.5,44,-98]')

  const places = stored.get('43.5_-98.5')!
  // The Corn Palace node and building are one place; the reserve centred in
  // the next tile north is left to that tile.
  assertEquals(
    places.map((p) => p.source_id),
    ['node/101', 'node/104', 'node/105', 'way/202', 'relation/301'],
  )
  const cornPalace = places[0]
  assertEquals(cornPalace.wikidata, 'Q1135328')
  assertEquals(cornPalace.tags.website, 'https://cornpalace.com')
  const camp = places.find((p) => p.source_id === 'node/104')!
  assertEquals(camp.kind, 'campground')
  assertEquals(camp.parent_source_id, 'way/202')
  assertEquals(
    places.find((p) => p.source_id === 'way/202')!.parent_source_id,
    null,
  )
})

Deno.test(
  'fills up to MAX_TILES_PER_RUN tiles, one claim at a time',
  async () => {
    const tiles = ['43.5_-98.5', '43.5_-98.0', '43.5_-97.5', '43.5_-97.0']
    const { store, stored, queue } = memoryStore(tiles)
    const { fetchFn } = overpass(() => Response.json({ elements: [] }))
    const res = await run({ store, fetchFn })
    const body = await res.json()
    assertEquals(body.tiles.length, MAX_TILES_PER_RUN)
    assertEquals([...stored.keys()], tiles.slice(0, MAX_TILES_PER_RUN))
    assertEquals(queue, tiles.slice(MAX_TILES_PER_RUN))
  },
)

Deno.test('starts no tile after START_BEFORE_MS', async () => {
  const { store, queue } = memoryStore(['43.5_-98.5', '43.5_-98.0'])
  let clock = 0
  const { fetchFn } = overpass(() => {
    clock += START_BEFORE_MS
    return Response.json({ elements: [] })
  })
  const res = await run({ store, fetchFn, now: () => clock })
  assertEquals((await res.json()).tiles.length, 1)
  assertEquals(queue, ['43.5_-98.0'])
})

Deno.test('does nothing when no tile is due', async () => {
  const { store } = memoryStore([])
  const { requests, fetchFn } = overpass()
  const res = await run({ store, fetchFn })
  assertEquals(await res.json(), { tiles: [] })
  assertEquals(requests.length, 0)
})

Deno.test(
  'marks a tile failed with a back-off when Overpass fails',
  async () => {
    const { store, failed } = memoryStore(['43.5_-98.5'])
    const { fetchFn } = overpass(() => new Response('busy', { status: 429 }))
    const now = Date.parse('2026-11-27T00:00:00Z')
    const res = await run({ store, fetchFn, now: () => now })
    const body = await res.json()
    assertEquals(body.tiles[0].status, 'failed')
    assertStringIncludes(body.tiles[0].error, 'overpass.example: HTTP 429')
    // Second failure in a row: retried in an hour.
    assertEquals(failed.length, 1)
    assertEquals(failed[0].retryAt.toISOString(), '2026-11-27T01:00:00.000Z')
  },
)

Deno.test('marks a tile failed when storing fails', async () => {
  const { store, failed } = memoryStore(['43.5_-98.5'], {
    store: () => Promise.reject(new Error('deadlock detected')),
  })
  const { fetchFn } = overpass()
  const res = await run({ store, fetchFn })
  assertEquals((await res.json()).tiles[0], {
    tile_key: '43.5_-98.5',
    status: 'failed',
    error: 'deadlock detected',
  })
  assertEquals(failed[0].error, 'deadlock detected')
})

Deno.test('still answers when marking a tile failed fails', async () => {
  const { store } = memoryStore(['43.5_-98.5'], {
    store: () => Promise.reject('not an Error'),
    fail: () => Promise.reject(new Error('database down')),
  })
  const res = await run({ store, fetchFn: overpass().fetchFn })
  assertEquals((await res.json()).tiles[0].error, 'not an Error')
})

Deno.test(
  'rejects signed-in users and callers without a secret key',
  async () => {
    const { store, queue } = memoryStore(['43.5_-98.5'])
    const user = await userToken('00000000-0000-0000-0000-000000000001')
    for (const req of [
      invokeRequest(user, 'POST', {}, 'places-worker'),
      invokeRequest(undefined, 'POST', {}, 'places-worker'),
    ]) {
      const res = await run({ store }, req)
      assertEquals(res.status, 401)
      assertEquals(await res.json(), { error: 'Service role required' })
    }
    assertEquals(queue, ['43.5_-98.5'])
  },
)

Deno.test('returns 405 for other methods', async () => {
  const res = await run({ store: memoryStore([]).store }, cronRequest('GET'))
  assertEquals(res.status, 405)
})

Deno.test(
  'returns 503 without CONTACT_EMAIL, before claiming anything',
  async () => {
    const { store, queue } = memoryStore(['43.5_-98.5'])
    Deno.env.delete('CONTACT_EMAIL')
    try {
      const res = await run({ store })
      assertEquals(res.status, 503)
    } finally {
      Deno.env.set('CONTACT_EMAIL', 'ops@example.com')
    }
    assertEquals(queue, ['43.5_-98.5'])
  },
)
