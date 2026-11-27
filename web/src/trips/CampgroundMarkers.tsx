// The campgrounds of an open campground search (issue #65), highlighted on
// the map. The map flies to the day's last stop when a search opens. Part of
// the lazily loaded map chunk.

import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import type { LatLng } from '../lib/corridor'
import type { Suggestion } from '../lib/suggestions'
import { SuggestionMarkers } from './SuggestionMarkers'

/** Close enough to tell the campgrounds around a stop apart. */
export const CAMPGROUND_ZOOM = 10

export interface CampgroundLayer {
  /** The day's last stop. */
  center: LatLng
  dayNumber: number
  /** Nearest first. */
  places: readonly Suggestion[]
  /** Owners and editors: add one as the day's last stop. */
  onAdd?: (place: Suggestion) => void
}

export function CampgroundMarkers({
  layer,
  inTrip,
}: {
  layer: CampgroundLayer
  inTrip: ReadonlySet<number>
}) {
  const { current: map } = useMap()
  const [lat, lng] = layer.center
  useEffect(() => {
    if (!map) return
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), CAMPGROUND_ZOOM),
    })
  }, [map, lat, lng])
  return (
    <SuggestionMarkers
      places={layer.places}
      lines={[]}
      inTrip={inTrip}
      onAdd={layer.onAdd}
      highlight
      from={layer.center}
      addLabel={`Add as Day ${layer.dayNumber}'s overnight stop`}
    />
  )
}
