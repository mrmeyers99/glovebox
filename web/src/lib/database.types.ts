// Types for the Supabase schema in supabase/migrations.
// Hand-written for now; can be replaced by `supabase gen types typescript`.

export type TripRole = 'owner' | 'editor' | 'viewer'
export type StopKind = 'start' | 'waypoint' | 'end'
export type CostCategory = 'lodging' | 'food' | 'activity' | 'other'
export type PlaceTileStatus = 'pending' | 'fetching' | 'done' | 'failed'
export type PlaceSource = 'osm' | 'ridb'
export type PlaceKind = 'attraction' | 'campground'

type Table<Row, Required extends keyof Row, Optional extends keyof Row> = {
  Row: Row
  Insert: Pick<Row, Required> & Partial<Pick<Row, Optional>>
  Update: Partial<Row>
  Relationships: []
}

export type Profile = {
  id: string
  display_name: string | null
  default_mpg: number
  created_at: string
  updated_at: string
}

export type Trip = {
  id: string
  owner_id: string
  name: string
  start_date: string | null
  mpg: number
  gas_price_per_gallon: number | null
  created_at: string
  updated_at: string
}

export type TripMember = {
  trip_id: string
  user_id: string
  role: TripRole
  created_at: string
}

export type TripInvite = {
  id: string
  trip_id: string
  email: string
  role: TripRole
  invited_by: string
  created_at: string
  accepted_at: string | null
}

