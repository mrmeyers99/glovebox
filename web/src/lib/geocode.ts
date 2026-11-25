import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** A place from the `geocode` Edge Function (OpenRouteService, US only). */
export interface Place {
  name: string
  address: string
  lat: number
  lng: number
}

export interface LatLng {
  lat: number
  lng: number
}

/** Thrown when place search fails; `status` is the function's HTTP status, if any. */
export class GeocodeError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GeocodeError'
    this.status = status
  }
}

/** Turns a `functions.invoke` error into a GeocodeError with the function's message. */
export async function toGeocodeError(error: unknown): Promise<GeocodeError> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response
    try {
      const body: unknown = await res.json()
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'string'
      ) {
        return new GeocodeError(body.error, res.status)
      }
    } catch {
      // Not JSON; fall through to a generic message.
    }
    return new GeocodeError('Place search failed', res.status)
  }
  return new GeocodeError('Place search is unavailable right now')
}

async function invokeGeocode(body: object): Promise<Place[]> {
  const { data, error } = await supabase.functions.invoke<{
    results: Place[]
  }>('geocode', { body })
  if (error) throw await toGeocodeError(error)
  return data?.results ?? []
}

/** Up to 8 places matching `q`, optionally biased toward `focus`. */
export function searchPlaces(q: string, focus?: LatLng): Promise<Place[]> {
  return invokeGeocode(focus ? { q, focus } : { q })
}

/** The nearest named place or address to `point`, or null if there is none. */
export async function reverseGeocode(point: LatLng): Promise<Place | null> {
  const [place] = await invokeGeocode({ reverse: point })
  return place ?? null
}
