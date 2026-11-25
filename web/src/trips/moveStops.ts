// Moving stops by drag and drop: within a day, to another day, or to a new
// day added after the last one. Any stop can move, start and end included:
// after a move, the first stop on Day 1 is the trip's start and the last stop
// on the last day its end, so dragging a stop into or out of those places
// hands the role over. Works out every row that changes and saves them in one
// request, with an optimistic update that rolls back on failure.

import type { Dispatch } from 'react'
import type { Day, Stop, StopKind } from '../lib/database.types'
import { positionAtEnd, positionBetween } from '../lib/positions'
import { comparePositions } from '../lib/tripMath'
import type { TripEndKind } from './tripEnds'
import type { TripAction } from './tripState'

type Orderable = Pick<Stop, 'id' | 'kind' | 'position'>
type Movable = Pick<Stop, 'id' | 'kind' | 'day_id' | 'position'>

const rank = (s: Orderable) =>
  s.kind === 'start' ? 0 : s.kind === 'end' ? 2 : 1

/** A day's stops in display order: start first, end last, like orderTrip. */
function displayOrder<S extends Orderable>(stops: S[]): S[] {
  return [...stops].sort(
    (a, b) => rank(a) - rank(b) || comparePositions(a.position, b.position),
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
  /**
   * On `dayId`, at `index` among that day's stops in display order (without
   * the moved stop).
   */
  { type: 'day'; dayId: string; index: number } | { type: 'newDay' }

/**
 * Where `moved` goes when dropped on `target`, or null if nothing moves.
 * `stopsOnDay` gives a day's stops in display order.
 *
 * Within its own day, a drop on a stop takes that stop's place, like the
 * list animates while dragging. On another day, it goes before or after the
 * stop it's dropped on, or at the end of the day (but before the trip's end:
 * to become the end, drop it on the lower half of the end stop).
 */
export function dropPlacement(
  stopsOnDay: (dayId: string) => Orderable[],
  moved: Pick<Stop, 'id' | 'day_id'>,
  target: DropTarget,
): Placement | null {
  if (target.type === 'newDay') return { type: 'newDay' }

  const dayStops = stopsOnDay(target.dayId)
  if (target.dayId === moved.day_id) {
    if (target.type !== 'stop') return null
    const from = dayStops.findIndex((s) => s.id === moved.id)
    const to = dayStops.findIndex((s) => s.id === target.stopId)
    if (from === -1 || to === -1 || from === to) return null
    return { type: 'day', dayId: target.dayId, index: to }
  }

  const others = dayStops.filter((s) => s.id !== moved.id)
  let index = others.at(-1)?.kind === 'end' ? others.length - 1 : others.length
  if (target.type === 'stop') {
    const i = others.findIndex((s) => s.id === target.stopId)
    if (i !== -1) index = target.after ? i + 1 : i
  }
  return { type: 'day', dayId: target.dayId, index }
}

/** The fields of one stop that a move changes. */
export type StopChange = {
  id: string
  day_id?: string
  position?: string
  kind?: StopKind
}

/** Everything a move changes: maybe a new day, then the stops. */
export type MovePlan = { newDay: Day | null; changes: StopChange[] }

const ROLE_ERRORS: Record<TripEndKind, string> = {
  start: "Day 1 needs a stop to be the trip's start.",
  end: "The last day needs a stop to be the trip's end.",
}

/**
 * Work out what moving `moved` to `placement` changes. A drop on the new-day
 * zone adds a day after the last one (with id `newDayId`) and brings the
 * trip's end along, so the end stays on the last day.
 *
 * Then the first stop on Day 1 becomes the start and the last stop on the
 * last day the end (for whichever of the two the trip has), and the stops
 * that held those roles before become waypoints. Returns an error if that
 * leaves a role without a stop, and null if nothing changes.
 */
export function planMove(
  days: Day[],
  stops: Stop[],
  moved: Stop,
  placement: Placement,
  newDayId: string,
): MovePlan | { error: string } | null {
  let allDays = days
  let newDay: Day | null = null
  if (placement.type === 'newDay') {
    const now = new Date().toISOString()
    newDay = {
      id: newDayId,
      trip_id: moved.trip_id,
      position: positionAtEnd(days.map((d) => d.position)),
      notes: null,
      created_at: now,
      updated_at: now,
    }
    allDays = [...days, newDay]
  }
  const ordered = [...allDays].sort((a, b) =>
    comparePositions(a.position, b.position),
  )
  const lists = new Map<string, Movable[]>(
    ordered.map((d) => [
      d.id,
      displayOrder(stops.filter((s) => s.day_id === d.id)),
    ]),
  )
  const take = (stop: Movable) => {
    const list = lists.get(stop.day_id)
    const i = list?.findIndex((s) => s.id === stop.id) ?? -1
    if (list && i !== -1) list.splice(i, 1)
  }

  const target = placement.type === 'newDay' ? newDayId : placement.dayId
  const targetList = lists.get(target)
  if (!targetList) return null
  take(moved)
  const index = placement.type === 'newDay' ? 0 : placement.index
  targetList.splice(Math.min(Math.max(index, 0), targetList.length), 0, moved)
  if (placement.type === 'newDay') {
    const end = stops.find((s) => s.kind === 'end' && s.id !== moved.id)
    if (end) {
      take(end)
      targetList.push(end)
    }
  }

  // Hand the start and end to the stops now in those places.
  const kinds = new Map<string, StopKind>(stops.map((s) => [s.id, 'waypoint']))
  const first = lists.get(ordered[0].id)!
  const last = lists.get(ordered[ordered.length - 1].id)!
  const holders: [TripEndKind, Movable | undefined][] = [
    ['start', first[0]],
    ['end', last.at(-1)],
  ]
  for (const [role, holder] of holders) {
    if (!stops.some((s) => s.kind === role)) continue
    if (!holder || kinds.get(holder.id) !== 'waypoint')
      return { error: ROLE_ERRORS[role] }
    kinds.set(holder.id, role)
  }

  // New keys for stops that moved or changed role, fitting between their
  // neighbours; the others keep theirs.
  const original = new Map(stops.map((s) => [s.id, s]))
  const changes: StopChange[] = []
  for (const [dayId, list] of lists) {
    const changed = list.map((s) => {
      const was = original.get(s.id)!
      return (
        s.id === moved.id ||
        was.day_id !== dayId ||
        was.kind !== kinds.get(s.id)
      )
    })
    let prev: string | null = null
    list.forEach((stop, i) => {
      const was = original.get(stop.id)!
      let position = was.position
      if (changed[i]) {
        const before = prev
        const next =
          list
            .slice(i + 1)
            .filter((_, j) => !changed[i + 1 + j])
            .map((s) => s.position)
            .find((p) => before === null || comparePositions(p, before) > 0) ??
          null
        const fits =
          (before === null || comparePositions(position, before) > 0) &&
          (next === null || comparePositions(position, next) < 0)
        if (!fits) position = positionBetween(before, next)
      }
      prev = position
      const change: StopChange = { id: stop.id }
      if (was.day_id !== dayId) change.day_id = dayId
      if (was.position !== position) change.position = position
      const kind = kinds.get(stop.id)!
      if (was.kind !== kind) change.kind = kind
      if (Object.keys(change).length > 1) changes.push(change)
    })
  }

  if (changes.length === 0 && !newDay) return null
  return { newDay, changes }
}

/** A stop with `change` applied, as the database would save it. */
function applied(stop: Stop, change: StopChange): Stop {
  const next = { ...stop, ...change }
  // Start and end can't be skipped.
  if (next.kind !== 'waypoint') next.skipped = false
  return next
}

type Result<T> = { data: T | null; error: { message: string } | null }

/** Saves a batch of stop changes atomically, returning the saved rows. */
export type SaveStopChanges = (changes: StopChange[]) => Promise<Result<Stop[]>>

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
 * Carry out `plan`: update local state at once, then create the new day (if
 * any) and save the stop changes in one request.
 *
 * On failure, each changed stop is restored unless `isLatest(stopId)` says it
 * has been moved again since, and a new day is removed again (deleted, if it
 * was created; the database refuses to delete a day that has stops, so that
 * can't take anyone else's stops with it). Returns the error message, or
 * null.
 */
export async function applyMove(
  plan: MovePlan,
  {
    stops,
    dispatch,
    insertDay,
    deleteDay,
    save,
    isLatest,
  }: {
    stops: Stop[]
    dispatch: Dispatch<TripAction>
    insertDay: InsertDay
    deleteDay: DeleteDay
    save: SaveStopChanges
    isLatest: (stopId: string) => boolean
  },
): Promise<string | null> {
  const byId = new Map(stops.map((s) => [s.id, s]))
  const originals = plan.changes.flatMap((c) => {
    const stop = byId.get(c.id)
    return stop ? [stop] : []
  })
  const restore = () => {
    // The original rows are older than anything saved since, so this can't
    // overwrite someone else's newer change.
    for (const stop of originals)
      if (isLatest(stop.id)) dispatch({ type: 'upsertStop', stop })
  }
  const { newDay } = plan

  if (newDay) dispatch({ type: 'upsertDay', day: newDay })
  // Same updated_at as the current rows, so they aren't treated as stale; a
  // newer version from realtime still wins.
  for (const change of plan.changes) {
    const stop = byId.get(change.id)
    if (stop) dispatch({ type: 'upsertStop', stop: applied(stop, change) })
  }

  if (newDay) {
    const inserted = await attempt(() =>
      insertDay({
        id: newDay.id,
        trip_id: newDay.trip_id,
        position: newDay.position,
      }),
    )
    if (inserted.error || !inserted.data) {
      // Put the stops back first: removing a day drops its stops locally.
      restore()
      dispatch({ type: 'removeDay', id: newDay.id })
      return inserted.error?.message ?? 'The day could not be added.'
    }
    dispatch({ type: 'upsertDay', day: inserted.data })
  }

  if (plan.changes.length === 0) return null
  const result = await attempt(() => save(plan.changes))
  if (result.error || !result.data) {
    restore()
    if (newDay) {
      // Don't leave an empty day behind.
      const deleted = await attempt(() => deleteDay(newDay.id))
      if (!deleted.error) dispatch({ type: 'removeDay', id: newDay.id })
    }
    return result.error?.message ?? 'The stops could not be saved.'
  }
  for (const stop of result.data) dispatch({ type: 'upsertStop', stop })
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
