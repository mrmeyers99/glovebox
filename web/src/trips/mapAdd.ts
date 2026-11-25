// Adding a stop by pointing at the map: where the pin goes, what to call it,
// and which day it lands on. Pure, so it can be tested without a map.

import type { Day, Stop } from '../lib/database.types'
import type { LatLng, Place } from '../lib/geocode'
import { comparePositions } from '../lib/tripMath'

/** The stop name used when the spot has no known place. */
export const DROPPED_PIN_NAME = 'Dropped pin'

/** About 10 cm; more digits than that are just noise from the pointer. */
const COORD_DECIMALS = 6

function round(value: number) {
  const factor = 10 ** COORD_DECIMALS
  return Math.round(value * factor) / factor
}

/**
 * A clicked map point as a storable location: longitude wrapped into
 * -180..180 (the map repeats sideways), latitude clamped to -90..90 (the
 * database checks both), and both rounded.
 */
export function mapPoint(lat: number, lng: number): LatLng {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  return {
    lat: round(Math.min(90, Math.max(-90, lat))),
    // -180 and 180 are the same meridian; keep the one users expect.
    lng: round(wrapped === -180 && lng > 0 ? 180 : wrapped),
  }
}

/** Coordinates as text, e.g. `38.57000, -109.55000`. */
export function formatCoordinates({ lat, lng }: LatLng): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

/** A spot with no known place: "Dropped pin" and its coordinates. */
export function droppedPin(point: LatLng): Place {
  return {
    name: DROPPED_PIN_NAME,
    address: formatCoordinates(point),
    lat: point.lat,
    lng: point.lng,
  }
}

/**
 * The place for a stop dropped at `point`, named after the nearest place
 * found there (if any). The stop stays exactly where it was dropped, not
 * where the found place is: the point is what the user chose.
 */
export function placeAtPoint(point: LatLng, found: Place | null): Place {
  if (!found || found.name.trim() === '') return droppedPin(point)
  return {
    name: found.name,
    address:
      found.address.trim() === '' ? formatCoordinates(point) : found.address,
    lat: point.lat,
    lng: point.lng,
  }
}

/** The trip's days in order, numbered from 1. */
export function numberedDays(
  days: readonly Pick<Day, 'id' | 'position'>[],
): { dayId: string; dayNumber: number }[] {
  return [...days]
    .sort((a, b) => comparePositions(a.position, b.position))
    .map((day, i) => ({ dayId: day.id, dayNumber: i + 1 }))
}

/**
 * The day a stop dropped on the map goes to by default: the selected stop's
 * day, else the last day. Null if the trip has no days.
 */
export function defaultDropDay(
  days: readonly Pick<Day, 'id' | 'position'>[],
  stops: readonly Pick<Stop, 'id' | 'day_id'>[],
  selectedStopId: string | null,
): { dayId: string; dayNumber: number } | null {
  const ordered = numberedDays(days)
  const selectedDayId = stops.find((s) => s.id === selectedStopId)?.day_id
  return (
    ordered.find((d) => d.dayId === selectedDayId) ?? ordered.at(-1) ?? null
  )
}
