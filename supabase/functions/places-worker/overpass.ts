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
import { PARK_RADIUS_M } from './campgrounds.ts'

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
  'capacity:caravans',
  'capacity:motorhomes',
  'capacity:pitches',
  'capacity:tents',
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
  'operator:type',
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
  'water_point',
  'waterway',
  'website',
  'wheelchair',
  'wikidata',
  'wikimedia_commons',
  'wikipedia',
])

/**
 * The Overpass QL query for one tile: every named element that
 * classifyCandidate() could accept (see candidates.ts), and every campground,
 * named or not, with tags, and coordinates for nodes or a bounding box for
 * ways and relations.
 *
 * It also returns the outlines of the parks and protected areas that contain
 * a campground or are within PARK_RADIUS_M of one (campgrounds.ts links each
 * campground to its park), whether or not they are candidates themselves.
 * The worker still runs classifyCandidate() on each element, since a query
 * can't express its exclusions.
 */
export function buildQuery(bounds: TileBounds): string {
  const { south, west, north, east } = bounds
  const any = (values: Iterable<string>) => `~"^(${[...values].join('|')})$"`
  const named = [
    `["tourism"${any(TOURISM_ATTRACTIONS)}]`,
    `["tourism"="artwork"]["artwork_type"${any(ARTWORK_TYPES)}]`,
    `["historic"${any([...HISTORIC_SITES, 'windmill'])}]`,
    `["historic"="memorial"]["memorial"${any(MEMORIAL_STATUES)}]`,
    `["historic"${any(HISTORIC_NEEDS_WIKIDATA)}]["wikidata"]`,
    `["natural"${any(NATURAL)}]`,
    `["waterway"="waterfall"]`,
    `["man_made"="windmill"]`,
    ...PARKS.map(([key, value]) => `["${key}"="${value}"]["wikidata"]`),
  ]
  // Parks by key: ["leisure"~"^(nature_reserve|park)$"], ["boundary"~…].
  const parkKeys = new Map<string, string[]>()
  for (const [key, value] of PARKS) {
    parkKeys.set(key, [...(parkKeys.get(key) ?? []), value])
  }
  const parkFilters = [...parkKeys].map(
    ([key, values]) => `["${key}"${any(values)}]`,
  )
  const parkSources = ['pivot.campAreas', `around.camps:${PARK_RADIUS_M}`]
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${south},${west},${north},${east}];`,
    `nwr["tourism"${any(TOURISM_CAMPGROUNDS)}]->.camps;`,
    '(',
    ...named.map((s) => `  nwr${s}["name"];`),
    '  .camps;',
    ')->.found;',
    // The areas each campground's points are in, then the parks among them
    // and those near a campground, with their outlines.
    '(node.camps; node(w.camps); way(r.camps); node(w);)->.campNodes;',
    '.campNodes is_in->.campAreas;',
    '(',
    ...parkSources.flatMap((source) =>
      ['way', 'relation'].flatMap((type) =>
        parkFilters.map((filter) => `  ${type}(${source})${filter};`),
      ),
    ),
    ')->.parks;',
    // Nodes with their coordinates; other ways and relations with a bounding
    // box instead of every member, which keeps big areas small.
    'node.found;',
    'out body qt;',
    '(way.found; relation.found;)->.areas;',
    '(.areas; - .parks;);',
    'out tags bb qt;',
    '.parks out body geom qt;',
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
  /** A way's points, from `out geom` (null where a point is missing). */
  geometry?: ({ lat: number; lon: number } | null)[]
  /** A relation's members, with their points from `out geom`. */
  members?: {
    type: 'node' | 'way' | 'relation'
    ref: number
    role: string
    geometry?: ({ lat: number; lon: number } | null)[]
  }[]
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
      // Only campgrounds can be unnamed; finishCampgrounds() names them.
      name: tags.name?.trim() ?? '',
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
  const b = element.bounds ?? geometryBounds(element)
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

/** A bounding box from `out geom` points, for an element that lacks one. */
function geometryBounds(element: OverpassElement) {
  const points = [
    ...(element.geometry ?? []),
    ...(element.members ?? []).flatMap((m) => m.geometry ?? []),
  ].filter((p) => p !== null)
  if (points.length === 0) return undefined
  // A loop, not Math.min(...): a big park has too many points to spread.
  const box = { minlat: 90, minlon: 180, maxlat: -90, maxlon: -180 }
  for (const { lat, lon } of points) {
    box.minlat = Math.min(box.minlat, lat)
    box.minlon = Math.min(box.minlon, lon)
    box.maxlat = Math.max(box.maxlat, lat)
    box.maxlon = Math.max(box.maxlon, lon)
  }
  return box
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
 * elements. Each server gets an even share of the time left before the
 * deadline. A server that refuses, times out, is rate-limiting (429) or
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
  for (const [index, server] of servers.entries()) {
    const remaining = deadline - now()
    if (remaining <= 0) {
      errors.push(`${host(server)}: out of time`)
      break
    }
    try {
      // GET, as overpass-api.de answers form POSTs from Supabase with HTTP
      // 406. The query fits in a URL (a tile's is about 2.6 kB encoded).
      const url = new URL(server)
      url.searchParams.set('data', query)
      const response = await fetchFn(url.toString(), {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
        // An even share of the time left, so a server that hangs leaves
        // time for the ones after it; the last one gets the rest.
        signal: AbortSignal.timeout(remaining / (servers.length - index)),
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
