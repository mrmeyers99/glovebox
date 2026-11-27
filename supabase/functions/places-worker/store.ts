// The place_tiles queue and places table, through the service-role client.
// Shared cache data, not trip data (see _shared/admin.ts).
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../_shared/admin.ts'
import type { PlaceKind } from '../_shared/places/mod.ts'

export interface ClaimedTile {
  tile_key: string
  /** Including this one. */
  attempts: number
}

/** One place for public.store_place_tile(). */
export interface StoredPlace {
  source_id: string
  name: string
  kind: PlaceKind
  category: string
  lat: number
  lng: number
  wikidata: string | null
  tags: Record<string, string>
  parent_source_id: string | null
}

export interface TileStore {
  /** Claims up to `limit` due tiles (marks them 'fetching'). */
  claim(limit: number): Promise<ClaimedTile[]>
  /** Replaces the tile's OSM places and marks it 'done'. Returns the count. */
  store(tileKey: string, places: StoredPlace[]): Promise<number>
  /** Marks the tile 'failed', to retry at `retryAt`. */
  fail(tileKey: string, error: string, retryAt: Date): Promise<void>
}

export function supabaseTileStore(
  client: () => SupabaseClient = adminClient,
): TileStore {
  return {
    async claim(limit) {
      const { data, error } = await client().rpc('claim_place_tiles', {
        p_limit: limit,
      })
      if (error) throw error
      return (data ?? []) as ClaimedTile[]
    },
    async store(tileKey, places) {
      const { data, error } = await client().rpc('store_place_tile', {
        p_tile_key: tileKey,
        p_places: places,
      })
      if (error) throw error
      return Number(data)
    },
    async fail(tileKey, message, retryAt) {
      const { error } = await client()
        .from('place_tiles')
        .update({
          status: 'failed',
          error: message,
          next_attempt_at: retryAt.toISOString(),
        })
        .eq('tile_key', tileKey)
      if (error) throw error
    },
  }
}
