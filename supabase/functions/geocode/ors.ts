// Request validation and OpenRouteService (Pelias) geocoding, kept separate
// from the handler so it can be tested without a network.
import { HttpError } from '../_shared/http.ts'

export interface LatLng {
  lat: number
  lng: number
}

export interface Place {
  name: string
  address: string
  lat: number
  lng: number
}

export type GeocodeRequest =
  | { kind: 'search'; q: string; focus?: LatLng }
  | { kind: 'reverse'; point: LatLng }

export const MAX_QUERY_LENGTH = 200
export const MAX_RESULTS = 8

const ORS_BASE = 'https://api.openrouteservice.org/geocode'

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

/** Validates the JSON body: `{ q, focus? }` or `{ reverse: { lat, lng } }`. */
export function parseGeocodeRequest(body: unknown): GeocodeRequest {
  if (!isRecord(body)) {
    throw new HttpError(400, 'Body must be a JSON object')
  }
  if (body.reverse !== undefined) {
    if (body.q !== undefined) {
      throw new HttpError(400, 'Send either q or reverse, not both')
    }
    return { kind: 'reverse', point: parseLatLng(body.reverse, 'reverse') }
  }
  if (typeof body.q !== 'string') {
    throw new HttpError(400, 'q must be a string')
  }
  const q = body.q.trim()
  if (q === '') {
    throw new HttpError(400, 'q must not be empty')
  }
  if (q.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, `q must be at most ${MAX_QUERY_LENGTH} characters`)
  }
  if (body.focus === undefined || body.focus === null) {
    return { kind: 'search', q }
  }
  return { kind: 'search', q, focus: parseLatLng(body.focus, 'focus') }
}

/** The ORS URL for a request. The key goes in a header, not the URL. */
export function orsUrl(request: GeocodeRequest): URL {
  if (request.kind === 'reverse') {
    const url = new URL(`${ORS_BASE}/reverse`)
    url.searchParams.set('point.lat', String(request.point.lat))
    url.searchParams.set('point.lon', String(request.point.lng))
    url.searchParams.set('size', '1')
    url.searchParams.set('boundary.country', 'US')
    return url
  }
  const url = new URL(`${ORS_BASE}/search`)
  url.searchParams.set('text', request.q)
  url.searchParams.set('size', String(MAX_RESULTS))
  url.searchParams.set('boundary.country', 'US')
  if (request.focus) {
    url.searchParams.set('focus.point.lat', String(request.focus.lat))
    url.searchParams.set('focus.point.lon', String(request.focus.lng))
  }
  return url
}

/**
 * The address part of a Pelias label: "Arches National Park, Grand County,
 * UT, USA" with name "Arches National Park" gives "Grand County, UT, USA".
 */
function addressFrom(name: string, label: string): string {
  const prefix = `${name}, `
  return label.startsWith(prefix) ? label.slice(prefix.length) : label
}

/** Converts an ORS GeoJSON FeatureCollection to places, skipping bad features. */
export function toPlaces(collection: unknown): Place[] {
  if (!isRecord(collection) || !Array.isArray(collection.features)) {
    throw new Error('Unexpected ORS response')
  }
  const places: Place[] = []
  for (const feature of collection.features) {
    if (!isRecord(feature)) continue
    const { geometry, properties } = feature
    if (!isRecord(geometry) || !isRecord(properties)) continue
    const coordinates = geometry.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue
    const [lng, lat] = coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    const label = typeof properties.label === 'string' ? properties.label : ''
    const name =
      typeof properties.name === 'string' && properties.name !== ''
        ? properties.name
        : label
    if (name === '') continue
    places.push({ name, address: addressFrom(name, label), lat, lng })
  }
  return places
}

/** Calls ORS and returns places, turning ORS failures into clear HTTP errors. */
export async function geocode(
  request: GeocodeRequest,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Place[]> {
  let res: Response
  try {
    res = await fetchFn(orsUrl(request), {
      headers: { authorization: apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    console.error('ORS geocode request failed', error)
    throw new HttpError(502, 'Place search is unavailable right now')
  }
  if (res.status === 429) {
    await res.body?.cancel()
    throw new HttpError(
      429,
      'Place search is busy (rate limit reached). Try again in a minute.',
    )
  }
  if (!res.ok) {
    // Log ORS's message for debugging; never echo it (or the key) to the client.
    console.error('ORS geocode error', res.status, await res.text())
    throw new HttpError(502, 'Place search failed')
  }
  try {
    const places = toPlaces(await res.json())
    return request.kind === 'reverse' ? places.slice(0, 1) : places
  } catch (error) {
    console.error('ORS geocode response was not usable', error)
    throw new HttpError(502, 'Place search failed')
  }
}
