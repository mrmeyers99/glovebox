// Ranked places along a trip for signed-in users (requirements §9,
// Discovery), from our own places cache. Never calls a third-party API: tiles
// that aren't cached yet are queued for the fill workers.
//
//   { tiles: string[] (at most MAX_TILES), kind: 'attraction' | 'campground' }
//   → { places: Suggestion[], pending: string[], failed: string[] }
//
// Tiles never asked for before are queued as 'pending' (once, even when many
// users ask at the same time). Existing tiles are left alone, so a 'done' tile
// is never downgraded: the fill worker refreshes old 'done' tiles itself, and
// they keep answering meanwhile. Places come from 'done' tiles only, ranked by
// local percentile among the places in each tile and its neighbours; child
// places whose parent is also suggested are left out. The client asks again
// for `pending` tiles later.
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../_shared/admin.ts'
import { requireUser } from '../_shared/auth.ts'
import { handle, HttpError, json } from '../_shared/http.ts'
import type { PlaceKind } from '../_shared/places/mod.ts'
import { parseSuggestionsRequest } from './request.ts'
import { rankingTiles, shapeSuggestions } from './shape.ts'
import {
  loadPlaces,
  type PlaceRow,
  queueTiles,
  type TileStatus,
} from './store.ts'

export interface Deps {
  queue?: (tiles: string[]) => Promise<Map<string, TileStatus>>
  load?: (
    supabase: SupabaseClient,
    tiles: string[],
    kind: PlaceKind,
  ) => Promise<PlaceRow[]>
}

export function createHandler({
  queue = (tiles) => queueTiles(adminClient(), tiles),
  load = loadPlaces,
}: Deps = {}) {
  return handle(async (req) => {
    const { supabase } = await requireUser(req)
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Use POST')
    }
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'Body must be JSON')
    }
    const { tiles, kind } = parseSuggestionsRequest(body)

    const statuses = await queue(tiles)
    const done = tiles.filter((tile) => statuses.get(tile) === 'done')
    const rows = await load(supabase, rankingTiles(done), kind)
    const response = shapeSuggestions(tiles, statuses, rows)

    console.log(
      `suggestions: ${tiles.length} ${kind} tiles, ${done.length} done, ` +
        `${response.pending.length} pending, ${response.failed.length} failed, ` +
        `${response.places.length} places`,
    )
    return json(response)
  })
}

export const handler = createHandler()

export default { fetch: handler }
