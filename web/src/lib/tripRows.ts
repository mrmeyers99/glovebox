// Map database rows to the inputs tripMath.ts works on.

import type { Day, Stop } from './database.types'
import type { DayInput, StopInput } from './tripMath'

export function toDayInput(day: Day): DayInput {
  return { id: day.id, position: day.position }
}

export function toStopInput(stop: Stop): StopInput {
  return {
    id: stop.id,
    dayId: stop.day_id,
    position: stop.position,
    kind: stop.kind,
    skipped: stop.skipped,
    // Postgres numeric can arrive as a string; normalize to numbers.
    lat: Number(stop.lat),
    lng: Number(stop.lng),
    costAmount: stop.cost_amount == null ? null : Number(stop.cost_amount),
    costCategory: stop.cost_category,
  }
}
