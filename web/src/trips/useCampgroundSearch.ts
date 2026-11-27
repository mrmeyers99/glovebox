// The trip page's campground search (issue #65): which day it is open for,
// that day's last stop, the campgrounds near it and the user's filter. Also
// which of the trip's stops were added from a campground, so the day list
// can show a day's overnight campground.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  isFilteringCampgrounds,
  loadCampgroundFilter,
  matchesCampgroundFilter,
  overnightStop,
  saveCampgroundFilter,
  type CampgroundFilter,
} from '../lib/campgrounds'
import type { Stop } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import type { DaySummary } from '../lib/tripMath'
import { useCampgrounds } from './useCampgrounds'

export function useCampgroundSearch(
  days: readonly DaySummary[],
  stops: readonly Stop[],
) {
  const [dayId, setDayId] = useState<string | null>(null)
  // Null once the day is gone or no longer has a last stop (the search closes).
  const stopInput = dayId ? overnightStop(days, dayId) : null
  const stop = stopInput ? stops.find((s) => s.id === stopInput.id) : undefined
  const day = stop ? days.find((d) => d.dayId === dayId) : undefined
  const state = useCampgrounds(
    stop ? [Number(stop.lat), Number(stop.lng)] : null,
  )

  const { filter, setFilter } = useCampgroundFilter()
  const shown = useMemo(
    () =>
      isFilteringCampgrounds(filter)
        ? state.nearby.filter(({ place }) =>
            matchesCampgroundFilter(place.amenities, filter),
          )
        : state.nearby,
    [state.nearby, filter],
  )

  const known = useCampgroundPlaces(stops)
  // Campgrounds just fetched count too, so one added from the list shows
  // straight away.
  const campgroundPlaceIds = useMemo(() => {
    const ids = new Set(known)
    for (const { place } of state.nearby) ids.add(place.id)
    return ids
  }, [known, state.nearby])

  const open = useCallback((id: string) => setDayId(id), [])
  const close = useCallback(() => setDayId(null), [])

  return {
    /** Set while open. */
    search:
      stop && day
        ? {
            dayId: day.dayId,
            dayNumber: day.dayNumber,
            stop,
            /** The stop's place, when it was added from a campground. */
            currentPlaceId:
              stop.place_id !== null && campgroundPlaceIds.has(stop.place_id)
                ? stop.place_id
                : null,
          }
        : null,
    state,
    shown,
    filter,
    setFilter,
    campgroundPlaceIds,
    open,
    close,
  }
}

/** The signed-in user's campground filter, remembered on this device. */
function useCampgroundFilter() {
  const userId = useAuth().session?.user.id
  const [saved, setSaved] = useState(() => ({
    userId,
    filter: loadCampgroundFilter(userId),
  }))
  const filter =
    saved.userId === userId ? saved.filter : loadCampgroundFilter(userId)
  const setFilter = (next: CampgroundFilter) => {
    setSaved({ userId, filter: next })
    saveCampgroundFilter(userId, next)
  }
  return { filter, setFilter }
}

/**
 * Ids of the places the trip's stops were added from that are campgrounds,
 * read from the places cache (any signed-in user can read it).
 */
export function useCampgroundPlaces(
  stops: readonly Pick<Stop, 'place_id'>[],
): ReadonlySet<number> {
  const key = [
    ...new Set(stops.flatMap((s) => (s.place_id === null ? [] : [s.place_id]))),
  ]
    .sort((a, b) => a - b)
    .join(',')
  const [found, setFound] = useState<{ key: string; ids: Set<number> }>({
    key: '',
    ids: new Set(),
  })
  useEffect(() => {
    if (key === '') return
    let cancelled = false
    supabase
      .from('places')
      .select('id')
      .in('id', key.split(',').map(Number))
      .eq('kind', 'campground')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Could not look up campgrounds', error)
          return
        }
        setFound({ key, ids: new Set(data.map((row) => Number(row.id))) })
      })
    return () => {
      cancelled = true
    }
  }, [key])
  return key === '' ? NONE : found.ids
}

const NONE: ReadonlySet<number> = new Set()
