import { assertEquals, assertRejects } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadPlaces,
  MAX_PLACES,
  PAGE_SIZE,
  type PlaceRow,
  queueTiles,
} from './store.ts'

interface Call {
  fn: string
  args: unknown
  range?: [number, number]
}

/**
 * A fake client whose rpc() answers with `answer(call)`, both awaited
 * directly and after .range(), recording each call.
 */
function fakeClient(answer: (call: Call) => { data: unknown; error: unknown }) {
  const calls: Call[] = []
  const client = {
    rpc(fn: string, args: unknown) {
      const call: Call = { fn, args }
      return {
        range(from: number, to: number) {
          call.range = [from, to]
          calls.push(call)
          return Promise.resolve(answer(call))
        },
        then<T>(resolve: (value: unknown) => T) {
          calls.push(call)
          return Promise.resolve(answer(call)).then(resolve)
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

Deno.test('queueTiles returns each tile status', async () => {
  const { client, calls } = fakeClient(() => ({
    data: [
      { tile_key: '42.5_-96.5', status: 'done' },
      { tile_key: '43.0_-96.5', status: 'pending' },
    ],
    error: null,
  }))
  const statuses = await queueTiles(client, ['42.5_-96.5', '43.0_-96.5'])
  assertEquals(
    [...statuses],
    [
      ['42.5_-96.5', 'done'],
      ['43.0_-96.5', 'pending'],
    ],
  )
  assertEquals(calls, [
    {
      fn: 'queue_place_tiles',
      args: { p_tile_keys: ['42.5_-96.5', '43.0_-96.5'] },
    },
  ])
})

Deno.test('queueTiles skips the database for no tiles', async () => {
  const { client, calls } = fakeClient(() => ({ data: null, error: null }))
  assertEquals((await queueTiles(client, [])).size, 0)
  assertEquals(calls.length, 0)
})

Deno.test('queueTiles throws database errors', async () => {
  const { client } = fakeClient(() => ({
    data: null,
    error: new Error('boom'),
  }))
  await assertRejects(() => queueTiles(client, ['42.5_-96.5']), Error, 'boom')
})

const rows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: from + i }) as PlaceRow)

Deno.test('loadPlaces reads a page at a time', async () => {
  const { client, calls } = fakeClient(({ range }) => ({
    data: range![0] === 0 ? rows(PAGE_SIZE) : rows(3, PAGE_SIZE),
    error: null,
  }))
  const places = await loadPlaces(client, ['42.5_-96.5'], 'campground')
  assertEquals(places.length, PAGE_SIZE + 3)
  assertEquals(
    calls.map((c) => [c.fn, c.args, c.range]),
    [
      [
        'suggestion_places',
        { p_tile_keys: ['42.5_-96.5'], p_kind: 'campground' },
        [0, PAGE_SIZE - 1],
      ],
      [
        'suggestion_places',
        { p_tile_keys: ['42.5_-96.5'], p_kind: 'campground' },
        [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      ],
    ],
  )
})

Deno.test('loadPlaces stops at MAX_PLACES', async () => {
  const { client, calls } = fakeClient(({ range }) => ({
    data: rows(PAGE_SIZE, range![0]),
    error: null,
  }))
  const places = await loadPlaces(client, ['42.5_-96.5'], 'attraction')
  assertEquals(places.length, MAX_PLACES)
  assertEquals(calls.length, MAX_PLACES / PAGE_SIZE)
})

Deno.test('loadPlaces handles no tiles, no rows and errors', async () => {
  const empty = fakeClient(() => ({ data: null, error: null }))
  assertEquals(await loadPlaces(empty.client, [], 'attraction'), [])
  assertEquals(empty.calls.length, 0)
  assertEquals(await loadPlaces(empty.client, ['0.0_0.0'], 'attraction'), [])

  const failing = fakeClient(() => ({ data: null, error: new Error('nope') }))
  await assertRejects(
    () => loadPlaces(failing.client, ['0.0_0.0'], 'attraction'),
    Error,
    'nope',
  )
})
