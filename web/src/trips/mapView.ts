// Pure helpers for the map's initial view. Kept free of map-library imports
// so the trip page can use them without pulling in the map chunk.

import type { Stop } from '../lib/database.types'

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
