// Skipping and unskipping a stop: an optimistic update of `skipped` alone,
// rolled back if the save fails.

import type { Dispatch } from 'react'
import type { Stop } from '../lib/database.types'
import type { TripAction } from './tripState'

export type SaveSkipped = (
  stopId: string,
  skipped: boolean,
) => Promise<{ data: Stop | null; error: { message: string } | null }>

/**
 * Skip or unskip `stop`: update local state at once, then save only
 * `skipped`, so it can't overwrite anyone's other changes to the stop. If the
 * save fails, restore the stop (unless `isLatest` says it has changed again
 * since) and return the error message.
 */
export async function setStopSkipped(
  stop: Stop,
  skipped: boolean,
  {
    dispatch,
    save,
    isLatest,
  }: {
    dispatch: Dispatch<TripAction>
    save: SaveSkipped
    isLatest: () => boolean
  },
): Promise<string | null> {
  // Same updated_at as the current row, so it isn't treated as stale; a
  // newer version from realtime still wins over it.
  dispatch({ type: 'upsertStop', stop: { ...stop, skipped } })

  let result: Awaited<ReturnType<SaveSkipped>>
  try {
    result = await save(stop.id, skipped)
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
