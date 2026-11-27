// Ranking places within their area (requirements §9). A quirky stop with no
// Wikipedia presence (Porter Sculpture Park, say) scores low nationally but
// can still be the best thing on an empty stretch of road, so suggestions are
// ranked as a percentile among the places around them: by default, the
// place's map tile and its eight neighbours.
//
// Pure logic, no I/O.

/** Size of a map tile in degrees (matches public.place_tile_key()). */
export const TILE_SIZE_DEG = 0.5

/**
 * The key of the 0.5° tile containing a point: its south-west corner as
 * '<lat>_<lng>' with one decimal, e.g. (42.7, -96.2) → '42.5_-96.5'. A point
 * on a grid line belongs to the tile to its north / east. Matches the
 * database's public.place_tile_key().
 */
export function tileKey(lat: number, lng: number): string {
  return `${corner(lat)}_${corner(lng)}`
}

/**
 * The tile and its (up to) eight neighbours, wrapping around the
 * antimeridian. Rows beyond the poles are left out.
 */
export function tileNeighbourhood(key: string): string[] {
  const [lat, lng] = key.split('_').map(Number)
  const keys: string[] = []
  for (const dLat of [-TILE_SIZE_DEG, 0, TILE_SIZE_DEG]) {
    const south = lat + dLat
    if (south < -90 || south >= 90) continue
    for (const dLng of [-TILE_SIZE_DEG, 0, TILE_SIZE_DEG]) {
      const west = ((lng + dLng + 540) % 360) - 180
      keys.push(`${south.toFixed(1)}_${west.toFixed(1)}`)
    }
  }
  return [...new Set(keys)]
}

function corner(deg: number): string {
  // Multiplying by 2 is exact in floating point, so this matches the
  // database's numeric floor(). `+ 0` turns -0 into 0.
  return (Math.floor(deg / TILE_SIZE_DEG) * TILE_SIZE_DEG + 0).toFixed(1)
}

export interface PercentileOptions<T> {
  /** The place's score; null or undefined (not yet enriched) is not ranked. */
  score: (place: T) => number | null | undefined
  /**
   * The keys of the groups a place is compared against, given its own group.
   * Defaults to just its own group; use tileNeighbourhood for "a tile and its
   * neighbours".
   */
  neighbours?: (key: string) => readonly string[]
}

/**
 * Each place's percentile among the scored places in its neighbourhood, from
 * 0 (the lowest) to 1 (the best around here), in input order. Ties share
 * their middle rank; a place alone in its neighbourhood gets 1. Unscored
 * places get null and don't count for others.
 *
 * @param groupBy the place's group, e.g. (p) => p.tile_key
 */
export function localPercentile<T>(
  places: readonly T[],
  groupBy: (place: T) => string,
  { score, neighbours = (key) => [key] }: PercentileOptions<T>,
): (number | null)[] {
  const scores = new Map<string, number[]>()
  for (const place of places) {
    const s = score(place)
    if (s == null || !Number.isFinite(s)) continue
    const key = groupBy(place)
    const list = scores.get(key) ?? []
    list.push(s)
    scores.set(key, list)
  }

  const pools = new Map<string, number[]>()
  const poolFor = (key: string): number[] => {
    let pool = pools.get(key)
    if (!pool) {
      const keys = new Set([key, ...neighbours(key)])
      pool = [...keys].flatMap((k) => scores.get(k) ?? []).sort((a, b) => a - b)
      pools.set(key, pool)
    }
    return pool
  }

  return places.map((place) => {
    const s = score(place)
    if (s == null || !Number.isFinite(s)) return null
    const pool = poolFor(groupBy(place))
    if (pool.length === 1) return 1
    const below = lowerBound(pool, s)
    const equal = lowerBound(pool, s, true) - below
    return (below + (equal - 1) / 2) / (pool.length - 1)
  })
}

/** The number of values in sorted `xs` below `x` (or at most `x`, if `orEqual`). */
function lowerBound(xs: readonly number[], x: number, orEqual = false): number {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x || (orEqual && xs[mid] === x)) lo = mid + 1
    else hi = mid
  }
  return lo
}
