// Suggested places on the trip map: a marker per place (its photo, or an icon
// for its category, larger for the best in each area) and a card for the one
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
  inTrip,
  onAdd,
  highlight = false,
  from,
  addLabel,
}: {
  /** Best first, from useSuggestions. */
  places: readonly Suggestion[]
  lines: LatLng[][]
  /** Ids of the places the trip's stops were added from. */
  inTrip: ReadonlySet<number>
  /** Owners and editors: add a place to the trip as a stop. */
  onAdd?: (place: Suggestion) => void
  /**
   * Results of a search, such as campgrounds near a stop: all drawn (not
   * thinned out by zoom), and highlighted.
   */
  highlight?: boolean
  /** Cards give the distance from this point instead of from the route. */
  from?: LatLng
  /** The card's add button. */
  addLabel?: string
}) {
  const { zoom, bounds } = useMapView()
  const visible = useMemo(
    () => (highlight ? places : visibleSuggestions(places, zoom, bounds)),
    [places, zoom, bounds, highlight],
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
          inTrip={inTrip.has(place.id)}
          highlight={highlight}
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
          <SuggestionCard
            place={open}
            lines={lines}
            from={from}
            addLabel={addLabel}
            inTrip={inTrip.has(open.id)}
            onAdd={
              onAdd &&
              ((place) => {
                setOpenId(null)
                onAdd(place)
              })
            }
          />
        </Popup>
      )}
    </>
  )
}

const SuggestionPin = memo(function SuggestionPin({
  place,
  selected,
  inTrip,
  highlight,
  onSelect,
}: {
  place: Suggestion
  selected: boolean
  inTrip: boolean
  highlight: boolean
  onSelect: (id: number) => void
}) {
  const { label, icon } = categoryInfo(place.category)
  const tier = markerTier(place.percentile)
  const photo = place.image?.marker_url ?? null
  // The photo that didn't load, so a new one for the place is tried again.
  const [failed, setFailed] = useState<string | null>(null)
  const showPhoto = photo !== null && photo !== failed
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
        data-in-trip={inTrip || undefined}
        data-highlight={highlight || undefined}
        data-photo={showPhoto || undefined}
        aria-pressed={selected}
        aria-label={`${place.name} (${inTrip ? `${label}, in your trip` : label})`}
        title={place.name}
      >
        {showPhoto ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(photo)}
          />
        ) : (
          <span aria-hidden="true">{icon}</span>
        )}
      </button>
    </Marker>
  )
})
