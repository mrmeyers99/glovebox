// Pure logic for the route function: request validation, coordinate rounding,
// de-duplication, batching legs into multi-waypoint ORS requests, polyline
// encoding and response shaping. No network or database here, so it is
// unit-tested directly.
import { HttpError } from '../_shared/http.ts'

export interface LatLng {
  lat: number
  lng: number
}

/** A leg from one point to another, with coordinates already rounded. */
export interface Leg {
  from: LatLng
  to: LatLng
}

/** A driving route for one leg. */
export interface Route {
  distance_m: number
  duration_s: number
  /** Encoded polyline (Google format, precision 5) of [lat, lng] points. */
  geometry: string
}

export type LegErrorCode =
  | 'no_route' // ORS found no drivable route (e.g. across water, or a point far from any road)
  | 'too_long' // the leg is longer than ORS allows in one request
  | 'rate_limited' // ORS's daily/minute quota is used up; try again later
  | 'unavailable' // ORS is unreachable, misconfigured, or answered with something unusable

export interface LegError {
  error: LegErrorCode
  message: string
}

/** One entry of the response, in the same position as its input pair. */
export type LegResult = (Route & { cached: boolean }) | LegError

export const MAX_PAIRS = 50
/** ORS allows at most 50 waypoints per directions request, so 49 legs. */
export const MAX_LEGS_PER_REQUEST = 49
/**
 * ORS rejects routes longer than 6,000 km. Roads are longer than the straight
 * line between points, so a chain stops growing once its straight-line length
 * passes this; a chain that still turns out too long is retried leg by leg.
 */
export const MAX_CHAIN_STRAIGHT_LINE_M = 3_500_000
/** Cache entries older than this are refetched (roads and speeds change). */
export const CACHE_LIFETIME_DAYS = 90

export const legErrorMessages: Record<LegErrorCode, string> = {
  no_route: 'No driving route found between these points',
  too_long: 'This leg is too long to route in one piece',
  rate_limited: 'Routing is busy (rate limit reached). Try again later.',
  unavailable: 'Routing is unavailable right now',
}

export function legError(code: LegErrorCode): LegError {
  return { error: code, message: legErrorMessages[code] }
}

/** Round to 5 decimals: the same rule as roundCoord in web/src/lib/tripMath.ts. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

function roundPoint({ lat, lng }: LatLng): LatLng {
  return { lat: roundCoord(lat), lng: roundCoord(lng) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLatLng(value: unknown, field: string): LatLng {
  if (isRecord(value)) {
    const { lat, lng } = value
    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {
      return { lat, lng }
    }
  }
  throw new HttpError(
    400,
    `${field} must be { lat, lng } with lat in -90..90 and lng in -180..180`,
  )
}

/**
 * Validates `{ pairs: [{ from: { lat, lng }, to: { lat, lng } }, ...] }`
 * (at most 50) and returns the legs with coordinates rounded.
 */
export function parseRouteRequest(body: unknown): Leg[] {
  if (!isRecord(body) || !Array.isArray(body.pairs)) {
    throw new HttpError(400, 'Body must be { pairs: [{ from, to }, ...] }')
  }
  if (body.pairs.length > MAX_PAIRS) {
    throw new HttpError(400, `Send at most ${MAX_PAIRS} pairs`)
  }
  return body.pairs.map((pair, i) => {
    if (!isRecord(pair)) {
      throw new HttpError(400, `pairs[${i}] must be { from, to }`)
    }
    return {
      from: roundPoint(parseLatLng(pair.from, `pairs[${i}].from`)),
      to: roundPoint(parseLatLng(pair.to, `pairs[${i}].to`)),
    }
  })
}

export function pointKey({ lat, lng }: LatLng): string {
  return `${lat},${lng}`
}

/** The cache key of a (rounded) leg. */
export function legKey(leg: Leg): string {
  return `${pointKey(leg.from)}>${pointKey(leg.to)}`
}

/** The distinct legs, in first-seen order. */
export function uniqueLegs(legs: Leg[]): Leg[] {
  const seen = new Map<string, Leg>()
  for (const leg of legs) {
    const key = legKey(leg)
    if (!seen.has(key)) seen.set(key, leg)
  }
  return [...seen.values()]
}

/** Straight-line (great-circle) distance in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Groups legs into chains where each leg starts where the previous one ends,
 * so a whole chain is one multi-waypoint ORS request (a trip's legs in order
 * become one call). Chains are capped by waypoint count and length.
 */
