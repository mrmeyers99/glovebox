// The places enrichment queue, through the service-role client. Shared cache
// data, not trip data (see _shared/admin.ts).
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../_shared/admin.ts'

/** A place claimed by public.claim_places_to_enrich(). */
export interface PlaceToEnrich {
  id: number
  wikidata: string | null
  category: string
}

/** One place for public.store_place_enrichment(). */
export interface EnrichedPlace {
  id: number
  /** The item the signals are for; a place whose item changed is skipped. */
  wikidata: string | null
  sitelinks: number | null
  pageviews_month: number | null
  commons_files: number | null
  image_file: string | null
  image_credit: string | null
  image_license: string | null
  score: number
}

export interface EnrichStore {
  /**
   * Claims due places: up to `linkedLimit` with a Wikidata item (none while
   * the worker is paused) and up to `plainLimit` without.
   */
  claim(linkedLimit: number, plainLimit: number): Promise<PlaceToEnrich[]>
  /** Stores signals and scores, and marks the places enriched. Returns the count. */
  store(places: EnrichedPlace[]): Promise<number>
  /** Hands claimed places back, to be claimed again from `retryAt`. */
  release(ids: number[], retryAt: Date): Promise<void>
  /** Claims no places with a Wikidata item until `until`. */
  pause(until: Date, reason: string): Promise<void>
}

export const WORKER = 'places-enrich'

export function supabaseEnrichStore(
  client: () => SupabaseClient = adminClient,
): EnrichStore {
  return {
    async claim(linkedLimit, plainLimit) {
      const { data, error } = await client().rpc('claim_places_to_enrich', {
        p_linked_limit: linkedLimit,
        p_plain_limit: plainLimit,
      })
      if (error) throw error
      return ((data ?? []) as PlaceToEnrich[]).map((p) => ({
        ...p,
        id: Number(p.id),
      }))
    },
    async store(places) {
      const { data, error } = await client().rpc('store_place_enrichment', {
        p_places: places,
      })
      if (error) throw error
      return Number(data)
    },
    async release(ids, retryAt) {
      const { error } = await client()
        .from('places')
        .update({ enrich_next_attempt_at: retryAt.toISOString() })
        .in('id', ids)
      if (error) throw error
    },
    async pause(until, reason) {
      const { error } = await client()
        .from('worker_pauses')
        .upsert({ worker: WORKER, paused_until: until.toISOString(), reason })
      if (error) throw error
    },
  }
}
