// The MapLibre map. Imported lazily by MapPanel so maplibre-gl lands in its
// own chunk and stays off the trip list page.

import 'maplibre-gl/dist/maplibre-gl.css'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { memo, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import {
  AttributionControl,
  Map,
  Marker,
  NavigationControl,
  type MapRef,
} from 'react-map-gl/maplibre'
import type { Day, Stop } from '../lib/database.types'
import { toDayInput, toStopInput } from '../lib/tripRows'
import {
  FIT_MAX_ZOOM,
  FIT_PADDING,
  MAP_STYLE_URL,
  OSM_ATTRIBUTION,
  dayColor,
  initialBounds,
  markerLabel,
  stopMarkers,
  type StopMarker,
  type StopSelection,
} from './mapView'

// MapLibre finds its worker next to its own module file. Vite moves that
// module (pre-bundling in dev, chunking in builds) and doesn't copy the worker,
// so point MapLibre at a URL that Vite serves and emits.
maplibregl.setWorkerUrl(workerUrl)

export default function TripMap({
  days,
  stops,
  showSkipped,
  selection,
  onSelectStop,
}: {
  days: readonly Day[]
  stops: readonly Stop[]
  showSkipped: boolean
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
}) {
  const mapRef = useRef<MapRef>(null)
  const markers = useMemo(
    () =>
      stopMarkers(days.map(toDayInput), stops.map(toStopInput), {
        showSkipped,
      }),
    [days, stops, showSkipped],
  )
  const names = useMemo(
    () => new globalThis.Map(stops.map((s) => [s.id, s.name])),
    [stops],
  )
  const selectedId = selection?.stopId ?? null

  // Latest stops, read when a selection arrives: only a new selection pans,
  // later edits to the selected stop don't move the map.
  const stopsRef = useRef(stops)
  useEffect(() => {
    stopsRef.current = stops
  }, [stops])

  // Pan to a stop picked in the day list. Each pick is a new selection
  // object, so picking the same stop again pans back to it.
  useEffect(() => {
    if (selection?.source !== 'list') return
    const stop = stopsRef.current.find((s) => s.id === selection.stopId)
    const map = mapRef.current
    if (!stop || !map) return
    const lat = Number(stop.lat)
    const lng = Number(stop.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    map.easeTo({ center: [lng, lat] })
  }, [selection])

  return (
    <Map
      ref={mapRef}
      // Fit once on load; later stop edits don't move the map under the user.
      initialViewState={{
        bounds: initialBounds(stops),
        fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
      }}
      // The same instance we set the worker URL on, not react-map-gl's own import.
      mapLib={maplibregl}
      mapStyle={MAP_STYLE_URL}
      attributionControl={false}
      style={{ width: '100%', height: '100%' }}
    >
      <NavigationControl position="top-right" />
      <AttributionControl
        position="bottom-right"
        compact={false}
        customAttribution={OSM_ATTRIBUTION}
      />
      {markers.map((marker) => (
        <StopMarkerPin
          key={marker.stopId}
          marker={marker}
          name={names.get(marker.stopId) ?? ''}
          selected={marker.stopId === selectedId}
          onSelect={onSelectStop}
        />
      ))}
    </Map>
  )
}

const StopMarkerPin = memo(function StopMarkerPin({
  marker,
  name,
  selected,
  onSelect,
}: {
  marker: StopMarker
  name: string
  selected: boolean
  onSelect: (stopId: string) => void
}) {
  const label = markerLabel(marker, name)
  return (
    <Marker
      longitude={marker.lng}
      latitude={marker.lat}
      // Draw the selected marker above its neighbours.
      style={selected ? { zIndex: 1 } : undefined}
    >
      {/* TODO(#15): open StopMenu on right-click / long-press once it's merged. */}
      <button
        type="button"
        className="stop-marker"
        data-kind={marker.kind}
        data-skipped={marker.skipped || undefined}
        aria-pressed={selected}
        aria-label={label}
        title={label}
        style={
          { '--marker-color': dayColor(marker.dayNumber) } as CSSProperties
        }
        onClick={() => onSelect(marker.stopId)}
      >
        <MarkerContent marker={marker} />
      </button>
    </Marker>
  )
})

function MarkerContent({ marker }: { marker: StopMarker }) {
  if (marker.kind === 'start') {
    // Play triangle: where the trip begins.
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
      </svg>
    )
  }
  if (marker.kind === 'end') {
    // Flag: where the trip ends.
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 2.5v11.5M4 3h8l-2 3 2 3H4"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return <span aria-hidden="true">{marker.numberInDay ?? ''}</span>
}
