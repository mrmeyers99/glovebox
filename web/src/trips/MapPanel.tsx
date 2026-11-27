import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  distanceFromRoute,
  legLines,
  type LatLng as Point,
} from '../lib/corridor'
import type { Day, Stop } from '../lib/database.types'
import type { LatLng } from '../lib/geocode'
import {
  filterSuggestions,
  isFiltering,
  loadFilter,
  saveFilter,
  type SuggestionFilter,
} from '../lib/suggestionFilters'
import type { Suggestion } from '../lib/suggestions'
import type { TripSummary } from '../lib/tripMath'
import type { CampgroundLayer } from './CampgroundMarkers'
import type { StopSelection } from './mapView'
import { SuggestionFilters } from './SuggestionFilters'
import { useSuggestions, type SuggestionsState } from './useSuggestions'

// Code-split: the map library is only downloaded on the trip page.
const TripMap = lazy(() => import('./TripMap'))

export function MapPanel({
  days,
  stops,
  summary,
  selection,
  onSelectStop,
  onAddStopAt,
  onAddSuggestion,
  campgrounds,
  findCampgrounds,
}: {
  days: readonly Day[]
  stops: readonly Stop[]
  /** Legs with their routes, from useTripSummary. */
  summary: TripSummary
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  /** Owners and editors: add a stop where the map is right-clicked / long-pressed. */
  onAddStopAt?: (point: LatLng) => void
  /** Owners and editors: add a suggested place as a stop. */
  onAddSuggestion?: (place: Suggestion) => void
  /** An open campground search, highlighted on the map. */
  campgrounds?: CampgroundLayer | null
  /** Offered while a day's last stop is selected. */
  findCampgrounds?: { stopName: string; onFind: () => void } | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const hasSize = useHasSize(ref)
  // Skipped stops are off the map unless asked for (as faded markers).
  const [showSkipped, setShowSkipped] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const lines = useMemo(() => legLines(summary.legs), [summary])
  const suggestions = useSuggestions(lines, showSuggestions)
  const { filter, setFilter, shown } = useSuggestionFilter(
    suggestions.places,
    lines,
  )

  return (
    <div ref={ref} className="map-panel">
      {/* At phone width the panel is hidden until the Map tab is picked.
          Wait until it has a size so the initial fit uses real dimensions. */}
      {hasSize && (
        <Suspense fallback={<p className="map-loading">Loading map…</p>}>
          <TripMap
            days={days}
            stops={stops}
            summary={summary}
            showSkipped={showSkipped}
            selection={selection}
            onSelectStop={onSelectStop}
            onAddStopAt={onAddStopAt}
            onAddSuggestion={onAddSuggestion}
            suggestions={shown}
            corridor={lines}
            campgrounds={campgrounds}
          />
          <div className="map-toggles">
            <label className="map-toggle">
              <input
                type="checkbox"
                checked={showSkipped}
                onChange={(e) => setShowSkipped(e.target.checked)}
              />
              Show skipped
            </label>
            <label className="map-toggle">
              <input
                type="checkbox"
                checked={showSuggestions}
                onChange={(e) => setShowSuggestions(e.target.checked)}
              />
              Suggestions
            </label>
            {showSuggestions && (
              <SuggestionFilters
                filter={filter}
                onChange={setFilter}
                shown={shown.length}
                total={suggestions.places.length}
              />
            )}
            <SuggestionsNote state={suggestions} shown={shown.length} />
            {findCampgrounds && (
              <button
                type="button"
                className="map-find-campgrounds"
                onClick={findCampgrounds.onFind}
              >
                <span aria-hidden="true">⛺</span> Campgrounds near{' '}
                {findCampgrounds.stopName}
              </button>
            )}
          </div>
        </Suspense>
      )}
    </div>
  )
}

/** What's happening with suggestions, when there's something to say. */
export function SuggestionsNote({
  state,
  shown = state.places.length,
}: {
  state: SuggestionsState
  /** How many places pass the filter. */
  shown?: number
}) {
  let text: string | null = null
  if (state.error) text = "Couldn't load suggestions. Try again later."
  else if (state.pending > 0) text = 'Finding places along your route…'
  else if (state.failed > 0 && state.places.length === 0)
    text = "Couldn't find places along your route yet."
  else if (state.places.length > 0 && shown === 0)
    text = 'No places match your filters.'
  if (!text) return null
  return (
    <p className="map-note" role="status">
      {text}
    </p>
  )
}

/**
 * The signed-in user's suggestion filter (remembered on this device) and the
 * places that pass it. Filtering is over the places already fetched, so
 * changing it makes no requests.
 */
function useSuggestionFilter(places: readonly Suggestion[], lines: Point[][]) {
  const userId = useAuth().session?.user.id
  const [saved, setSaved] = useState(() => ({
    userId,
    filter: loadFilter(userId),
  }))
  // Another user signed in on this device: show their filter.
  const filter = saved.userId === userId ? saved.filter : loadFilter(userId)
  const setFilter = (next: SuggestionFilter) => {
    setSaved({ userId, filter: next })
    saveFilter(userId, next)
  }
  // Distances are only worked out while a distance limit is set.
  const byDistance = filter.maxDistanceKm !== null
  const distances = useMemo(
    () =>
      new Map(
        byDistance
          ? places.map((p) => [p.id, distanceFromRoute([p.lat, p.lng], lines)])
          : [],
      ),
    [places, lines, byDistance],
  )
  const shown = useMemo(
    () =>
      isFiltering(filter)
        ? filterSuggestions(places, distances, filter)
        : places,
    [places, distances, filter],
  )
  return { filter, setFilter, shown }
}

/** Becomes true (and stays true) once the element has a non-zero size. */
function useHasSize(ref: RefObject<HTMLElement | null>) {
  const [hasSize, setHasSize] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || hasSize) return
    const check = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) setHasSize(true)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, hasSize])
  return hasSize
}
