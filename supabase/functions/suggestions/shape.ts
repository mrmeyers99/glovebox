// Turning cached places into the suggestions response. Pure logic, no I/O.
import {
  localPercentile,
  type PlaceKind,
  tileNeighbourhood,
} from '../_shared/places/mod.ts'
import type { PlaceRow, TileStatus } from './store.ts'

/** Width of the Commons thumbnail, in pixels. */
export const THUMBNAIL_WIDTH = 320

export interface PlaceImage {
  thumbnail_url: string
  /** The file's Commons page, where its author and licence are given in full. */
  page_url: string
  credit: string | null
  license: string | null
}

/**
 * What a campground offers, from its OSM tags. null means not known (the tag
 * isn't set).
 */
export interface CampgroundAmenities {
  tents: boolean | null
  /** Caravans or motorhomes allowed. */
  rvs: boolean | null
  /** Electric hookups (power_supply). */
  hookups: boolean | null
  showers: boolean | null
  toilets: boolean | null
  drinking_water: boolean | null
  fee: boolean | null
  /** OSM reservation=*: 'required', 'recommended', 'yes', 'no'... */
  reservation: string | null
  /** Number of pitches. */
  capacity: number | null
  website: string | null
}

export interface Suggestion {
  id: number
  name: string
  kind: PlaceKind
  category: string
  lat: number
  lng: number
  tile_key: string
  score: number
  /**
   * Rank among the suggestions in this tile and its neighbours, from 0 (the
   * lowest) to 1 (the best around here).
   */
  percentile: number
  image: PlaceImage | null
  wikipedia_url: string | null
  osm_url: string | null
  /** Only for campgrounds. */
  amenities: CampgroundAmenities | null
}

export interface SuggestionsResponse {
  /** Best first (by percentile, then score). */
  places: Suggestion[]
  /** Tiles queued or being fetched: ask again later. */
  pending: string[]
  /** Tiles the worker couldn't fetch (it retries them with back-off). */
  failed: string[]
  /**
   * Done tiles with places still waiting for a score: their scored places are
   * in `places`, and more may come. Ask again later.
   */
  scoring: string[]
}

/** Tiles whose places are needed to rank `tiles`: each one and its neighbours. */
export function rankingTiles(tiles: Iterable<string>): string[] {
  const keys = new Set<string>()
  for (const tile of tiles) {
    for (const key of tileNeighbourhood(tile)) keys.add(key)
  }
  return [...keys]
}

/**
 * Builds the response for the requested `tiles`.
 *
 * @param statuses each tile's status; a tile missing here was just queued
 * @param rows scored places in 'done' tiles: the requested tiles and their
 *   neighbours, which are only used for ranking
 * @param scoringTiles done tiles that still have unscored places
 */
export function shapeSuggestions(
  tiles: readonly string[],
  statuses: ReadonlyMap<string, TileStatus>,
  rows: readonly PlaceRow[],
  scoringTiles: ReadonlySet<string> = new Set(),
): SuggestionsResponse {
  const pending: string[] = []
  const failed: string[] = []
  const done = new Set<string>()
  for (const tile of tiles) {
    const status = statuses.get(tile) ?? 'pending'
    if (status === 'done') done.add(tile)
    else if (status === 'failed') failed.push(tile)
    else pending.push(tile)
  }

  // A ride inside a theme park is shown as part of the park, not on its own.
  // A suggested place hides only behind a suggested parent; a neighbouring
  // tile's place (used only for ranking) behind any parent read here.
  const suggestedIds = new Set<number>()
  const allIds = new Set<number>()
  for (const row of rows) {
    allIds.add(row.id)
    if (done.has(row.tile_key)) suggestedIds.add(row.id)
  }
  const pool = rows.filter(
    (row) =>
      row.parent_place_id == null ||
      !(done.has(row.tile_key) ? suggestedIds : allIds).has(
        row.parent_place_id,
      ),
  )
  const percentiles = localPercentile(pool, (row) => row.tile_key, {
    score: (row) => row.score,
    neighbours: tileNeighbourhood,
  })

  const places = pool
    .map((row, i) => toSuggestion(row, percentiles[i] ?? 0))
    .filter((place) => done.has(place.tile_key))
    .sort(
      (a, b) => b.percentile - a.percentile || b.score - a.score || a.id - b.id,
    )
  const scoring = [...done].filter((tile) => scoringTiles.has(tile))
  return { places, pending, failed, scoring }
}

