// Managing days: notes, inserting a day after another, and deleting a day.
// The database refuses to delete a day that still has stops, so deleting one
// first moves its stops to a neighbouring day or deletes them, as the user
// chose, all in one request (the delete_day function). The trip's start and
// end are never deleted: they move to the new first or last day.

import type { Dispatch } from 'react'
import type { Day, Stop } from '../lib/database.types'
import { positionBetween, positionsBetween } from '../lib/positions'
import { comparePositions } from '../lib/tripMath'
import type { MovePlan, StopChange } from './moveStops'
import { tripEndSlot } from './tripEnds'
import type { TripAction } from './tripState'

type Positioned = Pick<Day, 'id' | 'position'>

function sortedDays<D extends Positioned>(days: D[]): D[] {
  return [...days].sort((a, b) => comparePositions(a.position, b.position))
}

function sortedKeys(keys: string[]): string[] {
  return [...keys].sort(comparePositions)
}

/** Notes as typed, saved trimmed; blank clears them. */
export function parseDayNotes(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * What inserting a day after `afterDayId` changes: a new empty day (with id
 * `newDayId`) between it and the next one. Inserted after the last day, it
 * becomes the last day, so the trip's end moves to it, as dropping a stop on
 * "+ Day N+1" does. Null if the day is gone.
 */
export function planInsertDay(
  days: Day[],
  stops: Stop[],
  afterDayId: string,
  newDayId: string,
): MovePlan | null {
  const ordered = sortedDays(days)
  const index = ordered.findIndex((d) => d.id === afterDayId)
  if (index === -1) return null
  const day = ordered[index]
  const next = ordered.at(index + 1)
  const now = new Date().toISOString()
  const newDay: Day = {
    id: newDayId,
    trip_id: day.trip_id,
    position: positionBetween(day.position, next?.position ?? null),
    notes: null,
    created_at: now,
    updated_at: now,
  }
  const changes: StopChange[] = []
  const end = stops.find((s) => s.kind === 'end')
  if (!next && end?.day_id === afterDayId) {
    const slot = tripEndSlot('end', [...days, newDay], stops)!
    changes.push({ id: end.id, day_id: slot.dayId, position: slot.position })
  }
  return { newDay, changes }
}

/**
 * Where a deleted day's stops can go: the day before it, or the next day if
 * it's Day 1. Null if the day is gone or is the only one.
 */
export function deleteDayTarget<D extends Positioned>(
  days: D[],
  dayId: string,
): D | null {
  const ordered = sortedDays(days)
  const index = ordered.findIndex((d) => d.id === dayId)
  if (index === -1 || ordered.length < 2) return null
  return ordered[index === 0 ? 1 : index - 1]
}

/** Move a deleted day's stops to the neighbouring day, or delete them. */
export type DeleteDayChoice = 'move' | 'delete'

export type DeleteDayPlan = {
  dayId: string
  /** Stops moved to other days (and the start or end, either way). */
  moves: StopChange[]
  /** Stops deleted with the day. */
  deleteIds: string[]
}

/**
 * What deleting `dayId` changes. With 'move', its stops go to the end of the
 * day before (after its other stops, before the trip's end), or to the start
 * of Day 2 if it's Day 1, keeping their order. With 'delete', they're deleted,
 * except the trip's start and end, which move to the new first or last day.
 */
export function planDeleteDay(
  days: Day[],
  stops: Stop[],
  dayId: string,
  choice: DeleteDayChoice,
): DeleteDayPlan | { error: string } {
  if (!days.some((d) => d.id === dayId))
    return { error: 'This day no longer exists.' }
  const target = deleteDayTarget(days, dayId)
  if (!target) return { error: 'A trip needs at least one day.' }

  const onDay = stops.filter((s) => s.day_id === dayId)
  const waypoints = onDay
    .filter((s) => s.kind === 'waypoint')
    .sort((a, b) => comparePositions(a.position, b.position))
  const moves: StopChange[] = []
  const deleteIds: string[] = []

  if (choice === 'delete') {
    deleteIds.push(...waypoints.map((s) => s.id))
  } else if (waypoints.length > 0) {
    const targetStops = stops.filter((s) => s.day_id === target.id)
    const keysOf = (kind: (k: Stop['kind']) => boolean) =>
      sortedKeys(targetStops.filter((s) => kind(s.kind)).map((s) => s.position))
    let keys: string[]
    if (sortedDays(days)[0].id === dayId) {
      // Before Day 2's stops, after the start.
      const upper = keysOf((k) => k !== 'start').at(0) ?? null
      keys = positionsBetween(null, upper, waypoints.length)
    } else {
      // After the day's stops, before the end (if its key is in order).
      const lower = keysOf((k) => k !== 'end').at(-1) ?? null
      const end = keysOf((k) => k === 'end').at(0) ?? null
      const upper =
        end !== null && (lower === null || comparePositions(end, lower) > 0)
          ? end
          : null
      keys = positionsBetween(lower, upper, waypoints.length)
    }
    waypoints.forEach((stop, i) =>
      moves.push({ id: stop.id, day_id: target.id, position: keys[i] }),
    )
  }

  // The start and end go to the new first or last day.
  const remainingDays = days.filter((d) => d.id !== dayId)
  const moved = new Map(moves.map((m) => [m.id, m]))
  const remainingStops = stops
    .filter((s) => s.day_id !== dayId || moved.has(s.id))
    .map((s) => ({ ...s, ...moved.get(s.id) }))
  for (const stop of onDay) {
    if (stop.kind === 'waypoint') continue
    const slot = tripEndSlot(stop.kind, remainingDays, remainingStops)!
    moves.push({ id: stop.id, day_id: slot.dayId, position: slot.position })
  }

  return { dayId, moves, deleteIds }
}

type Result<T> = {
  data: T | null
  error: { code?: string; message: string } | null
}

/** Runs delete_day: applies the moves, deletes the stops and the day. */
export type SaveDeleteDay = (plan: DeleteDayPlan) => Promise<Result<Stop[]>>

/** A readable message for a failed delete. */
export function deleteDayError(error: {
  code?: string
  message: string
}): string {
  // The day still has stops: someone added one meanwhile.
  if (error.code === '23503')
    return 'Someone added a stop to this day meanwhile. Check it and try again.'
  if (error.code === '23514') return 'A trip needs at least one day.'
  // Row-level security hid the day: no longer allowed to edit.
  if (error.code === 'P0002')
    return "This day no longer exists, or you can't change this trip."
  return error.message
}

/**
 * Carry out `plan` and, once it's saved, update local state. Not optimistic:
 * a removed day can't be brought back locally, so nothing changes on screen
 * until the database has done it. Returns an error message, or null.
 */
export async function deleteDay(
  plan: DeleteDayPlan,
  { dispatch, save }: { dispatch: Dispatch<TripAction>; save: SaveDeleteDay },
): Promise<string | null> {
  let result: Result<Stop[]>
  try {
    result = await save(plan)
  } catch (e) {
    result = {
      data: null,
      error: { message: e instanceof Error ? e.message : String(e) },
    }
  }
  if (result.error || !result.data)
    return deleteDayError(
      result.error ?? { message: 'The day could not be deleted.' },
    )
  for (const stop of result.data) dispatch({ type: 'upsertStop', stop })
  for (const id of plan.deleteIds)
    dispatch({ type: 'removeStop', id, ifPresent: true })
  dispatch({ type: 'removeDay', id: plan.dayId, ifPresent: true })
  return null
}
