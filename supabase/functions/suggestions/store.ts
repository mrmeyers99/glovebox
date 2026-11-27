// Reading and queueing the places cache for the suggestions function.
//
// Places are read as the caller (row-level security applies: any signed-in
// user can read them). Only queueing tiles uses the service role.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlaceKind } from '../_shared/places/mod.ts'

export type TileStatus = 'pending' | 'fetching' | 'done' | 'failed'

/** A row of public.suggestion_places(). */
export interface PlaceRow {
  id: number
  source: 'osm' | 'ridb'
  source_id: string
  wikidata: string | null
  name: string
  kind: PlaceKind
  category: string
  lat: number
  lng: number
  tile_key: string
  tags: Record<string, string> | null
  image_file: string | null
  image_credit: string | null
  image_license: string | null
  score: number
  parent_place_id: number | null
}

/** Rows per page: the API's max_rows (supabase/config.jsonc). */
export const PAGE_SIZE = 1000
/** The most places one request reads, so a huge request can't run away. */
export const MAX_PLACES = 20_000

/**
 * Queues tiles never asked for before as 'pending' and returns the status of
 * each tile (public.queue_place_tiles). Tiles missing from the result were
 * queued by a concurrent request.
 */
export async function queueTiles(
  admin: SupabaseClient,
  tiles: string[],
): Promise<Map<string, TileStatus>> {
  const statuses = new Map<string, TileStatus>()
  if (tiles.length === 0) return statuses
  const { data, error } = await admin.rpc('queue_place_tiles', {
    p_tile_keys: tiles,
  })
  if (error) throw error
  for (const row of (data ?? []) as {
    tile_key: string
    status: TileStatus
  }[]) {
    statuses.set(row.tile_key, row.status)
  }
  return statuses
}

/**
 * Scored places of `kind` in those of `tiles` that are 'done'
 * (public.suggestion_places), a page at a time, up to MAX_PLACES.
 */
export async function loadPlaces(
  supabase: SupabaseClient,
  tiles: string[],
  kind: PlaceKind,
): Promise<PlaceRow[]> {
  const rows: PlaceRow[] = []
  if (tiles.length === 0) return rows
  while (rows.length < MAX_PLACES) {
    const { data, error } = await supabase
      .rpc('suggestion_places', { p_tile_keys: tiles, p_kind: kind })
      .range(rows.length, rows.length + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as PlaceRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
  console.error(`suggestions: stopped reading at ${MAX_PLACES} places`)
  return rows
}
