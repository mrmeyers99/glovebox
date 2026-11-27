// Campground coverage report (issue #64): how many campgrounds OSM has along
// a corridor, how many carry each amenity tag, and how many are linked to a
// park. Runs the worker's own pipeline (Overpass → placesForTile) on each
// tile, without the database. Not deployed: run it by hand, e.g.
//
//   CONTACT_EMAIL=you@example.com deno run --allow-net --allow-env \
//     places-worker/campground_report.ts [tile keys...]
//
// With no tile keys it reports the test corridor, Mitchell, SD → Waterloo, IA.
import {
  amenityCompleteness,
  type CampgroundAmenities,
  COMPLETENESS_FIELDS,
} from '../_shared/places/mod.ts'
import { contactUserAgent } from '../_shared/user_agent.ts'
import { findPark, parseParks } from './campgrounds.ts'
import { placesForTile } from './index.ts'
import {
  buildQuery,
  fetchOverpass,
  OVERPASS_SERVERS,
  type OverpassElement,
} from './overpass.ts'
import type { StoredPlace } from './store.ts'
import { tileBounds } from './tiles.ts'

/**
 * The tiles within 80 km (CORRIDOR_RADIUS_KM) of Mitchell, SD → Sioux Falls
 * → Worthington, MN → Spencer, IA → Fort Dodge → Waterloo, IA: the ranking
 * study's corridor, from web/src/lib/corridor.ts's corridorTiles().
 */
export const TEST_CORRIDOR: readonly string[] = [
  '41.5',
  '42.0',
  '42.5',
  '43.0',
  '43.5',
  '44.0',
].flatMap(tileRange)

function tileRange(lat: string): string[] {
  const [west, east] = {
    '41.5': [-95, -92],
    '42.0': [-96, -91.5],
    '42.5': [-98.5, -91.5],
    '43.0': [-99.5, -92],
    '43.5': [-99.5, -94.5],
    '44.0': [-99, -95],
  }[lat]!
  const keys: string[] = []
  for (let lng = west; lng <= east; lng += 0.5) {
    keys.push(`${lat}_${lng.toFixed(1)}`)
  }
  return keys
}

/** A campground as stored, with what the report needs to know about it. */
export interface ReportCampground {
  place: StoredPlace
  amenities: CampgroundAmenities
  /** Named in OSM (not named by us after its park). */
  namedInOsm: boolean
  /** In or within 1 km of any park or protected area, ranked or not. */
  nearPark: boolean
}

/** The campgrounds that the worker would store for a tile. */
export function tileCampgrounds(
  elements: readonly OverpassElement[],
  tileKey: string,
): ReportCampground[] {
  const parks = parseParks(elements)
  const named = new Set(
    elements
      .filter((e) => e.tags?.name?.trim())
      .map((e) => `${e.type}/${e.id}`),
  )
  return placesForTile(elements, tileBounds(tileKey))
    .filter((p) => p.kind === 'campground')
    .map((place) => ({
      place,
      amenities: place.tags.amenities as CampgroundAmenities,
      namedInOsm: named.has(place.source_id),
      nearPark: findPark(place, parks) !== null,
    }))
}

const percent = (n: number, total: number) =>
  total === 0 ? '–' : `${Math.round((100 * n) / total)}%`

/** The report as Markdown. */
export function formatReport(
  campgrounds: readonly ReportCampground[],
  tiles: { done: number; failed: string[] },
): string {
  const total = campgrounds.length
  const count = (test: (c: ReportCampground) => boolean) =>
    campgrounds.filter(test).length
  const row = (label: string, n: number) =>
    `| ${label} | ${n} | ${percent(n, total)} |`

  const lines = [
    `**${total} campgrounds** in ${tiles.done} tiles` +
      (tiles.failed.length
        ? ` (${tiles.failed.length} tiles failed: ${tiles.failed.join(', ')})`
        : ''),
    '',
    '| | Campgrounds | Share |',
    '| --- | ---: | ---: |',
    row(
      'Caravan sites (tourism=caravan_site)',
      count((c) => c.place.category === 'tourism=caravan_site'),
    ),
    row(
      'Named in OSM',
      count((c) => c.namedInOsm),
    ),
    row(
      'Unnamed, named after their park',
      count((c) => !c.namedInOsm && c.place.name !== 'Campground'),
    ),
    row(
      'Unnamed, no park ("Campground")',
      count((c) => !c.namedInOsm && c.place.name === 'Campground'),
    ),
    row(
      'Linked to a ranked park (parent_place_id)',
      count((c) => c.place.parent_source_id !== null),
    ),
    row(
      'In or within 1 km of any park',
      count((c) => c.nearPark),
    ),
    row(
      'Ownership known',
      count((c) => c.amenities.ownership !== null),
    ),
    row(
      'Public',
      count((c) => c.amenities.ownership === 'public'),
    ),
    '',
    '| Amenity | Tagged | Share | Of those, yes |',
    '| --- | ---: | ---: | ---: |',
  ]
  const fields = [...COMPLETENESS_FIELDS, 'phone', 'operator'] as const
  for (const field of fields) {
    const tagged = campgrounds.filter((c) => c.amenities[field] !== null)
    const yes = tagged.filter((c) => c.amenities[field] !== false).length
    const share =
      typeof tagged[0]?.amenities[field] === 'boolean'
        ? percent(yes, tagged.length)
        : '–'
    lines.push(
      `| ${field} | ${tagged.length} | ${percent(tagged.length, total)} | ${share} |`,
    )
  }
  const mean =
    total === 0
      ? 0
      : campgrounds.reduce((s, c) => s + amenityCompleteness(c.amenities), 0) /
        total
  lines.push('', `Mean amenity completeness: ${percent(mean, 1)}`)
  return lines.join('\n')
}

export interface ReportOptions {
  fetchFn?: typeof fetch
  servers?: readonly string[]
  userAgent: string
  /** Pause between tiles, to be gentle with Overpass. */
  pauseMs?: number
  /** Per tile, across servers. */
  tileTimeoutMs?: number
  log?: (line: string) => void
}

/** Fetches each tile in turn and reports on its campgrounds. */
export async function runReport(
  tiles: readonly string[],
  {
    fetchFn = fetch,
    servers = OVERPASS_SERVERS,
    userAgent,
    pauseMs = 2000,
    tileTimeoutMs = 60_000,
    log = console.error,
  }: ReportOptions,
): Promise<string> {
  const campgrounds: ReportCampground[] = []
  const failed: string[] = []
  for (const [i, tile] of tiles.entries()) {
    if (i > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs))
    try {
      const elements = await fetchOverpass(buildQuery(tileBounds(tile)), {
        fetchFn,
        servers,
        userAgent,
        deadline: Date.now() + tileTimeoutMs,
      })
      const found = tileCampgrounds(elements, tile)
      campgrounds.push(...found)
      log(`${tile}: ${found.length} campgrounds (${elements.length} elements)`)
    } catch (error) {
      failed.push(tile)
      log(`${tile}: failed: ${error instanceof Error ? error.message : error}`)
    }
  }
  return formatReport(campgrounds, {
    done: tiles.length - failed.length,
    failed,
  })
}

if (import.meta.main) {
  const tiles = Deno.args.length ? Deno.args : TEST_CORRIDOR
  console.log(await runReport(tiles, { userAgent: contactUserAgent() }))
}
