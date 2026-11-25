// Pure helpers for the map's initial view. Kept free of map-library imports
// so the trip page can use them without pulling in the map chunk.

// Type-only: erased at build time, so the map chunk stays separate.
import type { ExpressionSpecification } from 'maplibre-gl'
import type { Stop, StopKind } from '../lib/database.types'
import { decodePolyline } from '../lib/polyline'
import {
  orderTrip,
  type DayInput,
  type StopInput,
  type TripSummary,
} from '../lib/tripMath'

/**
 * Map style. OpenFreeMap needs no API key or account; its tiles carry the
 * required OpenStreetMap attribution, which the map's attribution control
 * shows. Change this one constant to switch tile providers.
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/**
 * OpenStreetMap credit shown even when the tile source fails to load (content
 * blockers such as Brave Shields block OpenFreeMap's tile index, which carries
 * the credit). It matches the link inside OpenFreeMap's own credit exactly, so
 * once that loads MapLibre folds this into it instead of showing it twice.
 */
export const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'

/** [[west, south], [east, north]] in degrees. */
export type LngLatBounds = [[number, number], [number, number]]

/** Shown when a trip has no stops yet. */
export const CONTINENTAL_US_BOUNDS: LngLatBounds = [
  [-125, 24],
  [-66.5, 49.5],
]

/** Padding (px) around the stops when fitting the map to them. */
export const FIT_PADDING = 48

/** Don't zoom in further than this when fitting, e.g. for a single stop. */
export const FIT_MAX_ZOOM = 12

/**
 * Bounds that contain the trip's mapped stops, or the continental US when
 * there are none. Skipped stops aren't shown on the map, so they're left out.
 */
export function initialBounds(
  stops: readonly Pick<Stop, 'lat' | 'lng' | 'skipped'>[],
): LngLatBounds {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const stop of stops) {
    if (stop.skipped) continue
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue
    west = Math.min(west, stop.lng)
    east = Math.max(east, stop.lng)
    south = Math.min(south, stop.lat)
    north = Math.max(north, stop.lat)
  }
  if (west === Infinity) return CONTINENTAL_US_BOUNDS
  return [
    [west, south],
    [east, north],
  ]
}

/**
 * Number of colours in the day palette (`--day-color-1` … in index.css,
 * with light and dark variants). Days past the last colour cycle back to
 * the first.
 */
export const DAY_COLOR_COUNT = 8

/** 0-based palette index for a 1-based day number. */
export function dayColorIndex(dayNumber: number): number {
  const i = (dayNumber - 1) % DAY_COLOR_COUNT
  return i < 0 ? i + DAY_COLOR_COUNT : i
}

/** CSS colour for a day, e.g. for a marker fill or a day-list swatch. */
export function dayColor(dayNumber: number): string {
  return `var(--day-color-${dayColorIndex(dayNumber) + 1})`
}

export type StopMarker = {
  stopId: string
  lat: number
  lng: number
  kind: StopKind
  skipped: boolean
  /** 1-based day number. */
  dayNumber: number
  colorIndex: number
  /**
   * 1-based position among the trip's active waypoints, counting across days
   * in the order the route visits them. Null for skipped stops, which aren't
   * on the route, and for start and end, which show an icon instead.
   */
  stopNumber: number | null
}

/**
 * Markers for the trip's stops, in trip order. Skipped stops are left out
 * unless `showSkipped` is set; when shown they're listed first so active
 * markers draw on top of them. Stops without finite coordinates are dropped.
 */
export function stopMarkers(
  days: DayInput[],
  stops: StopInput[],
  options: { showSkipped: boolean },
): StopMarker[] {
  const active: StopMarker[] = []
  const skipped: StopMarker[] = []
  let count = 0
  orderTrip(days, stops).forEach(({ stops: dayStops }, i) => {
    const dayNumber = i + 1
    for (const stop of dayStops) {
      const numbered = !stop.skipped && stop.kind === 'waypoint'
      if (numbered) count += 1
      if (stop.skipped && !options.showSkipped) continue
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue
      const marker: StopMarker = {
        stopId: stop.id,
        lat: stop.lat,
        lng: stop.lng,
        kind: stop.kind,
        skipped: stop.skipped,
        dayNumber,
        colorIndex: dayColorIndex(dayNumber),
        stopNumber: numbered ? count : null,
      }
      ;(stop.skipped ? skipped : active).push(marker)
    }
  })
  return [...skipped, ...active]
}

