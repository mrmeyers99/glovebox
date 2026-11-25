// Turns Supabase Realtime Postgres change events into trip state actions.
//
// Why DELETE events are filtered here rather than by Realtime: Realtime can't
// filter DELETE events by column, and for tables with row-level security the
// `old` record of a DELETE holds only the primary key, even with replica
// identity full (Postgres can't check access to a row that's gone, so
// Realtime sends the bare id to every subscriber of the table). So we
// subscribe to DELETEs on `days` and `stops` without a filter, and only
// remove ids this trip actually has (`ifPresent`). A DELETE leaks nothing
// beyond a random UUID.

import type { Day, Stop, Trip } from '../lib/database.types'
import type { TripAction } from './tripState'

export type ChangeEvent<Row> =
  | { eventType: 'INSERT' | 'UPDATE'; new: Row; old: Partial<Row> }
  | { eventType: 'DELETE'; new: Partial<Row>; old: Partial<Row> }

export type TripChange =
  | ({ table: 'trips' } & ChangeEvent<Trip>)
  | ({ table: 'days' } & ChangeEvent<Day>)
  | ({ table: 'stops' } & ChangeEvent<Stop>)

/** The action for a change event, or null if it isn't about this trip. */
export function changeToAction(
  change: TripChange,
  tripId: string,
): TripAction | null {
  if (change.eventType === 'DELETE') {
    const { id } = change.old
    if (!id) return null
    if (change.table === 'trips') {
      // Deleted by its owner (or cascaded); nothing left to show.
      return id === tripId ? { type: 'notFound' } : null
    }
    // Usually absent (see above), but use it when Realtime sends it.
    const ownTrip = change.old.trip_id
    if (ownTrip !== undefined && ownTrip !== tripId) return null
    return change.table === 'days'
      ? { type: 'removeDay', id, ifPresent: true }
      : { type: 'removeStop', id, ifPresent: true }
  }

  switch (change.table) {
    case 'trips':
      return change.new.id === tripId
        ? { type: 'updateTrip', trip: change.new }
        : null
    case 'days':
      return change.new.trip_id === tripId
        ? { type: 'upsertDay', day: change.new }
        : null
    case 'stops':
      return change.new.trip_id === tripId
        ? { type: 'upsertStop', stop: change.new }
        : null
  }
}
