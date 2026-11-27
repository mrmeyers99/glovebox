// Client side of the `suggestions` Edge Function (requirements §9,
// Discovery): asking for the ranked places in a set of map tiles, reading the
// response, and choosing which places to draw at the current zoom. The
// function answers only from our own cache; tiles it hasn't filled yet come
// back as `pending` and are asked for again later.

import { formatMiles } from './format'
import { supabase } from './supabase'

export type SuggestionKind = 'attraction' | 'campground'

export interface SuggestionImage {
  thumbnail_url: string
  /** The file's Commons page, where its author and licence are given in full. */
  page_url: string
  credit: string | null
  license: string | null
}

export interface Suggestion {
  id: number
  name: string
  kind: SuggestionKind
  /** The OSM tag that made it a candidate, e.g. 'tourism=museum'. */
  category: string
  lat: number
  lng: number
  tile_key: string
  score: number
  /** Rank in its area, from 0 (the lowest) to 1 (the best around here). */
  percentile: number
  image: SuggestionImage | null
  wikipedia_url: string | null
  osm_url: string | null
}

export interface SuggestionsResult {
  /** Places in the tiles that are filled, best first. */
  places: Suggestion[]
  /** Tiles not filled yet: ask again later. */
  pending: string[]
  /** Tiles the fill worker couldn't fetch (it retries them itself). */
  failed: string[]
}

/** The function accepts at most this many tiles per request. */
export const MAX_TILES_PER_REQUEST = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const optionalString = (value: unknown) =>
  typeof value === 'string' && value !== '' ? value : null

function parseImage(value: unknown): SuggestionImage | null {
  if (!isRecord(value)) return null
  const thumbnail = optionalString(value.thumbnail_url)
  const page = optionalString(value.page_url)
  if (!thumbnail || !page) return null
  return {
    thumbnail_url: thumbnail,
    page_url: page,
    credit: optionalString(value.credit),
    license: optionalString(value.license),
  }
}

/** One place from the response, or null if it isn't usable. */
export function parseSuggestion(value: unknown): Suggestion | null {
  if (!isRecord(value)) return null
  const { id, name, kind, category, lat, lng, tile_key: tileKey } = value
  if (typeof id !== 'number' || typeof name !== 'string' || name === '')
    return null
  if (kind !== 'attraction' && kind !== 'campground') return null
  if (typeof category !== 'string' || typeof tileKey !== 'string') return null
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null
  const score = Number(value.score)
  const percentile = Number(value.percentile)
  return {
    id,
    name,
    kind,
    category,
    lat,
    lng,
    tile_key: tileKey,
    score: Number.isFinite(score) ? score : 0,
    percentile: Number.isFinite(percentile)
      ? Math.min(1, Math.max(0, percentile))
      : 0,
    image: parseImage(value.image),
    wikipedia_url: optionalString(value.wikipedia_url),
    osm_url: optionalString(value.osm_url),
  }
}

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

/** The function's response body as a SuggestionsResult. Throws if it isn't one. */
export function parseSuggestionsResponse(body: unknown): SuggestionsResult {
  if (!isRecord(body) || !Array.isArray(body.places)) {
    throw new Error('Unexpected suggestions response')
  }
  return {
    places: body.places
      .map(parseSuggestion)
      .filter((place): place is Suggestion => place !== null),
    pending: stringList(body.pending),
    failed: stringList(body.failed),
  }
}

/**
 * Ranked places in `tiles`, in as many requests as the function's tile limit
 * needs. Throws if any request fails.
 */
export async function fetchSuggestions(
  tiles: readonly string[],
  kind: SuggestionKind = 'attraction',
): Promise<SuggestionsResult> {
  const batches: string[][] = []
  for (let i = 0; i < tiles.length; i += MAX_TILES_PER_REQUEST) {
    batches.push(tiles.slice(i, i + MAX_TILES_PER_REQUEST))
  }
  const results = await Promise.all(
    batches.map(async (batch) => {
      const { data, error } = await supabase.functions.invoke('suggestions', {
        body: { tiles: batch, kind },
      })
      if (error) throw error
      return parseSuggestionsResponse(data)
    }),
  )
  return {
    places: results.flatMap((r) => r.places).sort(bestFirst),
    pending: results.flatMap((r) => r.pending),
    failed: results.flatMap((r) => r.failed),
  }
}

/** Best first: by percentile, then score, then id (as the function sorts). */
export function bestFirst(a: Suggestion, b: Suggestion) {
  return b.percentile - a.percentile || b.score - a.score || a.id - b.id
}

/** [[west, south], [east, north]] in degrees. */
export type Bounds = [[number, number], [number, number]]

/** At most this many suggestion markers are drawn at once. */
export const MAX_VISIBLE = 200