export function chainLegs(
  legs: Leg[],
  {
    maxLegs = MAX_LEGS_PER_REQUEST,
    maxStraightLineM = MAX_CHAIN_STRAIGHT_LINE_M,
  } = {},
): Leg[][] {
  const chains: Leg[][] = []
  let chain: Leg[] = []
  let length = 0
  for (const leg of legs) {
    const legLength = haversineMeters(leg.from, leg.to)
    const last = chain.at(-1)
    const continues =
      last !== undefined &&
      pointKey(last.to) === pointKey(leg.from) &&
      chain.length < maxLegs &&
      length + legLength <= maxStraightLineM
    if (!continues) {
      if (chain.length > 0) chains.push(chain)
      chain = []
      length = 0
    }
    chain.push(leg)
    length += legLength
  }
  if (chain.length > 0) chains.push(chain)
  return chains
}

/** The waypoints of a chain as ORS wants them: [lng, lat]. */
export function chainCoordinates(chain: Leg[]): [number, number][] {
  return [chain[0].from, ...chain.map((leg) => leg.to)].map(({ lat, lng }) => [
    lng,
    lat,
  ])
}

/** Encodes [lat, lng] points as a Google encoded polyline (precision 5). */
export function encodePolyline(points: [number, number][]): string {
  let out = ''
  let prevLat = 0
  let prevLng = 0
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1
    while (value >= 0x20) {
      out += String.fromCharCode((0x20 | (value & 0x1f)) + 63)
      value >>= 5
    }
    out += String.fromCharCode(value + 63)
  }
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5)
    const iLng = Math.round(lng * 1e5)
    encode(iLat - prevLat)
    encode(iLng - prevLng)
    prevLat = iLat
    prevLng = iLng
  }
  return out
}

/** Decodes a Google encoded polyline (precision 5) to [lat, lng] points. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  const next = () => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    lat += next()
    lng += next()
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

/**
 * Splits an ORS GeoJSON directions response for a chain into one route per
 * leg, using each segment's distance/duration and the `way_points` indices
 * into the line. Throws if the response doesn't match the chain.
 */
export function splitDirections(response: unknown, legCount: number): Route[] {
  const feature =
    isRecord(response) && Array.isArray(response.features)
      ? response.features[0]
      : undefined
  if (!isRecord(feature)) throw new Error('No route feature in ORS response')
  const { geometry, properties } = feature
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) {
    throw new Error('No route geometry in ORS response')
  }
  if (!isRecord(properties)) throw new Error('No route properties')
  const { segments, way_points: wayPoints } = properties
  if (
    !Array.isArray(segments) ||
    segments.length !== legCount ||
    !Array.isArray(wayPoints) ||
    wayPoints.length !== legCount + 1
  ) {
    throw new Error('ORS segments do not match the requested legs')
  }
  const coordinates = geometry.coordinates as unknown[]
  return segments.map((segment, i) => {
    const start = wayPoints[i]
    const end = wayPoints[i + 1]
    if (
      !isRecord(segment) ||
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      start < 0 ||
      end < start ||
      end >= coordinates.length
    ) {
      throw new Error(`Malformed ORS segment ${i}`)
    }
    const points = coordinates.slice(start, end + 1).map((c) => {
      if (
        !Array.isArray(c) ||
        typeof c[0] !== 'number' ||
        typeof c[1] !== 'number'
      ) {
        throw new Error('Malformed ORS coordinate')
      }
      return [c[1], c[0]] as [number, number]
    })
    // ORS leaves distance/duration out of a zero-length segment.
    const distance = segment.distance ?? 0
    const duration = segment.duration ?? 0
    if (
      typeof distance !== 'number' ||
      typeof duration !== 'number' ||
      distance < 0 ||
      duration < 0
    ) {
      throw new Error(`Malformed ORS segment ${i}`)
    }
    return {
      distance_m: distance,
      duration_s: duration,
      geometry: encodePolyline(points),
    }
  })
}

/** A leg that starts and ends at the same (rounded) point needs no routing. */
export function isZeroLeg(leg: Leg): boolean {
  return pointKey(leg.from) === pointKey(leg.to)
}

export function zeroRoute(leg: Leg): Route {
  return {
    distance_m: 0,
    duration_s: 0,
    geometry: encodePolyline([[leg.from.lat, leg.from.lng]]),
  }
}

/** Puts results back in input order (duplicates share one result). */
export function shapeResults(
  legs: Leg[],
  byKey: Map<string, LegResult>,
): LegResult[] {
  return legs.map((leg) => byKey.get(legKey(leg)) ?? legError('unavailable'))
}
