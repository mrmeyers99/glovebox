// Pure helpers for the map's initial view. Kept free of map-library imports
// so the trip page can use them without pulling in the map chunk.

import type { Stop, StopKind } from '../lib/database.types'
import { orderTrip, type DayInput, type StopInput } from '../lib/tripMath'

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
   * 1-based position among the day's active stops, start and end included,
   * so it matches the order the route visits them. Null for skipped stops,
   * which aren't on the route.
   */
  numberInDay: number | null
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
  orderTrip(days, stops).forEach(({ stops: dayStops }, i) => {
    const dayNumber = i + 1
    let count = 0
    for (const stop of dayStops) {
      if (!stop.skipped) count += 1
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
        numberInDay: stop.skipped ? null : count,
      }
      ;(stop.skipped ? skipped : active).push(marker)
    }
  })
  return [...skipped, ...active]
}

/** Accessible name for a marker, e.g. "Day 2, stop 3: Moab (end)". */
export function markerLabel(marker: StopMarker, name: string): string {
  const where =
    marker.numberInDay === null
      ? `Day ${marker.dayNumber}`
      : `Day ${marker.dayNumber}, stop ${marker.numberInDay}`
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