function toSuggestion(row: PlaceRow, percentile: number): Suggestion {
  const tags = row.tags ?? {}
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    tile_key: row.tile_key,
    score: Number(row.score),
    percentile,
    image: placeImage(row),
    wikipedia_url: wikipediaUrl(tags.wikipedia, row.wikidata),
    osm_url: osmUrl(row),
    amenities: row.kind === 'campground' ? amenities(row.category, tags) : null,
  }
}

/** A Commons file name as it appears in a URL path. */
function commonsPath(file: string): string {
  return encodeURIComponent(file.replace(/^File:/i, '').replace(/ /g, '_'))
}

export function placeImage(row: PlaceRow): PlaceImage | null {
  if (!row.image_file?.trim()) return null
  const path = commonsPath(row.image_file.trim())
  return {
    thumbnail_url: `https://commons.wikimedia.org/wiki/Special:FilePath/${path}?width=${THUMBNAIL_WIDTH}`,
    page_url: `https://commons.wikimedia.org/wiki/File:${path}`,
    credit: row.image_credit,
    license: row.image_license,
  }
}

/**
 * The place's Wikipedia article: from OSM's wikipedia=<lang>:<title> tag, or
 * else the English article linked from its Wikidata item (Wikidata's
 * GoToLinkedPage redirects there, or to the item if there is none).
 */
export function wikipediaUrl(
  tag: string | undefined,
  wikidata: string | null,
): string | null {
  const match = /^([a-z][a-z-]{1,11}):(.+)$/.exec(tag?.trim() ?? '')
  if (match) {
    const title = encodeURIComponent(match[2].trim().replace(/ /g, '_'))
    return `https://${match[1]}.wikipedia.org/wiki/${title.replace(/%2F/g, '/')}`
  }
  if (wikidata && /^Q\d+$/.test(wikidata)) {
    return `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${wikidata}`
  }
  return null
}

export function osmUrl(row: Pick<PlaceRow, 'source' | 'source_id'>) {
  if (row.source !== 'osm') return null
  if (!/^(node|way|relation)\/\d+$/.test(row.source_id)) return null
  return `https://www.openstreetmap.org/${row.source_id}`
}

/** An OSM yes/no-style tag: null if unset; false for no; true otherwise. */
function yesNo(value: string | undefined): boolean | null {
  const v = value?.trim().toLowerCase()
  if (!v) return null
  return !['no', 'none', 'false', '0'].includes(v)
}

export function amenities(
  category: string,
  tags: Readonly<Record<string, string | undefined>>,
): CampgroundAmenities {
  const capacity = Number(tags.capacity)
  const website = tags.website ?? tags['contact:website']
  return {
    tents: yesNo(tags.tents),
    rvs:
      yesNo(tags.caravans) ??
      yesNo(tags.motorhome) ??
      (category === 'tourism=caravan_site' ? true : null),
    hookups: yesNo(tags.power_supply),
    showers: yesNo(tags.shower),
    toilets: yesNo(tags.toilets),
    drinking_water: yesNo(tags.drinking_water),
    fee: yesNo(tags.fee),
    reservation: tags.reservation?.trim() || null,
    capacity: Number.isInteger(capacity) && capacity > 0 ? capacity : null,
    website: website && /^https?:\/\//i.test(website) ? website : null,
  }
}