export type Day = {
  id: string
  trip_id: string
  position: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type Stop = {
  id: string
  trip_id: string
  day_id: string
  position: string
  kind: StopKind
  name: string
  lat: number
  lng: number
  address: string | null
  notes: string | null
  cost_amount: number | null
  cost_category: CostCategory | null
  arrival_time: string | null
  stay_minutes: number | null
  skipped: boolean
  /** The suggested place (places.id) the stop was added from, if any. */
  place_id: number | null
  created_at: string
  updated_at: string
  updated_by: string | null
}

export type RouteCacheEntry = {
  from_lat: number
  from_lng: number
  to_lat: number
  to_lng: number
  distance_m: number
  duration_s: number
  geometry: string
  fetched_at: string
}

export type GasPrice = {
  region: string
  price_per_gallon: number
  as_of: string
  fetched_at: string
}

// A 0.5° map tile of the places cache, keyed by its south-west corner
// ('42.5_-96.5'; see public.place_tile_key).
export type PlaceTile = {
  tile_key: string
  status: PlaceTileStatus
  requested_at: string
  fetched_at: string | null
  error: string | null
  /** Consecutive failed fetches; reset to 0 when a fetch succeeds. */
  attempts: number
  /** When a 'failed' tile may be retried, or a 'fetching' tile's claim expires. */
  next_attempt_at: string | null
}

export type Place = {
  id: number
  source: PlaceSource
  source_id: string
  wikidata: string | null
  name: string
  kind: PlaceKind
  category: string
  // PostGIS geography(Point); PostgREST returns it as hex EWKB.
  location: string
  tile_key: string // generated from location
  /** OSM tags; a campground's also hold `amenities` (normalised, see _shared/places/amenities.ts). */
  tags: Record<string, unknown>
  /** English Wikipedia user views per month, averaged over 12 months. */
  pageviews_month: number | null
  sitelinks: number | null
  commons_files: number | null
  enriched_at: string | null
  /** When a claimed place's lease expires, or a failed enrichment may be retried. */
  enrich_next_attempt_at: string | null
  image_file: string | null
  image_credit: string | null
  image_license: string | null
  score: number | null
  parent_place_id: number | null
  fetched_at: string
}

// A background worker paused by a rate limit (service role only).
export type WorkerPause = {
  worker: string
  paused_until: string
  reason: string | null
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, 'id', 'display_name' | 'default_mpg'>
      trips: Table<
        Trip,
        'name',
        'id' | 'owner_id' | 'start_date' | 'mpg' | 'gas_price_per_gallon'
      >
      // Only the role can be updated (column-level grant).
      trip_members: Omit<
        Table<TripMember, 'trip_id' | 'user_id' | 'role', never>,
        'Update'
      > & { Update: Partial<Pick<TripMember, 'role'>> }
      trip_invites: Table<TripInvite, 'trip_id' | 'email' | 'role', 'id'>
      days: Table<Day, 'trip_id' | 'position', 'id' | 'notes'>
      stops: Table<
        Stop,
        'trip_id' | 'day_id' | 'position' | 'name' | 'lat' | 'lng',
        | 'id'
        | 'kind'
        | 'address'
        | 'notes'
        | 'cost_amount'
        | 'cost_category'
        | 'arrival_time'
        | 'stay_minutes'
        | 'skipped'
        | 'place_id'
      >
      route_cache: Table<RouteCacheEntry, never, never>
      gas_price_cache: Table<GasPrice, never, never>
      // Written only by Edge Functions (service role).
      place_tiles: Table<PlaceTile, never, never>
      places: Table<Place, never, never>
      worker_pauses: Table<WorkerPause, never, never>
    }
    Views: Record<never, never>
    Functions: {
      accept_my_invites: { Args: Record<never, never>; Returns: number }
      place_tile_key: { Args: { lat: number; lng: number }; Returns: string }
      /** Service role only (the places-worker Edge Function). */
      claim_place_tiles: {
        Args: { p_limit?: number; p_lease?: string }
        Returns: { tile_key: string; attempts: number }[]
      }
      /** Service role only (the places-worker Edge Function). */
      store_place_tile: {
        Args: {
          p_tile_key: string
          p_places: {
            source_id: string
            name: string
            kind: PlaceKind
            category: string
            lat: number
            lng: number
            wikidata?: string | null
            tags?: Record<string, unknown>
            parent_source_id?: string | null
          }[]
        }
        Returns: number
      }
      /** Service role only (the places-enrich Edge Function). */
      claim_places_to_enrich: {
        Args: {
          p_linked_limit?: number
          p_plain_limit?: number
          p_lease?: string
        }
        Returns: Pick<Place, 'id' | 'wikidata' | 'category'>[]
      }
      /** Service role only (the places-enrich Edge Function). */
      store_place_enrichment: {
        Args: {
          p_places: (Pick<
            Place,
            | 'id'
            | 'wikidata'
            | 'sitelinks'
            | 'pageviews_month'
            | 'commons_files'
            | 'image_file'
            | 'image_credit'
            | 'image_license'
          > & { score: number })[]
        }
        Returns: number
      }
      // Scored places in 'done' tiles, for the suggestions Edge Function.
      suggestion_places: {
        Args: { p_tile_keys: string[]; p_kind: PlaceKind }
        Returns: (Pick<
          Place,
          | 'id'
          | 'source'
          | 'source_id'
          | 'wikidata'
          | 'name'
          | 'kind'
          | 'category'
          | 'tile_key'
          | 'tags'
          | 'image_file'
          | 'image_credit'
          | 'image_license'
          | 'parent_place_id'
        > & {
          lat: number
          lng: number
          score: number
          /** The parent place's score; null without a parent or until scored. */
          parent_score: number | null
        })[]
      }
      // Done tiles that still have unscored places of a kind.
      scoring_place_tiles: {
        Args: { p_tile_keys: string[]; p_kind: PlaceKind }
        Returns: Pick<PlaceTile, 'tile_key'>[]
      }
      // Service role only: queues missing tiles, returns every tile's status.
      queue_place_tiles: {
        Args: { p_tile_keys: string[] }
        Returns: Pick<PlaceTile, 'tile_key' | 'status'>[]
      }
      move_stops: {
        Args: {
          p_moves: {
            id: string
            day_id?: string
            position?: string
            kind?: StopKind
          }[]
        }
        Returns: Stop[]
      }
      delete_day: {
        Args: {
          p_day_id: string
          /** Applied like move_stops' p_moves. */
          p_moves?: {
            id: string
            day_id?: string
            position?: string
            kind?: StopKind
          }[]
          p_delete_stop_ids?: string[]
        }
        Returns: Stop[]
      }
    }
    Enums: {
      trip_role: TripRole
      stop_kind: StopKind
      cost_category: CostCategory
    }
    CompositeTypes: Record<never, never>
  }
}
