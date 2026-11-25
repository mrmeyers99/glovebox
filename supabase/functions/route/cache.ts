// The shared route_cache table, read and written with the service-role client.
// It holds no trip data: only routes between rounded coordinates, shared by
// every trip.
import { adminClient } from '../_shared/admin.ts'
import { type Leg, legKey, type Route } from './legs.ts'

export interface RouteCache {
  /** Cached routes fetched at or after `freshSince`, by legKey. */
  lookup(legs: Leg[], freshSince: Date): Promise<Map<string, Route>>
  /** Inserts or refreshes entries (fetched_at = `fetchedAt`). */
  store(entries: { leg: Leg; route: Route }[], fetchedAt: Date): Promise<void>
}

interface Row {
  from_lat: number | string
  from_lng: number | string
  to_lat: number | string
  to_lng: number | string
  distance_m: number
  duration_s: number
  geometry: string
}

/** A PostgREST filter matching exactly one leg's primary key. */
export function legFilter(leg: Leg): string {
  return (
    `and(from_lat.eq.${leg.from.lat},from_lng.eq.${leg.from.lng},` +
    `to_lat.eq.${leg.to.lat},to_lng.eq.${leg.to.lng})`
  )
}

function rowLeg(row: Row): Leg {
  // numeric columns come back as numbers; Number() also accepts strings.
  return {
    from: { lat: Number(row.from_lat), lng: Number(row.from_lng) },
    to: { lat: Number(row.to_lat), lng: Number(row.to_lng) },
  }
}

export function supabaseRouteCache(): RouteCache {
  return {
    async lookup(legs, freshSince) {
      const found = new Map<string, Route>()
      if (legs.length === 0) return found
      const { data, error } = await adminClient()
        .from('route_cache')
        .select(
          'from_lat, from_lng, to_lat, to_lng, distance_m, duration_s, geometry',
        )
        .or(legs.map(legFilter).join(','))
        .gte('fetched_at', freshSince.toISOString())
      if (error) throw error
      for (const row of (data ?? []) as Row[]) {
        found.set(legKey(rowLeg(row)), {
          distance_m: row.distance_m,
          duration_s: row.duration_s,
          geometry: row.geometry,
        })
      }
      return found
    },
    async store(entries, fetchedAt) {
      if (entries.length === 0) return
      const { error } = await adminClient()
        .from('route_cache')
        .upsert(
          entries.map(({ leg, route }) => ({
            from_lat: leg.from.lat,
            from_lng: leg.from.lng,
            to_lat: leg.to.lat,
            to_lng: leg.to.lng,
            ...route,
            fetched_at: fetchedAt.toISOString(),
          })),
          { onConflict: 'from_lat,from_lng,to_lat,to_lng' },
        )
      if (error) throw error
    },
  }
}
