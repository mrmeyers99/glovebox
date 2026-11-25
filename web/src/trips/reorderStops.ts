// Reordering waypoints within a day: where a dropped stop's new position key
// goes, and saving it with an optimistic update that rolls back on failure.

import type { Dispatch } from 'react'
import type { Stop } from '../lib/database.types'
import { positionBetween } from '../lib/positions'
import { comparePositions } from '../lib/tripMath'
import type { TripAction } from './tripState'

type Orderable = Pick<Stop, 'id' | 'kind' | 'position'>

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

  const reordered = [...waypoints]
  const [moved] = reordered.splice(from, 1)
  reordered.splice(to, 0, moved)

  const before: string | null = reordered[to - 1]?.position ?? null
  let after: string | null = reordered[to + 1]?.position ?? null
  if (
    before !== null &&
    after !== null &&
    comparePositions(before, after) >= 0
  ) {
    // Neighbours share a key (e.g. two stops added at once by different
    // people), so nothing fits between them. Go just after the run of equal
    // keys instead; only the moved stop's row is ever written.
    after =
      reordered
        .slice(to + 1)
        .map((s) => s.position)
        .find((p) => comparePositions(p, before) > 0) ?? null
  }
  return positionBetween(before, after)
}

export type SavePosition = (
  stopId: string,
  position: string,
) => Promise<{ data: Stop | null; error: { message: string } | null }>

/**
 * Move `stop` to `position`: update local state at once, then save. If the
 * save fails, restore the stop (unless `isLatest` says a newer move of the
 * same stop has happened since) and return the error message.
 */
export async function moveStop(
  stop: Stop,
  position: string,
  {
    dispatch,
    save,
    isLatest,
  }: {
    dispatch: Dispatch<TripAction>
    save: SavePosition
    isLatest: () => boolean
  },
): Promise<string | null> {
  // Same updated_at as the current row, so it isn't treated as stale; a
  // newer version from realtime still wins over it.
  dispatch({ type: 'upsertStop', stop: { ...stop, position } })

  let result: Awaited<ReturnType<SavePosition>>
  try {
    result = await save(stop.id, position)
  } catch (e) {
    result = {
      data: null,
      error: { message: e instanceof Error ? e.message : String(e) },
    }
  }

  if (result.error || !result.data) {
    // The original row is older than anything saved since, so this can't
    // overwrite someone else's newer change.
    if (isLatest()) dispatch({ type: 'upsertStop', stop })
    return result.error?.message ?? 'The stop could not be found.'
  }
  dispatch({ type: 'upsertStop', stop: result.data })
  return null
}

/** Screen-reader announcements for dragging stop `name` among `count`. */
export const reorderAnnouncements = {
  start: (name: string, index: number, count: number) =>
    `Picked up ${name}, position ${index + 1} of ${count}.`,
  over: (name: string, index: number | null, count: number) =>
    index === null
      ? `${name} is not over a position.`
      : `${name} moved to position ${index + 1} of ${count}.`,
  end: (name: string, index: number | null, count: number) =>
    index === null
      ? `${name} dropped. Its position didn't change.`
      : `${name} dropped at position ${index + 1} of ${count}.`,
  cancel: (name: string) =>
    `Reordering cancelled. ${name} returned to its place.`,
}
