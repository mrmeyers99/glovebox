// Client side of the `route` Edge Function: which legs still need a route,
// batching them into requests, and turning results into a RouteLookup for
// summarizeTrip. Routes are kept by rounded coordinates, the same key the
// function's route_cache uses, so a leg is fetched once however stops move.

import { supabase } from './supabase'
import { roundCoord, type RouteInfo, type RouteLookup } from './tripMath'

export interface LatLng {
  lat: number
  lng: number
}

/** A leg to route, with its key. */
export interface RoutePair {
  key: string
  from: LatLng
  to: LatLng
}

/**
 * What's known about a leg. A failed leg is `final` when routing found no
 * route (it won't be asked again); otherwise (rate limit, outage) it is
 * retried the next time the trip's legs change.
 */
export type RouteEntry =
  | { status: 'ok'; route: RouteInfo }
  | { status: 'failed'; final: boolean }

/** The route function accepts at most this many pairs per request. */
export const MAX_PAIRS_PER_REQUEST = 50

function pointKey({ lat, lng }: LatLng) {
  return `${roundCoord(lat)},${roundCoord(lng)}`
}

/** Key of the leg between two points, after rounding (as the server's legKey). */
export function routeKey(from: LatLng, to: LatLng) {
  return `${pointKey(from)}>${pointKey(to)}`
}

function isZeroLeg(from: LatLng, to: LatLng) {
  return pointKey(from) === pointKey(to)
}

/**
 * The distinct legs that still need fetching, in trip order: not known, not
 * failed for good, not already being fetched, and not zero-length.
 */
export function legsToFetch(
  legs: { from: LatLng; to: LatLng }[],
  known: ReadonlyMap<string, RouteEntry>,
  inFlight: ReadonlySet<string> = new Set(),
): RoutePair[] {
  const pairs = new Map<string, RoutePair>()
  for (const { from, to } of legs) {
    if (isZeroLeg(from, to)) continue
    const key = routeKey(from, to)
    const entry = known.get(key)
    if (entry?.status === 'ok' || (entry?.status === 'failed' && entry.final))
      continue
    if (inFlight.has(key) || pairs.has(key)) continue
    pairs.set(key, {
      key,
      from: { lat: from.lat, lng: from.lng },
      to: { lat: to.lat, lng: to.lng },
    })
  }
  return [...pairs.values()]
}

/** Splits pairs into request-sized batches. */
export function batchPairs(
  pairs: RoutePair[],
  size: number = MAX_PAIRS_PER_REQUEST,
): RoutePair[][] {
  const batches: RoutePair[][] = []
  for (let i = 0; i < pairs.length; i += size) {
    batches.push(pairs.slice(i, i + size))
  }
  return batches
}

const FINAL_ERRORS = new Set(['no_route', 'too_long'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One result from the route function as a RouteEntry. */
export function toRouteEntry(result: unknown): RouteEntry {
  if (isRecord(result)) {
    const {
      distance_m: distanceM,
      duration_s: durationS,
      geometry,
      error,
    } = result
    if (
      typeof distanceM === 'number' &&
      typeof durationS === 'number' &&
      distanceM >= 0 &&
      durationS >= 0
    ) {
      const route: RouteInfo = { distanceM, durationS }
      if (typeof geometry === 'string' && geometry !== '') {
        route.geometry = geometry
      }
      return { status: 'ok', route }
    }
    if (typeof error === 'string') {
      return { status: 'failed', final: FINAL_ERRORS.has(error) }
    }
  }
  return { status: 'failed', final: false }
}

/** Entries for a batch from a route response body, by key (input order). */
export function parseRouteResponse(
  pairs: RoutePair[],
  body: unknown,
): Map<string, RouteEntry> {
  const results =
    isRecord(body) && Array.isArray(body.results) ? body.results : []
  return new Map(pairs.map((pair, i) => [pair.key, toRouteEntry(results[i])]))
}

/** Every pair failed (retryably), e.g. when the request itself failed. */
export function failAll(pairs: RoutePair[]): Map<string, RouteEntry> {
  return new Map(
    pairs.map((pair) => [pair.key, { status: 'failed', final: false }]),
  )
}

/** Fetches routes for one batch (at most 50 pairs). Never throws. */
export async function fetchRouteBatch(
  pairs: RoutePair[],
): Promise<Map<string, RouteEntry>> {
  try {
    const { data, error } = await supabase.functions.invoke('route', {
      body: { pairs: pairs.map(({ from, to }) => ({ from, to })) },
    })
    if (error) return failAll(pairs)
    return parseRouteResponse(pairs, data)
  } catch {
    return failAll(pairs)
  }
}

const ZERO_ROUTE: RouteInfo = { distanceM: 0, durationS: 0 }

/**
 * A RouteLookup over known entries: the route if fetched, null if routing
 * failed, undefined while pending. Zero-length legs need no fetch.
 */
export function makeRouteLookup(
  known: ReadonlyMap<string, RouteEntry>,
): RouteLookup {
  return (from, to) => {
    if (isZeroLeg(from, to)) return ZERO_ROUTE
    const entry = known.get(routeKey(from, to))
    if (!entry) return undefined
    return entry.status === 'ok' ? entry.route : null
  }
}
