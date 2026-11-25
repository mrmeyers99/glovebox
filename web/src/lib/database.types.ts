// Types for the Supabase schema in supabase/migrations.
// Hand-written for now; can be replaced by `supabase gen types typescript`.

export type TripRole = 'owner' | 'editor' | 'viewer'
export type StopKind = 'start' | 'waypoint' | 'end'
export type CostCategory = 'lodging' | 'food' | 'activity' | 'other'

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
      >
      route_cache: Table<RouteCacheEntry, never, never>
      gas_price_cache: Table<GasPrice, never, never>
    }
    Views: Record<never, never>
    Functions: {
      accept_my_invites: { Args: Record<never, never>; Returns: number }
    }
    Enums: {
      trip_role: TripRole
      stop_kind: StopKind
      cost_category: CostCategory
    }
    CompositeTypes: Record<never, never>
  }
}
