// OpenRouteService directions (driving-car), one request per chain of legs.
import {
  chainCoordinates,
  type Leg,
  type LegErrorCode,
  type Route,
  splitDirections,
} from './legs.ts'

const ORS_DIRECTIONS =
  'https://api.openrouteservice.org/v2/directions/driving-car/geojson'

export type ChainOutcome =
  | { ok: true; routes: Route[] }
  | {
      ok: false
      error: LegErrorCode
      /** True when later requests would fail the same way (quota, key, network). */
      fatal: boolean
    }

function orsErrorCode(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'number' ? code : undefined
}

/** Routes one chain of connected legs with a single multi-waypoint request. */
export async function fetchChain(
  chain: Leg[],
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<ChainOutcome> {
  let res: Response
  try {
    res = await fetchFn(ORS_DIRECTIONS, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
        accept: 'application/geo+json, application/json',
      },
      // Instructions stay on (the default): ORS only returns per-leg segments
      // with them.
      body: JSON.stringify({ coordinates: chainCoordinates(chain) }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    console.error('ORS directions request failed', error)
    return { ok: false, error: 'unavailable', fatal: true }
  }
  if (res.ok) {
    try {
      return {
        ok: true,
        routes: splitDirections(await res.json(), chain.length),
      }
    } catch (error) {
      console.error('ORS directions response was not usable', error)
      return { ok: false, error: 'unavailable', fatal: false }
    }
  }
  const text = await res.text()
  if (res.status === 429) {
    console.error('ORS directions rate limit reached', text)
    return { ok: false, error: 'rate_limited', fatal: true }
  }
  // Log ORS's message for debugging; never echo it (or the key) to the client.
  console.error('ORS directions error', res.status, text)
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'unavailable', fatal: true }
  }
  let code: number | undefined
  try {
    code = orsErrorCode(JSON.parse(text))
  } catch {
    // Not JSON.
  }
  // 2004: route longer than allowed. 2009: no route. 2010: no road near a point.
  if (code === 2004) return { ok: false, error: 'too_long', fatal: false }
  if (res.status === 404 || code === 2009 || code === 2010) {
    return { ok: false, error: 'no_route', fatal: false }
  }
  return { ok: false, error: 'unavailable', fatal: false }
}
