import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { legLines } from '../lib/corridor'
import type { Day, Stop } from '../lib/database.types'
import type { LatLng } from '../lib/geocode'
import type { TripSummary } from '../lib/tripMath'
import type { StopSelection } from './mapView'
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
}: {
  days: readonly Day[]
  stops: readonly Stop[]
  /** Legs with their routes, from useTripSummary. */
  summary: TripSummary
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  /** Owners and editors: add a stop where the map is right-clicked / long-pressed. */
  onAddStopAt?: (point: LatLng) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const hasSize = useHasSize(ref)
  // Skipped stops are off the map unless asked for (as faded markers).
  const [showSkipped, setShowSkipped] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const lines = useMemo(() => legLines(summary.legs), [summary])
  const suggestions = useSuggestions(lines, showSuggestions)

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
            suggestions={suggestions.places}
            corridor={lines}
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
            <SuggestionsNote state={suggestions} />
          </div>
        </Suspense>
      )}
    </div>
  )
}

/** What's happening with suggestions, when there's something to say. */
export function SuggestionsNote({ state }: { state: SuggestionsState }) {
  let text: string | null = null
  if (state.error) text = "Couldn't load suggestions. Try again later."
  else if (state.pending > 0) text = 'Finding places along your route…'
  else if (state.failed > 0 && state.places.length === 0)
    text = "Couldn't find places along your route yet."
  if (!text) return null
  return (
    <p className="map-note" role="status">
      {text}
    </p>
  )
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
