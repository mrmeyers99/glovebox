// Moving waypoints by drag and drop: within a day, to another day, or to a
// new day added after the last one. Works out where a dropped stop goes and
// saves it with an optimistic update that rolls back on failure.

import type { Dispatch } from 'react'
import type { Day, Stop } from '../lib/database.types'
import { positionAtEnd, positionBetween } from '../lib/positions'
import { comparePositions } from '../lib/tripMath'
import { endStopPlacement } from './tripEnds'
import type { TripAction } from './tripState'

type Orderable = Pick<Stop, 'id' | 'kind' | 'position'>

/**
 * A key for a stop inserted at `index` in `list` (sorted, without the stop
 * itself).
 */
function keyAt(list: Orderable[], index: number): string {
  const before: string | null = list[index - 1]?.position ?? null
  let after: string | null = list[index]?.position ?? null
  if (
    before !== null &&
    after !== null &&
    comparePositions(before, after) >= 0
  ) {
    // Neighbours share a key (e.g. two stops added at once by different
    // people), so nothing fits between them. Go just after the run of equal
    // keys instead; only the moved stop's row is ever written.
    after =
      list
        .slice(index)
        .map((s) => s.position)
        .find((p) => comparePositions(p, before) > 0) ?? null
  }
  return positionBetween(before, after)
}

/**
 * The new position key for waypoint `movedId` dropped where waypoint `overId`
 * is, given the day's stops in display order. Only waypoints move: start and
 * end stops always sort first and last whatever their keys, so the new key
 * only has to fit between its neighbouring waypoints.
 *
 * Returns null if nothing moves (dropped in place, or either id isn't a
 * waypoint on this day).
 */
export function reorderedPosition(
  dayStops: Orderable[],
  movedId: string,
  overId: string,
): string | null {
  const waypoints = dayStops.filter((s) => s.kind === 'waypoint')
  const from = waypoints.findIndex((s) => s.id === movedId)
  const to = waypoints.findIndex((s) => s.id === overId)
  if (from === -1 || to === -1 || from === to) return null
  return keyAt(
    waypoints.filter((s) => s.id !== movedId),
    to,
  )
}

/** Where a dragged stop was dropped. */
export type DropTarget =
  /** On a stop: the upper or lower half of it (`after`). */
  | { type: 'stop'; dayId: string; stopId: string; after: boolean }
  /** On a day but not a stop, e.g. a rest day: the end of that day. */
  | { type: 'day'; dayId: string }
  /** On the "+ Day N+1" zone after the last day. */
  | { type: 'newDay' }

/** Where a moved stop goes. */
export type Placement =
  { type: 'day'; dayId: string; position: string } | { type: 'newDay' }

/**
 * Where waypoint `moved` goes when dropped on `target`, or null if nothing
 * moves. `stopsOnDay` gives a day's stops in display order.
 *
 * Within its own day, a drop on a stop takes that stop's place, like the
 * list animates while dragging. On another day, it goes before or after the
 * stop it's dropped on, or at the end of the day (before its end stop).
 */
export function dropPlacement(
  stopsOnDay: (dayId: string) => Orderable[],
  moved: Pick<Stop, 'id' | 'kind' | 'day_id'>,
  target: DropTarget,
): Placement | null {
  if (moved.kind !== 'waypoint') return null
  if (target.type === 'newDay') return { type: 'newDay' }

  const dayStops = stopsOnDay(target.dayId)
  if (target.dayId === moved.day_id) {
    if (target.type !== 'stop') return null
    const position = reorderedPosition(dayStops, moved.id, target.stopId)
    return position === null
      ? null
      : { type: 'day', dayId: target.dayId, position }
  }

  const waypoints = dayStops.filter((s) => s.kind === 'waypoint')
  let index = waypoints.length
  if (target.type === 'stop') {
    const i = waypoints.findIndex((s) => s.id === target.stopId)
    if (i !== -1) index = target.after ? i + 1 : i
  }
  return { type: 'day', dayId: target.dayId, position: keyAt(waypoints, index) }
}

type Result<T> = { data: T | null; error: { message: string } | null }

/** The fields a move changes. */
export type StopMove = { day_id?: string; position: string }

/** The fields an optimistic stop update can change: a move, or skipping. */
export type StopPatch = StopMove | { skipped: boolean }

export type SaveStopMove = (
  stopId: string,
  patch: StopPatch,
) => Promise<Result<Stop>>

export type InsertDay = (
  day: Pick<Day, 'id' | 'trip_id' | 'position'>,
) => Promise<Result<Day>>

export type DeleteDay = (
  dayId: string,
) => Promise<{ error: { message: string } | null }>

/** Run `request`, turning a thrown error into an error result. */
async function attempt<R extends { error: { message: string } | null }>(
  request: () => Promise<R>,
): Promise<R | { data: null; error: { message: string } }> {
  try {
    return await request()
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : String(e) },
    }
  }
}

