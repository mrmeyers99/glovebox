// The tile fill worker (Discovery, requirements §9). Fetches queued map tiles'
// candidate places from OpenStreetMap (Overpass) into the places table.
//
//   POST (no body needed), service role only: `apikey: <secret key>`
//   → { tiles: [{ tile_key, status: 'done', places } | { tile_key, status: 'failed', error }],
//       paused_until?: ISO time }
//
// Not for users: pg_cron calls it every minute (public.invoke_places_worker,
// in the places_worker migration) while tiles are due. Overpass is slow and
// sometimes rate-limited, so this can't run inside a user's request.
//
// Each run takes due tiles one at a time, up to MAX_TILES_PER_RUN, and starts
// no new tile after START_BEFORE_MS, so that it finishes within the Edge
// Function time limit. For each tile it queries Overpass, keeps the elements
// classifyCandidate() accepts, merges duplicates and nests places (dedupe),
// and stores the places located in the tile. A failed tile is retried later
// with a growing back-off (retryDelayMs). When no Overpass server answers a
// tile (the public servers are often overloaded), the run stops and pauses
// the worker for PAUSE_MS (worker_pauses; pg_cron skips it meanwhile), rather
// than failing one tile after another.
import { requireServiceRole } from '../_shared/auth.ts'
import { handle, HttpError, json } from '../_shared/http.ts'
import { contactUserAgent } from '../_shared/user_agent.ts'
import { dedupe, parseAmenities } from '../_shared/places/mod.ts'
import { finishCampgrounds, parseParks } from './campgrounds.ts'
import {
  buildQuery,
  fetchOverpass,
  OVERPASS_SERVERS,
  OverpassUnavailableError,
  parseElements,
} from './overpass.ts'
import { type StoredPlace, supabaseTileStore, type TileStore } from './store.ts'
import { inTile, retryDelayMs, tileBounds } from './tiles.ts'

export const MAX_TILES_PER_RUN = 3
/** No tile is started after this long into a run. */
export const START_BEFORE_MS = 60_000
/** Overpass requests stop this long into a run (the platform limit is 150 s). */
export const RUN_BUDGET_MS = 130_000

/** How long the worker pauses when no Overpass server answers. */
export const PAUSE_MS = 5 * 60_000

export type TileResult =
  | { tile_key: string; status: 'done'; places: number }
  | {
      tile_key: string
      status: 'failed'
      error: string
      /** No Overpass server answered (rather than, say, storing failed). */
      overpass_unavailable?: true
    }

export interface Deps {
  fetchFn?: typeof fetch
  store?: TileStore
  servers?: readonly string[]
  now?: () => number
}

export function createHandler({
  fetchFn = fetch,
  store = supabaseTileStore(),
  servers = OVERPASS_SERVERS,
  now = Date.now,
}: Deps = {}) {
  return handle(async (req) => {
    await requireServiceRole(req)
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    await req.body?.cancel()

    const userAgent = contactUserAgent()

    const started = now()
    const deadline = started + RUN_BUDGET_MS
    const tiles: TileResult[] = []
    while (
      tiles.length < MAX_TILES_PER_RUN &&
      now() - started < START_BEFORE_MS
    ) {
      const [tile] = await store.claim(1)
      if (!tile) break
      const result = await fillTile(tile.tile_key, tile.attempts, {
        store,
        fetchFn,
        servers,
        userAgent,
        deadline,
        now,
      })
      tiles.push(result)
      if (result.status === 'failed' && result.overpass_unavailable) {
        const until = new Date(now() + PAUSE_MS)
        try {
          await store.pause(until, result.error)
          console.log(`places-worker: paused until ${until.toISOString()}`)
          return json({ tiles, paused_until: until.toISOString() })
        } catch (pauseError) {
          // Not paused: the next run carries on as usual.
          console.error('places-worker: could not pause', pauseError)
          break
        }
      }
    }
    return json({ tiles })
  })
}

interface FillOptions {
  store: TileStore
  fetchFn: typeof fetch
  servers: readonly string[]
  userAgent: string
  deadline: number
  now: () => number
}

/** Fetches and stores one claimed tile, or marks it failed. Never throws. */
export async function fillTile(
  tileKey: string,
  attempts: number,
  { store, ...fetchOptions }: FillOptions,
): Promise<TileResult> {
  try {
    const bounds = tileBounds(tileKey)
    const elements = await fetchOverpass(buildQuery(bounds), fetchOptions)
    const places = placesForTile(elements, bounds)
    const count = await store.store(tileKey, places)
    console.log(
      `places-worker: ${tileKey}: ${count} places from ${elements.length} elements`,
    )
    return { tile_key: tileKey, status: 'done', places: count }
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 1000)
    console.error(
      `places-worker: ${tileKey} failed (attempt ${attempts}): ${message}`,
    )
    const retryAt = new Date(fetchOptions.now() + retryDelayMs(attempts))
    try {
      await store.fail(tileKey, message, retryAt)
    } catch (failError) {
      // The claim expires on its own and the tile is retried then.
      console.error(
        `places-worker: could not mark ${tileKey} failed`,
        failError,
      )
    }
    return error instanceof OverpassUnavailableError
      ? {
          tile_key: tileKey,
          status: 'failed',
          error: message,
          overpass_unavailable: true,
        }
      : { tile_key: tileKey, status: 'failed', error: message }
  }
}

/**
 * The tile's places: candidates merged and nested across everything Overpass
 * returned (which includes ways reaching in from neighbouring tiles), with
 * campgrounds named and linked to their parks, then only those located in
 * this tile, since each place is stored by its tile. A campground's tags
 * also hold its normalised amenities (tags.amenities).
 */
export function placesForTile(
  elements: Parameters<typeof parseElements>[0],
  bounds: ReturnType<typeof tileBounds>,
): StoredPlace[] {
  return finishCampgrounds(
    dedupe(parseElements(elements)),
    parseParks(elements),
  )
    .filter((p) => inTile(bounds, p.lat, p.lng))
    .map((p) => ({
      source_id: p.id,
      name: p.name,
      kind: p.kind,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      wikidata: p.wikidata ?? null,
      tags:
        p.kind === 'campground'
          ? { ...p.tags, amenities: parseAmenities(p.category, p.tags) }
          : p.tags,
      parent_source_id: p.parentId,
    }))
}

export const handler = createHandler()

export default { fetch: handler }
