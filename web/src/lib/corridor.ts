// Route corridor: which map tiles a trip's route passes near, and how far a
// place is from the route. Discovery (requirements §9) caches places per tile,
// so the app asks for the tiles along the corridor and then filters and sorts
// places by their distance from the route. Pure functions.

import { decodePolyline } from './polyline'
import type { Leg } from './tripMath'

/** A point as [lat, lng] in degrees, like decodePolyline returns. */
export type LatLng = [number, number]

/** How far either side of the route to look for suggestions, in km. */
export const CORRIDOR_RADIUS_KM = 80

/** Tile size in degrees; matches public.place_tile_key() in the database. */
export const TILE_DEG = 0.5

/**
 * Spacing, in km, of the points a route line is sampled at before tiling.
 * Every point of the line is within half this of a sample.
 */
export const SAMPLE_STEP_KM = 5

const EARTH_RADIUS_KM = 6371.0088
const KM_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_KM
const toRad = (deg: number) => (deg * Math.PI) / 180

/** Longitude wrapped to [-180, 180). */
const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180

/** South-west corner of the tile containing a coordinate. */
const tileFloor = (deg: number) => Math.floor(deg / TILE_DEG) * TILE_DEG

// One decimal, and never "-0.0".
const formatDeg = (deg: number) => (deg === 0 ? 0 : deg).toFixed(1)

/**
 * The key of the 0.5° tile containing a point: its south-west corner as
 * '<lat>_<lng>', e.g. (42.7, -96.2) → '42.5_-96.5'. A point on a grid line
 * belongs to the tile to its north / east. Matches public.place_tile_key().
 */
export function tileKey(lat: number, lng: number): string {
  return `${formatDeg(tileFloor(lat))}_${formatDeg(tileFloor(lng))}`
}

/** Great-circle distance between two points, in km. */
export function haversineKm([lat1, lng1]: LatLng, [lat2, lng2]: LatLng) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Keys of the tiles any part of which is within radiusKm of a point, such as
 * the campgrounds around a day's last stop.
 */
export function tilesNear(point: LatLng, radiusKm: number): Set<string> {
  const keys = new Set<string>()
  addTilesNear(keys, point, radiusKm)
  return keys
}

function addTilesNear(keys: Set<string>, point: LatLng, radiusKm: number) {
  const [lat, lng] = point
  const dLat = radiusKm / KM_PER_DEG
  const south = Math.max(-90, lat - dLat)
  const north = Math.min(90 - TILE_DEG / 2, lat + dLat)
  // Longitude degrees shrink toward the poles: size the box for the
  // widest-latitude edge, and stop at a whole turn near the poles.
  const cos = Math.cos(toRad(Math.max(Math.abs(south), Math.abs(north))))
  const dLng = Math.min(180, radiusKm / (KM_PER_DEG * Math.max(cos, 1e-6)))
  for (let s = tileFloor(south); s <= north; s += TILE_DEG) {
    for (let w = tileFloor(lng - dLng); w <= lng + dLng; w += TILE_DEG) {
      // The nearest point of the tile to `point`.
      const nearest: LatLng = [
        Math.min(Math.max(lat, s), s + TILE_DEG),
        Math.min(Math.max(lng, w), w + TILE_DEG),
      ]
      if (haversineKm(point, nearest) <= radiusKm)
        keys.add(tileKey(s, wrapLng(w)))
    }
  }
}

/**
 * Points every stepKm along a line, plus its ends, so that a long line with
 * many vertices becomes a few evenly spaced points. Every point of the line
 * is within stepKm / 2 (along the line) of a sample.
 */
export function sampleLine(line: LatLng[], stepKm = SAMPLE_STEP_KM): LatLng[] {
  if (line.length === 0) return []
  const samples: LatLng[] = [line[0]]
  // Distance along the line since the last sample.
  let travelled = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    // Take the short way round across the antimeridian.
    const b: LatLng = [line[i][0], a[1] + wrapLng(line[i][1] - a[1])]
    const length = haversineKm(a, b)
    let along = stepKm - travelled
    while (along < length) {
      const t = along / length
      samples.push([
        a[0] + (b[0] - a[0]) * t,
        wrapLng(a[1] + (b[1] - a[1]) * t),
      ])
      along += stepKm
    }
    travelled = length - (along - stepKm)
  }
  const last = line[line.length - 1]
  const lastSample = samples[samples.length - 1]
  if (last[0] !== lastSample[0] || last[1] !== lastSample[1]) samples.push(last)
  return samples
}

/**
 * Keys of the tiles within radiusKm of any route line. Lines are sampled
 * every SAMPLE_STEP_KM first so a cross-country trip stays fast; to make up
 * for the gaps, each sample covers radiusKm + half a step, so the corridor
 * may reach up to a couple of km further than radiusKm, never less.
 */
export function corridorTiles(
  lines: LatLng[][],
  radiusKm = CORRIDOR_RADIUS_KM,
): Set<string> {
  const keys = new Set<string>()
  for (const line of lines) {
    for (const sample of sampleLine(line)) {
      addTilesNear(keys, sample, radiusKm + SAMPLE_STEP_KM / 2)
    }
  }
  return keys
}

/**
 * Shortest distance in km from a point to a segment, treating the area
 * around the point as flat (accurate to well under 1% within a few hundred
 * km, which is all the detour filter and sorting need).
 */
function segmentDistanceKm(point: LatLng, a: LatLng, b: LatLng) {
  const kx = KM_PER_DEG * Math.cos(toRad(point[0]))
  // Positions relative to the point, in km, with longitude differences
  // wrapped to [-180, 180) so a segment near the antimeridian isn't far away.
  const x = (lng: number) => wrapLng(lng - point[1])
  const ax = x(a[1]) * kx
  const ay = (a[0] - point[0]) * KM_PER_DEG
  const bx = x(b[1]) * kx
  const by = (b[0] - point[0]) * KM_PER_DEG
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0
      ? 0
      : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSq))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

/**
 * Shortest distance in km from a place to any route line, used for the
 * detour filter and for sorting suggestions. Infinity when there is no route.
 */
export function distanceFromRoute(point: LatLng, lines: LatLng[][]): number {
  let best = Infinity
  for (const line of lines) {
    if (line.length === 1) {
      best = Math.min(best, haversineKm(point, line[0]))
      continue
    }
    for (let i = 1; i < line.length; i++) {
      best = Math.min(best, segmentDistanceKm(point, line[i - 1], line[i]))
    }
  }
  return best
}

/**
 * Route lines for a trip's legs. Legs only join active stops (summarizeTrip
 * routes around skipped ones), so skipped stops are never on the corridor. A
 * leg without a usable driving line yet (pending, failed or malformed) is a
 * straight line between its stops, so suggestions don't wait on routing.
 */
export function legLines(legs: Leg[]): LatLng[][] {
  return legs.map((leg) => {
    const points = leg.route?.geometry
      ? decodePolyline(leg.route.geometry)
      : null
    if (points && points.length >= 2) return points
    return [
      [leg.from.lat, leg.from.lng],
      [leg.to.lat, leg.to.lng],
    ]
  })
}