/** Accessible name for a marker, e.g. "Day 2, stop 3: Moab" or "Day 3: Home (end)". */
export function markerLabel(marker: StopMarker, name: string): string {
  const where =
    marker.stopNumber === null
      ? `Day ${marker.dayNumber}`
      : `Day ${marker.dayNumber}, stop ${marker.stopNumber}`
  const notes = [
    marker.kind === 'waypoint' ? null : marker.kind,
    marker.skipped ? 'skipped' : null,
  ].filter(Boolean)
  return `${where}: ${name}${notes.length ? ` (${notes.join(', ')})` : ''}`
}

/**
 * The selected stop, and which panel it was picked in: the other panel
 * follows it (the list scrolls to it, the map pans to it).
 */
export type StopSelection = { stopId: string; source: 'list' | 'map' }

/** One leg's driving line, as a GeoJSON LineString feature. */
export type RouteLineFeature = {
  type: 'Feature'
  properties: {
    /** Arrival stop of the leg, which identifies it within the trip. */
    toStopId: string
    /** 1-based number of the day the leg counts toward (its arrival stop's). */
    dayNumber: number
    colorIndex: number
  }
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

export type RouteLines = {
  type: 'FeatureCollection'
  features: RouteLineFeature[]
}

/**
 * Driving lines for the trip's legs, coloured by the day each leg counts
 * toward. Legs only join active stops (summarizeTrip routes around skipped
 * ones), so no line touches a skipped stop. Legs without a usable route yet
 * (pending, failed, zero-length or malformed geometry) are left out.
 */
export function routeLines(summary: TripSummary): RouteLines {
  const dayNumbers = new Map(summary.days.map((d) => [d.dayId, d.dayNumber]))
  const features: RouteLineFeature[] = []
  for (const leg of summary.legs) {
    const encoded = leg.route?.geometry
    const dayNumber = dayNumbers.get(leg.dayId)
    if (!encoded || dayNumber === undefined) continue
    const points = decodePolyline(encoded)
    if (!points || points.length < 2) continue
    features.push({
      type: 'Feature',
      properties: {
        toStopId: leg.to.id,
        dayNumber,
        colorIndex: dayColorIndex(dayNumber),
      },
      // GeoJSON is [lng, lat].
      geometry: {
        type: 'LineString',
        coordinates: points.map(([lat, lng]) => [lng, lat]),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** Bounds containing every route line, or null when there are none. */
export function routeBounds(lines: RouteLines): LngLatBounds | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const feature of lines.features) {
    for (const [lng, lat] of feature.geometry.coordinates) {
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  if (west === Infinity) return null
  return [
    [west, south],
    [east, north],
  ]
}

/**
 * The route is fully loaded once no leg is still waiting for its route and
 * at least one line can be drawn: the moment to fit the map to it.
 */
export function routeReady(summary: TripSummary, lines: RouteLines): boolean {
  return summary.totals.pendingLegs === 0 && lines.features.length > 0
}

/**
 * Day number whose legs to highlight: the day of the selected stop, or null
 * when nothing is selected (or the stop is gone).
 */
export function highlightedDay(
  summary: TripSummary,
  selectedStopId: string | null,
): number | null {
  if (selectedStopId === null) return null
  for (const day of summary.days) {
    if (day.stops.some((s) => s.id === selectedStopId)) return day.dayNumber
  }
  return null
}

const FALLBACK_ROUTE_COLOR = '#888888'

/**
 * A MapLibre `match` expression picking a feature's colour from its
 * `colorIndex` property. MapLibre paint can't read CSS variables, so the
 * palette is resolved from the page's styles first (see useDayPalette).
 */
export function dayColorExpression(
  palette: readonly string[],
): ExpressionSpecification {
  // A colour that didn't resolve (styles not loaded) would make MapLibre
  // reject the whole layer, so fall back to grey.
  const color = (i: number) => palette[i] || FALLBACK_ROUTE_COLOR
  const cases = Array.from({ length: DAY_COLOR_COUNT }, (_, i) => [
    i,
    color(i),
  ]).flat()
  // The spec's tuple type needs at least one literal case, which a spread
  // can't show the compiler; there are always DAY_COLOR_COUNT cases.
  return [
    'match',
    ['get', 'colorIndex'],
    ...cases,
    color(0),
  ] as unknown as ExpressionSpecification
}
