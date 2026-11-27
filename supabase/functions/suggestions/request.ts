// Input validation for the suggestions function.
import { HttpError } from '../_shared/http.ts'
import { type PlaceKind, tileKey } from '../_shared/places/mod.ts'

/**
 * The most tiles one request may ask for. The web app's corridor (80 km
 * either side of the route, web/src/lib/corridor.ts) is about 380 tiles for a
 * straight New York to Los Angeles line; roads are longer.
 */
export const MAX_TILES = 500

const KINDS: readonly PlaceKind[] = ['attraction', 'campground']

export interface SuggestionsRequest {
  /** Unique tile keys, in input order. */
  tiles: string[]
  kind: PlaceKind
}

/**
 * Whether `key` is a tile key exactly as public.place_tile_key() writes it:
 * '<lat>_<lng>' of a tile's south-west corner, e.g. '42.5_-96.5'.
 */
export function isTileKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  const match = /^(-?\d{1,2}\.[05])_(-?\d{1,3}\.[05])$/.exec(key)
  if (!match) return false
  const lat = Number(match[1])
  const lng = Number(match[2])
  return (
    lat >= -90 &&
    lat < 90 &&
    lng >= -180 &&
    lng < 180 &&
    tileKey(lat, lng) === key
  )
}

/** Parses `{ tiles: string[], kind }`; throws HttpError(400) if invalid. */
export function parseSuggestionsRequest(body: unknown): SuggestionsRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be an object')
  }
  const { tiles, kind } = body as Record<string, unknown>
  if (!KINDS.includes(kind as PlaceKind)) {
    throw new HttpError(400, `kind must be one of: ${KINDS.join(', ')}`)
  }
  if (!Array.isArray(tiles)) {
    throw new HttpError(400, 'tiles must be an array of tile keys')
  }
  if (tiles.length > MAX_TILES) {
    throw new HttpError(400, `At most ${MAX_TILES} tiles per request`)
  }
  const bad = tiles.find((key) => !isTileKey(key))
  if (bad !== undefined) {
    throw new HttpError(400, `Not a tile key: ${JSON.stringify(bad)}`)
  }
  return { tiles: [...new Set(tiles as string[])], kind: kind as PlaceKind }
}
