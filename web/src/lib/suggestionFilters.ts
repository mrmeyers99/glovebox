// Filters for the map's suggested places (issue #66): which kinds of place to
// show, how far from the route, and whether only the best of each area.
// Filtering happens over the places already fetched, so changing a filter
// never asks the server for anything. Each user's choice is remembered on
// this device.

import type { Suggestion } from './suggestions'

export const CATEGORY_GROUPS = [
  { id: 'museums', label: 'Museums' },
  { id: 'nature', label: 'Parks & nature' },
  { id: 'roadside', label: 'Statues & roadside' },
  { id: 'historic', label: 'Historic' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'viewpoints', label: 'Viewpoints' },
] as const

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number]['id']

// By the OSM tag that made a place a candidate (see the places module's
// classifyCandidate). Anything not listed, such as a category added later,
// counts as roadside: the catch-all for odd things worth a stop.
const GROUP_BY_CATEGORY: Record<string, CategoryGroup> = {
  'tourism=museum': 'museums',
  'tourism=gallery': 'museums',
  'boundary=national_park': 'nature',
  'boundary=protected_area': 'nature',
  'leisure=park': 'nature',
  'leisure=nature_reserve': 'nature',
  'natural=waterfall': 'nature',
  'natural=peak': 'nature',
  'natural=cave_entrance': 'nature',
  'tourism=attraction': 'roadside',
  'tourism=artwork': 'roadside',
  'historic=memorial': 'roadside',
  'man_made=windmill': 'roadside',
  'tourism=zoo': 'entertainment',
  'tourism=aquarium': 'entertainment',
  'tourism=theme_park': 'entertainment',
  'tourism=viewpoint': 'viewpoints',
}

/** The filter group of a category such as 'tourism=museum'. */
export function categoryGroup(category: string): CategoryGroup {
  if (Object.hasOwn(GROUP_BY_CATEGORY, category)) {
    return GROUP_BY_CATEGORY[category]
  }
  return category.startsWith('historic=') ? 'historic' : 'roadside'
}

/**
 * Maximum distance from the route, in km (a stand-in for detour time, which
 * would need a routing call per place). null: any distance.
 */
export const DISTANCE_OPTIONS = [
  { km: null, label: 'Any distance' },
  { km: 5, label: 'Within 3 mi' },
  { km: 15, label: 'Within 9 mi' },
  { km: 25, label: 'Within 15 mi' },
  { km: 40, label: 'Within 25 mi' },
] as const

export type MaxDistance = (typeof DISTANCE_OPTIONS)[number]['km']

/** "Top picks only" keeps places at or above this local percentile. */
export const TOP_PICK_PERCENTILE = 0.8

export interface SuggestionFilter {
  /** The groups to show. */
  categories: CategoryGroup[]
  maxDistanceKm: MaxDistance
  topPicksOnly: boolean
}

export const DEFAULT_FILTER: SuggestionFilter = {
  categories: CATEGORY_GROUPS.map((group) => group.id),
  maxDistanceKm: null,
  topPicksOnly: false,
}

/** Whether `filter` hides anything that the default shows. */
export function isFiltering(filter: SuggestionFilter) {
  return (
    filter.categories.length < CATEGORY_GROUPS.length ||
    filter.maxDistanceKm !== null ||
    filter.topPicksOnly
  )
}

/**
 * The places that pass `filter`, in their original order. `distances` maps
 * a place's id to its distance from the route in km; a place without one
 * counts as on the route.
 */
export function filterSuggestions(
  places: readonly Suggestion[],
  distances: ReadonlyMap<number, number>,
  filter: SuggestionFilter,
): Suggestion[] {
  const groups = new Set(filter.categories)
  const max = filter.maxDistanceKm
  return places.filter(
    (place) =>
      groups.has(categoryGroup(place.category)) &&
      (!filter.topPicksOnly || place.percentile >= TOP_PICK_PERCENTILE) &&
      (max === null || (distances.get(place.id) ?? 0) <= max),
  )
}

const STORAGE_PREFIX = 'glovebox.suggestionFilter'

/** The localStorage key for a user's filter (or a signed-out visitor's). */
export function filterStorageKey(userId: string | undefined) {
  return userId ? `${STORAGE_PREFIX}.${userId}` : STORAGE_PREFIX
}

const isDistance = (value: unknown): value is MaxDistance =>
  DISTANCE_OPTIONS.some((option) => option.km === value)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A saved filter read back; anything unusable falls back to the default. */
export function parseFilter(value: unknown): SuggestionFilter {
  if (!isRecord(value)) return DEFAULT_FILTER
  const { categories, maxDistanceKm, topPicksOnly } = value
  return {
    categories: Array.isArray(categories)
      ? CATEGORY_GROUPS.map((group) => group.id).filter((id) =>
          categories.includes(id),
        )
      : DEFAULT_FILTER.categories,
    maxDistanceKm: isDistance(maxDistanceKm)
      ? maxDistanceKm
      : DEFAULT_FILTER.maxDistanceKm,
    topPicksOnly:
      typeof topPicksOnly === 'boolean'
        ? topPicksOnly
        : DEFAULT_FILTER.topPicksOnly,
  }
}

/** The user's saved filter, or the default if none is saved or storage is unavailable. */
export function loadFilter(userId: string | undefined): SuggestionFilter {
  try {
    const saved = localStorage.getItem(filterStorageKey(userId))
    return saved === null ? DEFAULT_FILTER : parseFilter(JSON.parse(saved))
  } catch {
    return DEFAULT_FILTER
  }
}

/** Remember the user's filter on this device. */
export function saveFilter(
  userId: string | undefined,
  filter: SuggestionFilter,
) {
  try {
    localStorage.setItem(filterStorageKey(userId), JSON.stringify(filter))
  } catch {
    // Private mode or storage blocked: the filter still applies until reload.
  }
}
