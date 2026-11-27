// Adding a suggested place to the trip: which day and where in it the new
// stop goes by default, and which suggestions are already in the trip. Pure,
// so it can be tested without a map.

import { distanceFromRoute, legLines, type LatLng } from '../lib/corridor'
import type { Day, Stop } from '../lib/database.types'
import { positionBetween } from '../lib/positions'
import { comparePositions, type Leg } from '../lib/tripMath'
import { newStopPosition } from './addStop'
import { numberedDays } from './mapAdd'

/** Where a suggested place goes in the trip by default. */
export interface SuggestedPlacement {
  dayId: string
  dayNumber: number
  /**
   * The stop the new one goes just before: the one the closest leg arrives
   * at. Null to add it at the end of the day.
   */
  beforeStopId: string | null
}

/**
 * The default spot for a place at `point`: on the leg that passes closest
 * to it, just before the stop that leg arrives at, on that stop's day (a leg
 * counts toward the day of the stop it arrives at). Legs join active stops
 * only, so the place never lands next to a skipped stop's leg. Without any
 * legs, the end of the last day. Null if the trip has no days.
 */
export function suggestedPlacement(
  days: readonly Pick<Day, 'id' | 'position'>[],
  legs: readonly Leg[],
  point: LatLng,
): SuggestedPlacement | null {
  const numbered = numberedDays(days)
  const lines = legLines([...legs])
  let leg: Leg | undefined
  let closest = Infinity
  for (let i = 0; i < legs.length; i++) {
    const distance = distanceFromRoute(point, [lines[i]])
    // Ties go to the earlier leg.
    if (distance < closest) {
      closest = distance
      leg = legs[i]
    }
  }
  const day = leg && numbered.find((d) => d.dayId === leg.to.dayId)
  if (leg && day) return { ...day, beforeStopId: leg.to.id }
  const last = numbered.at(-1)
  return last ? { ...last, beforeStopId: null } : null
}

/** Rank of a stop within its day: start first, end last, as listed. */
const kindRank = (stop: Pick<Stop, 'kind'>) =>
  stop.kind === 'start' ? 0 : stop.kind === 'end' ? 2 : 1

/**
 * A position key for a new waypoint just before stop `beforeStopId` in a
 * day whose stops are `dayStops`, after whatever stop precedes it (skipped
 * or not). If that stop is no longer on the day (a collaborator moved or
 * deleted it), or it's the day's start stop, the end of the day instead.
 */
export function positionBeforeStop(
  dayStops: readonly Pick<Stop, 'id' | 'kind' | 'position'>[],
  beforeStopId: string | null,
): string {
  const ordered = [...dayStops].sort(
    (a, b) =>
      kindRank(a) - kindRank(b) || comparePositions(a.position, b.position),
  )
  const index = ordered.findIndex((s) => s.id === beforeStopId)
  const before = ordered[index]
  if (!before || before.kind === 'start') return newStopPosition([...dayStops])
  const after = ordered[index - 1]?.position ?? null
  // Keys out of order (the end stop sorts last whatever its key): fall back.
  if (after !== null && comparePositions(after, before.position) >= 0)
    return newStopPosition([...dayStops])
  return positionBetween(after, before.position)
}

/** Ids of the places the trip's stops were added from. */
export function placesInTrip(
  stops: readonly Pick<Stop, 'place_id'>[],
): Set<number> {
  const ids = new Set<number>()
  for (const stop of stops) if (stop.place_id != null) ids.add(stop.place_id)
  return ids
}