/**
 * Move `stop` (to another day and/or position) or skip or unskip it: update
 * local state at once, then save. If the save fails, restore the stop
 * (unless `isLatest` says a newer change of the same stop has happened
 * since) and return the error message.
 */
export async function moveStop(
  stop: Stop,
  move: StopPatch,
  {
    dispatch,
    save,
    isLatest,
  }: {
    dispatch: Dispatch<TripAction>
    save: SaveStopMove
    isLatest: () => boolean
  },
): Promise<string | null> {
  // Same updated_at as the current row, so it isn't treated as stale; a
  // newer version from realtime still wins over it.
  dispatch({ type: 'upsertStop', stop: { ...stop, ...move } })

  const result = await attempt(() => save(stop.id, move))
  if (result.error || !result.data) {
    // The original row is older than anything saved since, so this can't
    // overwrite someone else's newer change.
    if (isLatest()) dispatch({ type: 'upsertStop', stop })
    return result.error?.message ?? 'The stop could not be found.'
  }
  dispatch({ type: 'upsertStop', stop: result.data })
  return null
}

/**
 * Move `stop` to a new day added after the last one, and the trip's end stop
 * with it so the end stays on the last day. Local state updates at once.
 * Then the day is created, the stop moved into it, and the end stop moved.
 *
 * On failure, local changes not yet saved are rolled back (each stop unless
 * `isLatest(stopId)` says it has been moved again since), and if the day was
 * created but the stop couldn't move into it, the empty day is deleted again.
 * Returns the error message, or null.
 */
export async function moveToNewDay(
  stop: Stop,
  {
    days,
    stops,
    newDayId,
    dispatch,
    insertDay,
    deleteDay,
    save,
    isLatest,
  }: {
    days: Day[]
    stops: Stop[]
    newDayId: string
    dispatch: Dispatch<TripAction>
    insertDay: InsertDay
    deleteDay: DeleteDay
    save: SaveStopMove
    isLatest: (stopId: string) => boolean
  },
): Promise<string | null> {
  const now = new Date().toISOString()
  const day: Day = {
    id: newDayId,
    trip_id: stop.trip_id,
    position: positionAtEnd(days.map((d) => d.position)),
    notes: null,
    created_at: now,
    updated_at: now,
  }
  const move: StopMove = {
    day_id: day.id,
    position: positionBetween(null, null),
  }
  const end = endStopPlacement(
    [...days, day],
    stops.map((s) => (s.id === stop.id ? { ...s, ...move } : s)),
  )
  const endMove: StopMove | null = end && {
    day_id: end.dayId,
    position: end.position,
  }
  const restore = (original: Stop) => {
    if (isLatest(original.id)) dispatch({ type: 'upsertStop', stop: original })
  }

  dispatch({ type: 'upsertDay', day })
  dispatch({ type: 'upsertStop', stop: { ...stop, ...move } })
  if (end && endMove)
    dispatch({ type: 'upsertStop', stop: { ...end.stop, ...endMove } })

  const inserted = await attempt(() =>
    insertDay({ id: day.id, trip_id: day.trip_id, position: day.position }),
  )
  if (inserted.error || !inserted.data) {
    // Put the stops back first: removing a day drops its stops locally.
    restore(stop)
    if (end) restore(end.stop)
    dispatch({ type: 'removeDay', id: day.id })
    return inserted.error?.message ?? 'The day could not be added.'
  }
  dispatch({ type: 'upsertDay', day: inserted.data })

  const error = await moveStop(stop, move, {
    dispatch,
    save,
    isLatest: () => isLatest(stop.id),
  })
  if (error) {
    if (end) restore(end.stop)
    // Don't leave an empty day behind. The database refuses to delete a day
    // that has stops, so this can't take anyone else's stops with it.
    const deleted = await attempt(() => deleteDay(day.id))
    if (!deleted.error) dispatch({ type: 'removeDay', id: day.id })
    return error
  }

  if (end && endMove) {
    const endError = await moveStop(end.stop, endMove, {
      dispatch,
      save,
      isLatest: () => isLatest(end.stop.id),
    })
    if (endError) return `The end stop couldn't follow it: ${endError}`
  }
  return null
}

/** Screen-reader announcements for dragging stop `name`. */
export const moveAnnouncements = {
  start: (name: string, where: string) => `Picked up ${name}, ${where}.`,
  over: (name: string, where: string | null) =>
    where === null
      ? `${name} is not over a position.`
      : `${name} moved to ${where}.`,
  end: (name: string, where: string | null) =>
    where === null
      ? `${name} dropped. Its position didn't change.`
      : `${name} dropped at ${where}.`,
  cancel: (name: string) => `Moving cancelled. ${name} returned to its place.`,
}
