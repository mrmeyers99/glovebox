// Campgrounds near the end of a day (issue #65): where a day's driving ends,
// which campgrounds are near it, and filtering them by what they offer.
// Filters run over the campgrounds already fetched, so changing one never
// asks the server for anything. Most campgrounds tag few amenities, so a
// campground that doesn't say counts as a maybe, unless the user asks for
// confirmed amenities only. Pure, apart from remembering the filter.

import { haversineKm, type LatLng } from './corridor'
import { formatMiles } from './format'
import type { CampgroundAmenities, Suggestion } from './suggestions'
import type { DaySummary, StopInput } from './tripMath'

/** How far from a day's last stop to look, in km (about 25 miles). */
export const CAMPGROUND_RADIUS_KM = 40

/**
 * The stop where `day`'s driving ends: its last stop that isn't skipped.
 * Null for the trip's last day (the trip ends there) and days without any.
 */
export function overnightStop(
  days: readonly Pick<DaySummary, 'dayId' | 'stops'>[],
  dayId: string,
): StopInput | null {
  const index = days.findIndex((d) => d.dayId === dayId)
  if (index === -1 || index === days.length - 1) return null
  return days[index].stops.findLast((s) => !s.skipped) ?? null
}

/** The day whose overnight stop `stopId` is, if it is one. */
export function overnightDayOf(
  days: readonly Pick<DaySummary, 'dayId' | 'stops'>[],
  stopId: string,
): string | null {
  const day = days.find((d) => d.stops.some((s) => s.id === stopId))
  if (!day) return null
  return overnightStop(days, day.dayId)?.id === stopId ? day.dayId : null
}

export interface NearbyCampground {
  place: Suggestion
  /** Straight-line distance from the stop. */
  km: number
}

/**
 * Campgrounds within `radiusKm` of `point`, nearest first. The tiles near a
 * point reach further than the radius, so the rest are dropped.
 */
export function campgroundsNear(
  places: readonly Suggestion[],
  point: LatLng,
  radiusKm = CAMPGROUND_RADIUS_KM,
): NearbyCampground[] {
  return places
    .map((place) => ({ place, km: haversineKm(point, [place.lat, place.lng]) }))
    .filter(({ km }) => km <= radiusKm)
    .sort((a, b) => a.km - b.km || a.place.id - b.place.id)
}

export const AMENITY_FILTERS = [
  { id: 'tents', label: 'Tents' },
  { id: 'rvs', label: 'RVs' },
  { id: 'hookups', label: 'Hookups' },
  { id: 'showers', label: 'Showers' },
] as const

export type AmenityFilter = (typeof AMENITY_FILTERS)[number]['id']

export interface CampgroundFilter {
  /** Amenities a campground must have. */
  amenities: AmenityFilter[]
  /** No fee. */
  free: boolean
  ownership: 'any' | 'public' | 'private'
  /** Hide campgrounds that don't say, rather than count them as a maybe. */
  confirmedOnly: boolean
}

export const DEFAULT_CAMPGROUND_FILTER: CampgroundFilter = {
  amenities: [],
  free: false,
  ownership: 'any',
  confirmedOnly: false,
}

/**
 * Whether a campground passes on one requirement: `value` is what it says
 * (null: it doesn't), `wanted` what passes.
 */
function passes<T>(value: T | null, wanted: T, confirmedOnly: boolean) {
  return value === null ? !confirmedOnly : value === wanted
}

/** Whether `amenities` pass `filter`. A place without any is all unknowns. */
export function matchesCampgroundFilter(
  amenities: CampgroundAmenities | null | undefined,
  filter: CampgroundFilter,
): boolean {
  const { confirmedOnly } = filter
  const has = (key: keyof CampgroundAmenities) => amenities?.[key] ?? null
  return (
    filter.amenities.every((key) => passes(has(key), true, confirmedOnly)) &&
    (!filter.free || passes(has('fee'), false, confirmedOnly)) &&
    (filter.ownership === 'any' ||
      passes(has('ownership'), filter.ownership, confirmedOnly))
  )
}

