// The MapLibre map. Imported lazily by MapPanel so maplibre-gl lands in its
// own chunk and stays off the trip list page.

import 'maplibre-gl/dist/maplibre-gl.css'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import {
  AttributionControl,
  Layer,
  Map,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type LineLayerSpecification,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { Day, Stop } from '../lib/database.types'
import type { LatLng } from '../lib/geocode'
import type { TripSummary } from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import {
  FIT_MAX_ZOOM,
  FIT_PADDING,
  MAP_STYLE_URL,
  OSM_ATTRIBUTION,
  dayColor,
  dayColorExpression,
  highlightedDay,
  initialBounds,
  markerLabel,
  routeBounds,
  routeLines,
  routeReady,
  stopMarkers,
  type StopMarker,
  type StopSelection,
} from './mapView'
import { mapPoint } from './mapAdd'
import { useDayPalette } from './useDayPalette'

// MapLibre finds its worker next to its own module file. Vite moves that
// module (pre-bundling in dev, chunking in builds) and doesn't copy the worker,
// so point MapLibre at a URL that Vite serves and emits.
maplibregl.setWorkerUrl(workerUrl)

export default function TripMap({
  days,
  stops,
  summary,
  showSkipped,
  selection,
  onSelectStop,
  onAddStopAt,
}: {
  days: readonly Day[]
  stops: readonly Stop[]
  summary: TripSummary
  showSkipped: boolean
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  /** Owners and editors: offers "Add stop here" on right-click / long-press. */
  onAddStopAt?: (point: LatLng) => void
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

  const lines = useMemo(() => routeLines(summary), [summary])
  const highlight = highlightedDay(summary, selectedId)
  const palette = useDayPalette()
  const linePaint = useMemo(
    () => routeLinePaint(palette, highlight),
    [palette, highlight],
  )
  const casingPaint = useMemo(() => routeCasingPaint(highlight), [highlight])

  // Fit to the route once, when it first finishes loading; later edits
  // don't move the map under the user.
  const ready = routeReady(summary, lines)
  const bounds = useMemo(
    () => (ready ? routeBounds(lines) : null),
    [ready, lines],
  )
  const fitted = useRef(false)
  const fitToRoute = useCallback(() => {
    const map = mapRef.current
    if (fitted.current || !bounds || !map) return
    fitted.current = true
    map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM })
  }, [bounds])
  useEffect(fitToRoute, [fitToRoute])

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

  const dropPin = useDropPin(mapRef, onAddStopAt !== undefined)

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
      // In case the route was ready before the map was.
      onLoad={fitToRoute}
      {...dropPin.handlers}
    >
      <Source id="route" type="geojson" data={lines}>
        <Layer
          id="route-casing"
          type="line"
          layout={ROUTE_LAYOUT}
          paint={casingPaint}
        />
        <Layer
          id="route-line"
          type="line"
          layout={ROUTE_LAYOUT}
          paint={linePaint}
        />
      </Source>
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
      {dropPin.pin && onAddStopAt && (
        <Popup
          longitude={dropPin.pin.lng}
          latitude={dropPin.pin.lat}
          anchor="bottom"
          className="map-add-popup"
          // Closed by our own click handler, which ignores the click that
          // can follow a long press.
          closeOnClick={false}
          closeButton={false}
          onClose={dropPin.close}
        >
          <button
            type="button"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') dropPin.close()
            }}
            onClick={() => {
              const { lat, lng } = dropPin.pin ?? {}
              dropPin.close()
              if (lat !== undefined && lng !== undefined)
                onAddStopAt({ lat, lng })
            }}
          >
            Add stop here
          </button>
        </Popup>
      )}
    </Map>
  )
}

/** Ignore map clicks this soon after the pin is dropped (see Popup above). */
const IGNORE_CLICK_MS = 600

/**
 * A pin dropped by right-clicking (desktop) or long-pressing (touch) an
 * empty spot on the map, while `enabled`. MapLibre turns a long press into a
 * contextmenu event, and skips the one that ends a right-drag rotate. Presses
 * on markers, popups and controls don't count: only ones on the bare map.
 */
function useDropPin(mapRef: RefObject<MapRef | null>, enabled: boolean) {
  const [pin, setPin] = useState<(LatLng & { at: number }) | null>(null)
  const close = useCallback(() => setPin(null), [])

  if (!enabled) return { pin: null, close, handlers: {} }

  const handlers = {
    onContextMenu: (e: MapLayerMouseEvent) => {
      const canvas = mapRef.current?.getCanvas()
      // The long-press event isn't dispatched to an element, so check what
      // is under the pointer rather than the event's target.
      const { clientX, clientY } = e.originalEvent
      if (!canvas || document.elementFromPoint(clientX, clientY) !== canvas)
        return
      // Instead of the browser's own menu.
      e.originalEvent.preventDefault()
      setPin({ ...mapPoint(e.lngLat.lat, e.lngLat.lng), at: Date.now() })
    },
    // Some browsers follow a long press with a click; don't let it close
    // the popup it just opened.
    onClick: () => {
      if (pin && Date.now() - pin.at > IGNORE_CLICK_MS) close()
    },
  }
  return { pin, close, handlers }
}

type LinePaint = NonNullable<LineLayerSpecification['paint']>
type LineLayout = NonNullable<LineLayerSpecification['layout']>

const ROUTE_LAYOUT: LineLayout = { 'line-join': 'round', 'line-cap': 'round' }

/** Line width (px) for a leg: wider on the highlighted day. */
function routeWidth(
  highlight: number | null,
  normal: number,
  wide: number,
): number | ExpressionSpecification {
  if (highlight === null) return normal
  return ['case', ['==', ['get', 'dayNumber'], highlight], wide, normal - 1]
}

/** Legs of other days fade while a day is highlighted. */
function routeOpacity(
  highlight: number | null,
  normal: number,
): number | ExpressionSpecification {
  if (highlight === null) return normal
  return ['case', ['==', ['get', 'dayNumber'], highlight], 1, 0.35]
}

function routeLinePaint(
  palette: string[],
  highlight: number | null,
): LinePaint {
  return {
    'line-color': dayColorExpression(palette),
    'line-width': routeWidth(highlight, 4, 6),
    'line-opacity': routeOpacity(highlight, 0.9),
  }
}

/** A white outline under each line, so it reads over roads and labels. */
function routeCasingPaint(highlight: number | null): LinePaint {
  return {
    'line-color': '#ffffff',
    'line-width': routeWidth(highlight, 7, 9),
    'line-opacity': routeOpacity(highlight, 0.9),
  }
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
