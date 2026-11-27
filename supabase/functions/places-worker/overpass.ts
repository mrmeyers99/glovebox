// Fetching one tile's candidate places from OpenStreetMap through the
// Overpass API, and turning the answer into places ready for dedupe().
import {
  ARTWORK_TYPES,
  classifyCandidate,
  HISTORIC_NEEDS_WIKIDATA,
  HISTORIC_SITES,
  MEMORIAL_STATUES,
  NATURAL,
  PARKS,
  type PlaceKind,
  TOURISM_ATTRACTIONS,
  TOURISM_CAMPGROUNDS,
} from '../_shared/places/mod.ts'
import type { DedupePlace, LatLngTuple } from '../_shared/places/dedupe.ts'
import type { TileBounds } from './tiles.ts'

/** Public Overpass instances, tried in this order. */
export const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/** Overpass's own time limit for a query, in seconds. */
export const QUERY_TIMEOUT_S = 90

/**
 * OSM tags kept in places.tags: what the app shows or filters on (website,
 * opening hours, campground amenities) and what ranking reads. Others are
 * dropped to keep the cache small.
 */
export const STORED_TAGS: ReadonlySet<string> = new Set([
  'access',
  'artwork_type',
  'backcountry',
  'boundary',
  'capacity',
  'caravans',
  'charge',
  'contact:phone',
  'contact:website',
  'description',
  'drinking_water',
  'fee',
  'heritage',
  'historic',
  'image',
  'internet_access',
  'leisure',
  'man_made',
  'memorial',
  'motorhome',
  'natural',
  'opening_hours',
  'operator',
  'phone',
  'power_supply',
  'protect_class',
  'reservation',
  'sanitary_dump_station',
  'shower',
  'start_date',
  'tents',
  'toilets',
  'tourism',
  'url',
  'waterway',
  'website',
  'wheelchair',
  'wikidata',
  'wikimedia_commons',
  'wikipedia',
])

/**
 * The Overpass QL query for one tile: every named element that
 * classifyCandidate() could accept (see candidates.ts), with tags, and
 * coordinates for nodes or a bounding box for ways and relations.
 * The worker still runs classifyCandidate() on each element, since a query
 * can't express its exclusions.
 */
export function buildQuery(bounds: TileBounds): string {
  const { south, west, north, east } = bounds
  const any = (values: Iterable<string>) => `~"^(${[...values].join('|')})$"`
  const selectors = [
    `["tourism"${any([...TOURISM_ATTRACTIONS, ...TOURISM_CAMPGROUNDS])}]`,
    `["tourism"="artwork"]["artwork_type"${any(ARTWORK_TYPES)}]`,
    `["historic"${any([...HISTORIC_SITES, 'windmill'])}]`,
    `["historic"="memorial"]["memorial"${any(MEMORIAL_STATUES)}]`,
    `["historic"${any(HISTORIC_NEEDS_WIKIDATA)}]["wikidata"]`,
    `["natural"${any(NATURAL)}]`,
    `["waterway"="waterfall"]`,
    `["man_made"="windmill"]`,
    ...PARKS.map(([key, value]) => `["${key}"="${value}"]["wikidata"]`),
  ]
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${south},${west},${north},${east}];`,
    '(',
    ...selectors.map((s) => `  nwr${s}["name"];`),
    ')->.found;',
    // Nodes with their coordinates; ways and relations with a bounding box
    // instead of every member, which keeps big parks small.
    'node.found;',
    'out body qt;',
    '(way.found; relation.found;);',
    'out tags bb qt;',
  ].join('\n')
}

/** One element of an Overpass JSON answer (see buildQuery for the fields). */
export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }
  tags?: Record<string, string>
}

/** A candidate place from OSM, as stored in places (source 'osm'). */
export interface OsmPlace extends DedupePlace {
  /** 'node/123', 'way/456' or 'relation/789'. */
  id: string
  kind: PlaceKind
  category: string
  wikidata: string | null
  tags: Record<string, string>
}

/**
 * The candidates in an Overpass answer. Elements that aren't candidates, or
 * have no position, are dropped. A way or relation is placed at the centre of
 * its bounding box, which is also its outline (for nesting in dedupe()).
 */
export function parseElements(
  elements: readonly OverpassElement[],
): OsmPlace[] {
  const places: OsmPlace[] = []
  for (const element of elements) {
    const tags = element.tags ?? {}
    const candidate = classifyCandidate(tags)
    if (!candidate) continue
    const position = positionOf(element)
    if (!position) continue
    const wikidata = /^Q[0-9]+$/.test(tags.wikidata ?? '')
      ? tags.wikidata!
      : null
    places.push({
      id: `${element.type}/${element.id}`,
      name: tags.name.trim(),
      kind: candidate.kind,
      category: candidate.category,
      wikidata,
      ...position,
      tags: storedTags(tags),
    })
  }
  return places
}

function positionOf(
  element: OverpassElement,
): { lat: number; lng: number; outline: LatLngTuple[] | null } | null {
  if (element.type === 'node') {
    if (!Number.isFinite(element.lat) || !Number.isFinite(element.lon))
      return null
    return { lat: element.lat!, lng: element.lon!, outline: null }
  }
  const b = element.bounds
  if (!b || ![b.minlat, b.minlon, b.maxlat, b.maxlon].every(Number.isFinite)) {
    return null
  }
  return {
    lat: (b.minlat + b.maxlat) / 2,
    lng: (b.minlon + b.maxlon) / 2,
    outline: [
      [b.minlat, b.minlon],
      [b.minlat, b.maxlon],
      [b.maxlat, b.maxlon],
      [b.maxlat, b.minlon],
    ],
  }
}

function storedTags(tags: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags)) {
    if (STORED_TAGS.has(key) || key.startsWith('addr:')) kept[key] = value
  }
  return kept
}

export interface FetchOptions {
  fetchFn?: typeof fetch
  servers?: readonly string[]
  /** Sent as User-Agent, with a contact address (Overpass usage policy). */
  userAgent: string
  /** Gives up on the whole tile (all servers) at this time (ms since epoch). */
  deadline: number
  now?: () => number
}

/**
 * Runs the query on each server in turn until one answers, and returns its
 * elements. A server that refuses, times out, is rate-limiting (429) or
 * answers with a runtime error (Overpass sends those as a 200 with a
 * "remark") is skipped. Throws, listing each server's error, when none answer.
 */
export async function fetchOverpass(
  query: string,
  {
    fetchFn = fetch,
    servers = OVERPASS_SERVERS,
    userAgent,
    deadline,
    now = Date.now,
  }: FetchOptions,
): Promise<OverpassElement[]> {
  const errors: string[] = []
  for (const server of servers) {
    const remaining = deadline - now()
    if (remaining <= 0) {
      errors.push(`${host(server)}: out of time`)
      break
    }
    try {
      const response = await fetchFn(server, {
        method: 'POST',
        headers: {
          'user-agent': userAgent,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(remaining),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`HTTP ${response.status}`)
      }
      const body = await response.json()
      if (
        typeof body?.remark === 'string' &&
        /error|timed out/i.test(body.remark)
      ) {
        throw new Error(body.remark)
      }
      if (!Array.isArray(body?.elements))
        throw new Error('no elements in answer')
      return body.elements
    } catch (error) {
      errors.push(`${host(server)}: ${messageOf(error)}`)
    }
  }
  throw new Error(`Overpass unavailable (${errors.join('; ')})`)
}

function host(url: string): string {
  return new URL(url).host
}

function messageOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return 'timed out'
  return error instanceof Error ? error.message : String(error)
}