/** Whether `filter` hides anything that the default shows. */
export function isFilteringCampgrounds(filter: CampgroundFilter) {
  return (
    filter.amenities.length > 0 ||
    filter.free ||
    filter.ownership !== 'any' ||
    filter.confirmedOnly
  )
}

export interface AmenityBadge {
  key: string
  icon: string
  label: string
  /** The campground says it doesn't (shown struck through). */
  no?: boolean
}

const BADGES = [
  { key: 'tents', icon: '⛺', label: 'Tents' },
  { key: 'rvs', icon: '🚐', label: 'RVs' },
  { key: 'hookups', icon: '🔌', label: 'Hookups' },
  { key: 'showers', icon: '🚿', label: 'Showers' },
  { key: 'toilets', icon: '🚻', label: 'Toilets' },
  { key: 'drinking_water', icon: '🚰', label: 'Drinking water' },
  { key: 'dump_station', icon: '🚽', label: 'Dump station' },
] as const

/** Icons for what a campground says it has, or doesn't; unknowns are left out. */
export function amenityBadges(
  amenities: CampgroundAmenities | null | undefined,
): AmenityBadge[] {
  if (!amenities) return []
  return BADGES.flatMap(({ key, icon, label }) => {
    const value = amenities[key]
    if (value === null) return []
    return [value ? { key, icon, label } : { key, icon, label, no: true }]
  })
}

/** "Free", the price, "Fee", or null when not known. */
export function feeLabel(amenities: CampgroundAmenities | null | undefined) {
  if (!amenities || amenities.fee === null) return null
  if (!amenities.fee) return 'Free'
  return amenities.fee_amount ?? 'Fee'
}

/** "Reservations required" and the like, or null. */
export function reservationLabel(
  amenities: CampgroundAmenities | null | undefined,
) {
  switch (amenities?.reservation) {
    case 'required':
      return 'Reservations required'
    case 'recommended':
      return 'Reservations recommended'
    case 'yes':
      return 'Takes reservations'
    case 'no':
      return 'First come, first served'
    default:
      return null
  }
}

const KM_PER_MILE = 1.609344

const nearMiles = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
})

/** E.g. "4.2 mi away", "12 mi away", or "Here" under a tenth of a mile. */
export function campgroundDistanceLabel(km: number) {
  const miles = km / KM_PER_MILE
  if (miles < 0.1) return 'Here'
  return miles < 10
    ? `${nearMiles.format(miles)} mi away`
    : `${formatMiles(miles)} away`
}

const STORAGE_PREFIX = 'glovebox.campgroundFilter'

/** The localStorage key for a user's filter (or a signed-out visitor's). */
export function campgroundFilterKey(userId: string | undefined) {
  return userId ? `${STORAGE_PREFIX}.${userId}` : STORAGE_PREFIX
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A saved filter read back; anything unusable falls back to the default. */
export function parseCampgroundFilter(value: unknown): CampgroundFilter {
  if (!isRecord(value)) return DEFAULT_CAMPGROUND_FILTER
  const { amenities, free, ownership, confirmedOnly } = value
  return {
    amenities: Array.isArray(amenities)
      ? AMENITY_FILTERS.map((a) => a.id).filter((id) => amenities.includes(id))
      : [],
    free: free === true,
    ownership:
      ownership === 'public' || ownership === 'private' ? ownership : 'any',
    confirmedOnly: confirmedOnly === true,
  }
}

/** The user's saved filter, or the default. */
export function loadCampgroundFilter(
  userId: string | undefined,
): CampgroundFilter {
  try {
    const saved = localStorage.getItem(campgroundFilterKey(userId))
    return saved === null
      ? DEFAULT_CAMPGROUND_FILTER
      : parseCampgroundFilter(JSON.parse(saved))
  } catch {
    return DEFAULT_CAMPGROUND_FILTER
  }
}

/** Remember the user's filter on this device. */
export function saveCampgroundFilter(
  userId: string | undefined,
  filter: CampgroundFilter,
) {
  try {
    localStorage.setItem(campgroundFilterKey(userId), JSON.stringify(filter))
  } catch {
    // Private mode or storage blocked: the filter still applies until reload.
  }
}
