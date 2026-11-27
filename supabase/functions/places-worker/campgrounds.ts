// Campgrounds in a tile (requirements §9): naming unnamed ones, and linking
// each to the park or protected area it is in (or right next to), whose
// ranking it inherits. Overpass returns those parks' outlines with the tile's
// places (see buildQuery), so this needs no further requests.
//
// Pure logic, no I/O.
import {
  distanceM,
  type DedupedPlace,
  type LatLngTuple,
  PARKS,
} from '../_shared/places/mod.ts'
import type { OsmPlace, OverpassElement } from './overpass.ts'

/** A campground this close to a park (and not in any) counts as in it. */
export const PARK_RADIUS_M = 1000
/** An unnamed campground this close to a named one is the same campground. */
export const SAME_CAMPGROUND_RADIUS_M = 250

/** A park's outline, for finding the park a campground is in. */
export interface ParkOutline {
  /** 'way/456' or 'relation/789'. */
  id: string
  name: string | null
  /**
   * The outline's lines: one closed ring for a way; for a relation its
   * members' lines, which together close into its outer and inner rings.
   */
  lines: LatLngTuple[][]
  /** Its bounding box's area in square degrees, to prefer the smallest park. */
  area: number
}

type Point = { lat: number; lng: number }
type GeometryPoint = { lat: number; lon: number } | null

/** The parks with an outline in an Overpass answer (from `out geom`). */
export function parseParks(
  elements: readonly OverpassElement[],
): ParkOutline[] {
  const parks: ParkOutline[] = []
  for (const element of elements) {
    const tags = element.tags ?? {}
    if (!PARKS.some(([key, value]) => tags[key] === value)) continue
    let lines: LatLngTuple[][] = []
    if (element.type === 'way' && element.geometry) {
      lines = splitLine(element.geometry).map(closeRing)
    } else if (element.type === 'relation') {
      lines = (element.members ?? []).flatMap((m) =>
        m.type === 'way' && m.geometry ? splitLine(m.geometry) : [],
      )
    }
    if (lines.length === 0) continue
    parks.push({
      id: `${element.type}/${element.id}`,
      name: tags.name?.trim() || null,
      lines,
      area: boxArea(lines),
    })
  }
  return parks
}

/** A line's points, split where Overpass left out a point (null). */
function splitLine(geometry: readonly GeometryPoint[]): LatLngTuple[][] {
  const lines: LatLngTuple[][] = [[]]
  for (const point of geometry) {
    if (point && Number.isFinite(point.lat) && Number.isFinite(point.lon)) {
      lines[lines.length - 1].push([point.lat, point.lon])
    } else if (lines[lines.length - 1].length > 0) {
      lines.push([])
    }
  }
  return lines.filter((line) => line.length >= 2)
}

function closeRing(line: LatLngTuple[]): LatLngTuple[] {
  const [first, last] = [line[0], line[line.length - 1]]
  return first[0] === last[0] && first[1] === last[1] ? line : [...line, first]
}

function boxArea(lines: readonly LatLngTuple[][]): number {
  // A loop, not Math.min(...): a big park has too many points to spread.
  let [south, west, north, east] = [90, 180, -90, -180]
  for (const line of lines) {
    for (const [lat, lng] of line) {
      south = Math.min(south, lat)
      north = Math.max(north, lat)
      west = Math.min(west, lng)
      east = Math.max(east, lng)
    }
  }
  return (north - south) * (east - west)
}

/**
 * Even-odd ray casting over every segment of the outline. Counting crossings
 * over all of a relation's member lines needs no ring assembly: each closed
 * ring contributes its own crossings, so holes (inner rings) work too.
 */
export function insideOutline(
  point: Point,
  lines: readonly LatLngTuple[][],
): boolean {
  let inside = false
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [latA, lngA] = line[i - 1]
      const [latB, lngB] = line[i]
      if (
        latA > point.lat !== latB > point.lat &&
        point.lng < ((lngB - lngA) * (point.lat - latA)) / (latB - latA) + lngA
      ) {
        inside = !inside
      }
    }
  }
  return inside
}

const M_PER_DEG = 111_320

/**
 * Shortest distance in metres from a point to the outline's lines, treating
 * the area around the point as flat (plenty for a 1 km radius).
 */
export function distanceToOutlineM(
  point: Point,
  lines: readonly LatLngTuple[][],
): number {
  const kx = M_PER_DEG * Math.cos((point.lat * Math.PI) / 180)
  let best = Infinity
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][1] - point.lng) * kx
      const ay = (line[i - 1][0] - point.lat) * M_PER_DEG
      const dx = (line[i][1] - point.lng) * kx - ax
      const dy = (line[i][0] - point.lat) * M_PER_DEG - ay
      const lengthSq = dx * dx + dy * dy
      const t =
        lengthSq === 0
          ? 0
          : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSq))
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    }
  }
  return best
}

/**
 * The park a campground belongs to: the smallest park whose outline contains
 * it, or else the closest within PARK_RADIUS_M. Null if neither.
 */
export function findPark(
  point: Point,
  parks: readonly ParkOutline[],
): ParkOutline | null {
  let containing: ParkOutline | null = null
  for (const park of parks) {
    if (
      (!containing || park.area < containing.area) &&
      insideOutline(point, park.lines)
    ) {
      containing = park
    }
  }
  if (containing) return containing
  let closest: ParkOutline | null = null
  let closestM = PARK_RADIUS_M
  for (const park of parks) {
    const m = distanceToOutlineM(point, park.lines)
    if (m <= closestM) {
      closest = park
      closestM = m
    }
  }
  return closest
}

/** The name shown for an unnamed campground. */
export function campgroundName(park: ParkOutline | null): string {
  return park?.name ? `Campground at ${park.name}` : 'Campground'
}

/**
 * Finishes the campgrounds among deduped places:
 * - each one's parent is its park (findPark) when that park is a place here
 *   (a candidate: parks need a Wikidata item), else none; the outline nesting
 *   in dedupe() is replaced, since parks' real outlines are known here;
 * - an unnamed one is named after its park ("Campground at Palisades State
 *   Park"), or just "Campground";
 * - an unnamed one within SAME_CAMPGROUND_RADIUS_M of a named one is dropped,
 *   since OSM often maps a campground twice (a named point and an unnamed
 *   outline).
 * Other places are returned unchanged, in the same order.
 */
export function finishCampgrounds<T extends DedupedPlace<OsmPlace>>(
  places: readonly T[],
  parks: readonly ParkOutline[],
): T[] {
  const placeIds = new Map<string, string>()
  for (const place of places) {
    placeIds.set(place.id, place.id)
    for (const id of place.mergedIds) placeIds.set(id, place.id)
  }
  const named = places.filter((p) => p.kind === 'campground' && p.name)

  const result: T[] = []
  for (const place of places) {
    if (place.kind !== 'campground') {
      result.push(place)
      continue
    }
    if (
      !place.name &&
      named.some((n) => distanceM(n, place) <= SAME_CAMPGROUND_RADIUS_M)
    ) {
      continue
    }
    const park = findPark(place, parks)
    result.push({
      ...place,
      name: place.name || campgroundName(park),
      parentId: (park && placeIds.get(park.id)) ?? null,
    })
  }
  return result
}
