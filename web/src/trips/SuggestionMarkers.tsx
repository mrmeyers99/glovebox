// Suggested places on the trip map: a marker per place (an icon for its
// category, larger for the best in each area) and a card for the one
// clicked. Part of the lazily loaded map chunk.

import { memo, useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap } from 'react-map-gl/maplibre'
import type { LatLng } from '../lib/corridor'
import {
  categoryInfo,
  markerTier,
  visibleSuggestions,
  type Bounds,
  type Suggestion,
} from '../lib/suggestions'
import { SuggestionCard } from './SuggestionCard'

interface View {
  zoom: number
  bounds: Bounds | null
}

/** The map's zoom and bounds, updated when it stops moving. */
function useMapView(): View {
  const { current: map } = useMap()
  const [view, setView] = useState<View>({ zoom: 0, bounds: null })
  useEffect(() => {
    if (!map) return
    const read = () => {
      const b = map.getBounds()
      setView({
        zoom: map.getZoom(),
        bounds: [
          [b.getWest(), b.getSouth()],
          [b.getEast(), b.getNorth()],
        ],
      })
    }
    read()
    map.on('moveend', read)
    return () => {
      map.off('moveend', read)
    }
  }, [map])
  return view
}

export function SuggestionMarkers({
  places,
  lines,
}: {
  /** Best first, from useSuggestions. */
  places: readonly Suggestion[]
  lines: LatLng[][]
}) {
  const { zoom, bounds } = useMapView()
  const visible = useMemo(
    () => visibleSuggestions(places, zoom, bounds),
    [places, zoom, bounds],
  )
  const [openId, setOpenId] = useState<number | null>(null)
  // The open card stays even if its marker is thinned out by zooming.
  const open = places.find((place) => place.id === openId) ?? null

  return (
    <>
      {visible.map((place) => (
        <SuggestionPin
          key={place.id}
          place={place}
          selected={place.id === openId}
          onSelect={setOpenId}
        />
      ))}
      {open && (
        <Popup
          longitude={open.lng}
          latitude={open.lat}
          anchor="bottom"
          offset={18}
          maxWidth="18rem"
          className="suggestion-popup"
          onClose={() => setOpenId(null)}
        >
          <SuggestionCard place={open} lines={lines} />
        </Popup>
      )}
    </>
  )
}

const SuggestionPin = memo(function SuggestionPin({
  place,
  selected,
  onSelect,
}: {
  place: Suggestion
  selected: boolean
  onSelect: (id: number) => void
}) {
  const { label, icon } = categoryInfo(place.category)
  const tier = markerTier(place.percentile)
  return (
    <Marker
      longitude={place.lng}
      latitude={place.lat}
      // Below the trip's own stop markers (see .stop-marker-anchor).
      style={selected ? { zIndex: 1 } : undefined}
      onClick={(e) => {
        // Don't let the map's click close the card this opens.
        e.originalEvent.stopPropagation()
        onSelect(place.id)
      }}
    >
      {/* Mouse clicks and Enter/Space both reach the Marker's click handler. */}
      <button
        type="button"
        className="suggestion-marker"
        data-tier={tier}
        aria-pressed={selected}
        aria-label={`${place.name} (${label})`}
        title={place.name}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
    </Marker>
  )
})
