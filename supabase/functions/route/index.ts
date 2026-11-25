// Driving routes for signed-in users, from OpenRouteService (driving-car),
// cached in route_cache and shared by every trip. The ORS key stays server-side.
//
//   { pairs: [{ from: { lat, lng }, to: { lat, lng } }, ...] }   (at most 50)
//   → { results: LegResult[] }, one per pair, in input order:
//       { distance_m, duration_s, geometry, cached }   geometry: encoded polyline (precision 5)
//       { error, message }   error: no_route | too_long | rate_limited | unavailable
//
// Coordinates are rounded to 5 decimals (as roundCoord in tripMath.ts) before
// lookup, so the same leg is fetched once for everyone. Cache entries older
// than 90 days (CACHE_LIFETIME_DAYS) are ignored and refetched, then
// overwritten. Misses that connect end to end (a trip's legs in order) are
// fetched in one multi-waypoint ORS request. If that request finds no route
// (or one too long), the chain is split in half and each half retried, so only
// the legs that really fail come back as errors. Each request makes at most
// MAX_ORS_CALLS ORS calls within ORS_BUDGET_MS; legs left over then come back
// as unavailable. Failed legs aren't cached.
import { requireUser } from '../_shared/auth.ts'
import { handle, HttpError, json } from '../_shared/http.ts'
import { type RouteCache, supabaseRouteCache } from './cache.ts'
import {
  CACHE_LIFETIME_DAYS,
  chainLegs,
  isZeroLeg,
  type Leg,
  legError,
  type LegError,
  type LegErrorCode,
  legKey,
  type LegResult,
  parseRouteRequest,
  type Route,
  shapeResults,
  uniqueLegs,
  zeroRoute,
} from './legs.ts'
import { fetchChain, ORS_TIMEOUT_MS } from './ors.ts'

export interface Deps {
  fetchFn?: typeof fetch
  cache?: RouteCache
  now?: () => Date
}

export function createHandler({
  fetchFn = fetch,
  cache = supabaseRouteCache(),
  now = () => new Date(),
}: Deps = {}) {
  return handle(async (req) => {
    await requireUser(req)
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Use POST')
    }
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'Body must be JSON')
    }
    const legs = parseRouteRequest(body)
    const byKey = new Map<string, LegResult>()

    const toLookUp: Leg[] = []
    for (const leg of uniqueLegs(legs)) {
      if (isZeroLeg(leg)) {
        byKey.set(legKey(leg), { ...zeroRoute(leg), cached: false })
      } else {
        toLookUp.push(leg)
      }
    }

    const fetchedAt = now()
    const freshSince = new Date(
      fetchedAt.getTime() - CACHE_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
    )
    let hits = new Map<string, Route>()
    try {
      hits = await cache.lookup(toLookUp, freshSince)
    } catch (error) {
      // Still answer (from ORS) if the cache can't be read.
      console.error('route_cache lookup failed', error)
    }
    const misses: Leg[] = []
    for (const leg of toLookUp) {
      const hit = hits.get(legKey(leg))
      if (hit) byKey.set(legKey(leg), { ...hit, cached: true })
      else misses.push(leg)
    }

    const fetched = await routeMisses(misses, fetchFn)
    const toStore: { leg: Leg; route: Route }[] = []
    for (const leg of misses) {
      const outcome = fetched.get(legKey(leg)) ?? legError('unavailable')
      if ('error' in outcome) {
        byKey.set(legKey(leg), outcome)
      } else {
        byKey.set(legKey(leg), { ...outcome, cached: false })
        toStore.push({ leg, route: outcome })
      }
    }
    try {
      await cache.store(toStore, fetchedAt)
    } catch (error) {
      console.error('route_cache store failed', error)
    }

    console.log(
      `route: ${legs.length} pairs, ${hits.size} cache hits, ` +
        `${toStore.length} fetched, ${misses.length - toStore.length} failed`,
    )
    return json({ results: shapeResults(legs, byKey) })
  })
}

/** The most ORS calls one request may make, retries included. */
export const MAX_ORS_CALLS = 12
/** The total time one request may spend waiting on ORS. */
export const ORS_BUDGET_MS = 30_000

/** Fetches missed legs from ORS, by legKey. Never throws. */
async function routeMisses(
  misses: Leg[],
  fetchFn: typeof fetch,
): Promise<Map<string, Route | LegError>> {
  const results = new Map<string, Route | LegError>()
  if (misses.length === 0) return results
  const apiKey = Deno.env.get('ORS_API_KEY')
  if (!apiKey) {
    console.error('ORS_API_KEY is not set')
    for (const leg of misses) results.set(legKey(leg), legError('unavailable'))
    return results
  }

  let stopped: LegErrorCode | undefined
  let calls = 0
  const deadline = Date.now() + ORS_BUDGET_MS
  const fail = (chain: Leg[], code: LegErrorCode) => {
    for (const leg of chain) results.set(legKey(leg), legError(code))
  }
  const queue = chainLegs(misses)
  for (let chain = queue.shift(); chain; chain = queue.shift()) {
    const remainingMs = deadline - Date.now()
    if (!stopped && (calls >= MAX_ORS_CALLS || remainingMs <= 0)) {
      console.error(`route: ORS call budget used up after ${calls} calls`)
      stopped = 'unavailable'
    }
    if (stopped) {
      fail(chain, stopped)
      continue
    }
    calls++
    const outcome = await fetchChain(
      chain,
      apiKey,
      fetchFn,
      Math.min(ORS_TIMEOUT_MS, remainingMs),
    )
    if (outcome.ok) {
      chain.forEach((leg, i) => results.set(legKey(leg), outcome.routes[i]))
    } else if (outcome.fatal) {
      stopped = outcome.error
      fail(chain, outcome.error)
    } else if (
      chain.length > 1 &&
      (outcome.error === 'no_route' || outcome.error === 'too_long')
    ) {
      // Some leg in the chain fails: split it in half and retry each half, next.
      const mid = Math.ceil(chain.length / 2)
      queue.unshift(chain.slice(0, mid), chain.slice(mid))
    } else {
      fail(chain, outcome.error)
    }
  }
  return results
}

export const handler = createHandler()

export default { fetch: handler }
