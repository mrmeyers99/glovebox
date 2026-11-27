// Merging duplicate places and nesting places inside larger ones (requirements
// §9). OSM often maps one attraction twice (a node and a building outline, or
// a park and its visitor centre with the same name), and a ride inside a theme
// park or a campground inside a state park should be shown under its parent
// rather than as a separate suggestion.
//
// Pure logic, no I/O: the tile fill worker runs it before writing places.

import type { PlaceKind } from './candidates.ts'

/** [lat, lng] in degrees. */
export type LatLngTuple = readonly [number, number]

export interface DedupePlace {
  /** Any id unique within the input, e.g. the OSM id 'way/123'. */
  id: string
  name: string
  kind: PlaceKind
  /** Wikidata QID, e.g. 'Q1048837'. */
  wikidata?: string | null
  lat: number
  lng: number
  /**
   * The place's outline for areas (an OSM way or relation), as a ring of
   * [lat, lng] points; a bounding box works too. Only places with an outline
   * can be parents.
   */
  outline?: readonly LatLngTuple[] | null
  tags?: Readonly<Record<string, string>>
}

export type DedupedPlace<T extends DedupePlace> = T & {
  /** Ids of the other input places merged into this one. */
  mergedIds: string[]
  /** The id of the larger place this one is inside (places.parent_place_id). */
  parentId: string | null
}

/** Places with the same name closer than this are the same place. */
export const SAME_NAME_RADIUS_M = 2000

/**
 * Merges duplicates, then nests places inside larger ones.
 *
 * Two places of the same kind are duplicates when they have the same Wikidata
 * QID, or the same name (ignoring case, accents and punctuation) within 2 km
 * and no conflicting QIDs. The merged place keeps the fields of the best entry
 * (one with a QID, then one with an outline, then the most tags, then the
 * first), fills in a QID, outline and tags it lacks from the others, and lists
 * the ids it absorbed in mergedIds.
 *
 * A place's parent is the smallest other place whose outline contains it and
 * is larger than its own (if it has one). Output keeps the input order of each
 * group's first entry.
 */
export function dedupe<T extends DedupePlace>(
  places: readonly T[],
): DedupedPlace<T>[] {
  return nest(merge(places))
}

function merge<T extends DedupePlace>(places: readonly T[]): T[][] {
  const groups: { members: T[]; qid: string | null }[] = []
  const byQid = new Map<string, number>()
  const byName = new Map<string, number[]>()

  for (const place of places) {
    const qid = place.wikidata || null
    const name = normalizeName(place.name)
    const nameKey = `${place.kind}|${name}`

    let index = qid ? byQid.get(`${place.kind}|${qid}`) : undefined
    if (index === undefined && name) {
      index = byName.get(nameKey)?.find((i) => {
        const group = groups[i]
        return (
          (!qid || !group.qid || group.qid === qid) &&
          group.members.some((m) => distanceM(m, place) <= SAME_NAME_RADIUS_M)
        )
      })
    }

    if (index === undefined) {
      index = groups.length
      groups.push({ members: [], qid: null })
    }
    const group = groups[index]
    group.members.push(place)
    if (qid && !group.qid) {
      group.qid = qid
      byQid.set(`${place.kind}|${qid}`, index)
    }
    if (name) {
      const list = byName.get(nameKey) ?? []
      if (!list.includes(index)) list.push(index)
      byName.set(nameKey, list)
    }
  }
  return groups.map((g) => g.members)
}

function nest<T extends DedupePlace>(groups: T[][]): DedupedPlace<T>[] {
  const merged = groups.map(combine)
  const areas = merged
    .filter((p) => p.outline && p.outline.length >= 3)
    .map((p) => ({ place: p, area: ringArea(p.outline!) }))
    .sort((a, b) => a.area - b.area)

  for (const place of merged) {
    const ownArea =
      place.outline && place.outline.length >= 3 ? ringArea(place.outline) : 0
    const parent = areas.find(
      ({ place: candidate, area }) =>
        candidate !== place &&
        area > ownArea &&
        pointInRing(place.lat, place.lng, candidate.outline!),
    )
    place.parentId = parent?.place.id ?? null
  }
  return merged
}

/** Combines one group of duplicates into a single place. */
function combine<T extends DedupePlace>(members: T[]): DedupedPlace<T> {
  const best = members.reduce((a, b) => (rank(b) > rank(a) ? b : a))
  const others = members.filter((m) => m !== best)
  // Earlier duplicates win over later ones, and the kept entry over all.
  const tags = Object.assign(
    {},
    ...others.map((m) => m.tags).reverse(),
    best.tags,
  )
  return {
    ...best,
    wikidata: best.wikidata || others.find((m) => m.wikidata)?.wikidata || null,
    outline: best.outline ?? others.find((m) => m.outline)?.outline ?? null,
    tags,
    mergedIds: others.map((m) => m.id),
    parentId: null,
  }
}

/** Preference for which duplicate to keep: QID, then outline, then tag count. */
function rank(place: DedupePlace): number {
  return (
    (place.wikidata ? 2000 : 0) +
    (place.outline ? 1000 : 0) +
    Math.min(Object.keys(place.tags ?? {}).length, 999)
  )
}

/**
 * Lowercases, strips accents and punctuation, collapses spaces and drops a
 * leading "the", so "The Corn Palace" and "Corn  Palace" match.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '')
}

const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance between two points, in metres. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Ray casting: whether (lat, lng) is inside the ring. */
function pointInRing(
  lat: number,
  lng: number,
  ring: readonly LatLngTuple[],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i]
    const [latJ, lngJ] = ring[j]
    if (
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
    ) {
      inside = !inside
    }
  }
  return inside
}

/** A ring's area in square degrees (shoelace). Only used to compare sizes. */
function ringArea(ring: readonly LatLngTuple[]): number {
  let twice = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][1] * ring[i][0] - ring[i][1] * ring[j][0]
  }
  return Math.abs(twice) / 2
}
