// The trip's start and end stops: the start lives on the first day and the
// end on the last day. When days are added or removed, the end stop follows
// the last day.

import type { Day, Stop } from '../lib/database.types'
import { positionAtEnd } from '../lib/positions'
import { comparePositions } from '../lib/tripMath'

type Positioned = Pick<Day, 'id' | 'position'>

/** The last day in order, or undefined if there are none. */
export function lastDay<D extends Positioned>(days: D[]): D | undefined {
  // A stable sort, like orderTrip, so ties resolve the same way.
  return [...days]
    .sort((a, b) => comparePositions(a.position, b.position))
    .at(-1)
}

/**
 * Where to move the trip's end stop so it's on the last day, or null if it
 * already is (or there's no end stop or no day). It goes after the last
 * day's other stops; it's listed last whatever its key, but keeping the key
 * last too means nothing depends on that.
 */
export function endStopPlacement<
  S extends Pick<Stop, 'id' | 'kind' | 'day_id' | 'position'>,
>(
  days: Positioned[],
  stops: S[],
): { stop: S; dayId: string; position: string } | null {
  const end = stops.find((s) => s.kind === 'end')
  const last = lastDay(days)
  if (!end || !last || end.day_id === last.id) return null
  return {
    stop: end,
    dayId: last.id,
    position: positionAtEnd(
      stops.filter((s) => s.day_id === last.id).map((s) => s.position),
    ),
  }
}
