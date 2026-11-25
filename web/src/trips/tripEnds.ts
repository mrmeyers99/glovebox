// The trip's start and end stops: the start lives on the first day and the
// end on the last day. When days are added or removed, the end stop follows
// the last day (and the start the first day).

import type { Day, Stop, StopKind } from '../lib/database.types'
import type { Place } from '../lib/geocode'
import { positionAtEnd, positionAtStart } from '../lib/positions'
import { comparePositions } from '../lib/tripMath'
import { emptyStopForm, parseStopForm, type StopFormErrors } from './addStop'

type Positioned = Pick<Day, 'id' | 'position'>
type Placeable = Pick<Stop, 'id' | 'kind' | 'day_id' | 'position'>

/** The start or end stop. */
export type TripEndKind = Exclude<StopKind, 'waypoint'>

function sortedDays<D extends Positioned>(days: D[]): D[] {
  // A stable sort, like orderTrip, so ties resolve the same way.
  return [...days].sort((a, b) => comparePositions(a.position, b.position))
}

/** The first day in order, or undefined if there are none. */
export function firstDay<D extends Positioned>(days: D[]): D | undefined {
  return sortedDays(days).at(0)
}

/** The last day in order, or undefined if there are none. */
export function lastDay<D extends Positioned>(days: D[]): D | undefined {
  return sortedDays(days).at(-1)
}

/**
 * Where a start or end stop belongs: on the first (or last) day, before (or
 * after) that day's other stops. Null if the trip has no days. The start and
 * end are listed first and last whatever their keys, but keeping the keys in
 * order too means nothing depends on that.
 */
export function tripEndSlot(
  kind: TripEndKind,
  days: Positioned[],
  stops: Placeable[],
): { dayId: string; position: string } | null {
  const day = kind === 'start' ? firstDay(days) : lastDay(days)
  if (!day) return null
  const keys = stops
    .filter((s) => s.day_id === day.id && s.kind !== kind)
    .map((s) => s.position)
  return {
    dayId: day.id,
    position: kind === 'start' ? positionAtStart(keys) : positionAtEnd(keys),
  }
}

/**
 * Where to move the trip's start or end stop so it's on the first or last
 * day, or null if it already is (or there's no such stop or no day).
 */
export function tripEndPlacement<S extends Placeable>(
  kind: TripEndKind,
  days: Positioned[],
  stops: S[],
): { stop: S; dayId: string; position: string } | null {
  const stop = stops.find((s) => s.kind === kind)
  const slot = tripEndSlot(kind, days, stops)
  if (!stop || !slot || stop.day_id === slot.dayId) return null
  return { stop, ...slot }
}

/** Where to move the end stop so it's on the last day; see tripEndPlacement. */
export function endStopPlacement<S extends Placeable>(
  days: Positioned[],
  stops: S[],
): { stop: S; dayId: string; position: string } | null {
  return tripEndPlacement('end', days, stops)
}

/** Which of the start and end the trip doesn't have yet. */
export function missingTripEnds(stops: Pick<Stop, 'kind'>[]): Set<TripEndKind> {
  const missing = new Set<TripEndKind>(['start', 'end'])
  for (const stop of stops)
    if (stop.kind !== 'waypoint') missing.delete(stop.kind)
  return missing
}

export type TripEndFields = Pick<Stop, 'name' | 'address' | 'lat' | 'lng'>

export type TripEndFormResult =
  | { ok: true; fields: TripEndFields }
  | { ok: false; errors: Pick<StopFormErrors, 'name' | 'place'> }

/** The start/end form: a picked place and a name, checked like a stop's. */
export function parseTripEndForm(
  name: string,
  place: Place | null,
): TripEndFormResult {
  const result = parseStopForm({ ...emptyStopForm, name }, place)
  if (!result.ok) return result
  const { name: n, address, lat, lng } = result.fields
  return { ok: true, fields: { name: n, address, lat, lng } }
}

/** A readable message for a failed start/end save. */
export function tripEndSaveError(
  kind: TripEndKind,
  error: { code?: string; message: string },
): string {
  // stops_one_start_idx / stops_one_end_idx: someone else set it meanwhile.
  if (error.code === '23505')
    return `This trip already has ${kind === 'start' ? 'a start' : 'an end'}. Close this and change it instead.`
  return error.message
}