/**
 * How many places per tile to draw at a zoom level: zoomed out, only the best
 * of each area, so a long route isn't buried in markers.
 */
export function perTileLimit(zoom: number): number {
  if (zoom < 7) return 1
  if (zoom < 8) return 2
  if (zoom < 9) return 3
  if (zoom < 10) return 6
  return Infinity
}

function inBounds(
  { lat, lng }: Suggestion,
  [[west, south], [east, north]]: Bounds,
) {
  if (lat < south || lat > north) return false
  // A view across the antimeridian has west > east.
  return west <= east ? lng >= west && lng <= east : lng >= west || lng <= east
}

/**
 * The places to draw: those in view (all of them when bounds is null), at
 * most perTileLimit(zoom) per tile and MAX_VISIBLE in all, best first.
 * `places` must already be best first.
 */
export function visibleSuggestions(
  places: readonly Suggestion[],
  zoom: number,
  bounds: Bounds | null,
): Suggestion[] {
  const limit = perTileLimit(zoom)
  const perTile = new Map<string, number>()
  const visible: Suggestion[] = []
  for (const place of places) {
    if (visible.length >= MAX_VISIBLE) break
    if (bounds && !inBounds(place, bounds)) continue
    const count = perTile.get(place.tile_key) ?? 0
    if (count >= limit) continue
    perTile.set(place.tile_key, count + 1)
    visible.push(place)
  }
  return visible
}

/** Marker size by local percentile, so the best stop in each area stands out. */
export function markerTier(percentile: number): 'top' | 'good' | 'other' {
  if (percentile >= 0.9) return 'top'
  if (percentile >= 0.6) return 'good'
  return 'other'
}

interface CategoryInfo {
  label: string
  icon: string
}

// Keyed by the OSM value, after the '='. Icons are emoji so they need no
// assets and read on any map colour.
const CATEGORIES: Record<string, CategoryInfo> = {
  attraction: { label: 'Attraction', icon: '⭐' },
  museum: { label: 'Museum', icon: '🏛️' },
  gallery: { label: 'Gallery', icon: '🖼️' },
  viewpoint: { label: 'Viewpoint', icon: '🔭' },
  zoo: { label: 'Zoo', icon: '🦁' },
  aquarium: { label: 'Aquarium', icon: '🐠' },
  theme_park: { label: 'Theme park', icon: '🎢' },
  artwork: { label: 'Statue', icon: '🗿' },
  memorial: { label: 'Memorial', icon: '🗿' },
  monument: { label: 'Monument', icon: '🗽' },
  castle: { label: 'Castle', icon: '🏰' },
  fort: { label: 'Fort', icon: '🏯' },
  manor: { label: 'Historic house', icon: '🏡' },
  building: { label: 'Historic building', icon: '🏛️' },
  house: { label: 'Historic house', icon: '🏡' },
  farm: { label: 'Historic farm', icon: '🌾' },
  ruins: { label: 'Ruins', icon: '🏚️' },
  archaeological_site: { label: 'Archaeological site', icon: '🏺' },
  battlefield: { label: 'Battlefield', icon: '⚔️' },
  ship: { label: 'Historic ship', icon: '⚓' },
  aircraft: { label: 'Historic aircraft', icon: '✈️' },
  locomotive: { label: 'Historic locomotive', icon: '🚂' },
  mine: { label: 'Historic mine', icon: '⛏️' },
  mill: { label: 'Mill', icon: '🌾' },
  windmill: { label: 'Windmill', icon: '🌾' },
  bridge: { label: 'Historic bridge', icon: '🌉' },
  waterfall: { label: 'Waterfall', icon: '💧' },
  peak: { label: 'Peak', icon: '⛰️' },
  cave_entrance: { label: 'Cave', icon: '🦇' },
  national_park: { label: 'National park', icon: '🏞️' },
  protected_area: { label: 'Protected area', icon: '🏞️' },
  nature_reserve: { label: 'Nature reserve', icon: '🌲' },
  park: { label: 'Park', icon: '🌳' },
  camp_site: { label: 'Campground', icon: '⛺' },
  caravan_site: { label: 'RV park', icon: '🚐' },
}

const OTHER: CategoryInfo = { label: 'Point of interest', icon: '📍' }

/** A label and icon for a category such as 'tourism=museum'. */
export function categoryInfo(category: string): CategoryInfo {
  const value = category.slice(category.indexOf('=') + 1)
  return Object.hasOwn(CATEGORIES, value) ? CATEGORIES[value] : OTHER
}

const KM_PER_MILE = 1.609344

/** E.g. "12 mi from the route", or "On the route" when under a mile. */
export function routeDistanceLabel(km: number) {
  if (!Number.isFinite(km)) return null
  const miles = km / KM_PER_MILE
  return miles < 1 ? 'On the route' : `${formatMiles(miles)} from the route`
}
