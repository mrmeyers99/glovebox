// The campgrounds near a day's last stop (issue #65), nearest first, while a
// search is open. Fetching and asking again for tiles still being filled
// work as for the map's suggestions (useTileSuggestions).

import { useMemo } from 'react'
import {
  CAMPGROUND_RADIUS_KM,
  campgroundsNear,
  type NearbyCampground,
} from '../lib/campgrounds'
import { tilesNear, type LatLng } from '../lib/corridor'
import {
  tilesKeyOf,
  useTileSuggestions,
  type SuggestionsState,
} from './useSuggestions'

export interface CampgroundsState extends SuggestionsState {
  /** Within CAMPGROUND_RADIUS_KM of the stop, nearest first. */
  nearby: NearbyCampground[]
}

/** Campgrounds around `point`; nothing while it's null. */
export function useCampgrounds(point: LatLng | null): CampgroundsState {
  const [lat, lng] = point ?? [NaN, NaN]
  const valid = Number.isFinite(lat) && Number.isFinite(lng)
  const tilesKey = useMemo(
    () =>
      valid ? tilesKeyOf(tilesNear([lat, lng], CAMPGROUND_RADIUS_KM)) : '',
    [valid, lat, lng],
  )
  const state = useTileSuggestions(tilesKey, 'campground', valid)
  const nearby = useMemo(
    () => (valid ? campgroundsNear(state.places, [lat, lng]) : []),
    [state.places, valid, lat, lng],
  )
  return { ...state, nearby }
}
