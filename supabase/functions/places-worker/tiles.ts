// The places tile grid (see the places_cache migration) and the worker's
// retry schedule.

/** Tiles are TILE_DEG × TILE_DEG cells keyed by their south-west corner. */
export const TILE_DEG = 0.5

export interface TileBounds {
  south: number
  west: number
  north: number
  east: number
}

/** The tile's edges, from its key '<lat>_<lng>' (e.g. '43.5_-98.5'). */
export function tileBounds(tileKey: string): TileBounds {
  const match = /^(-?\d{1,2}\.[05])_(-?\d{1,3}\.[05])$/.exec(tileKey)
  if (!match) throw new Error(`Bad tile key: ${tileKey}`)
  const south = Number(match[1])
  const west = Number(match[2])
  return { south, west, north: south + TILE_DEG, east: west + TILE_DEG }
}

/**
 * Whether a point is in the tile. Like public.place_tile_key(), a point on a
 * grid line belongs to the tile to its north / east.
 */
export function inTile(bounds: TileBounds, lat: number, lng: number): boolean {
  return (
    lat >= bounds.south &&
    lat < bounds.north &&
    lng >= bounds.west &&
    lng < bounds.east
  )
}

const MINUTE = 60 * 1000
export const FIRST_RETRY_MS = 15 * MINUTE
export const MAX_RETRY_MS = 7 * 24 * 60 * MINUTE

/**
 * How long to wait before retrying a tile that has failed `attempts` times in
 * a row: 15 minutes, then 4× longer each time (1 h, 4 h, 16 h, ...), at most a
 * week. Tiles are never given up on, since Overpass outages can last days.
 */
export function retryDelayMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts))
  return Math.min(FIRST_RETRY_MS * 4 ** (n - 1), MAX_RETRY_MS)
}
