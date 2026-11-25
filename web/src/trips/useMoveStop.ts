import { useCallback, useRef, useState, type Dispatch } from 'react'
import type { Day, Stop } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import {
  moveStop,
  moveToNewDay,
  type DeleteDay,
  type InsertDay,
  type Placement,
  type SaveStopMove,
} from './moveStops'
import type { TripAction } from './tripState'

// Writes only the moved stop's day and position (updated_by/updated_at are
// set by triggers).
const saveMove: SaveStopMove = async (stopId, move) =>
  supabase.from('stops').update(move).eq('id', stopId).select().maybeSingle()

const insertDay: InsertDay = async (day) =>
  supabase.from('days').insert(day).select().single()

const deleteDay: DeleteDay = async (dayId) =>
  supabase.from('days').delete().eq('id', dayId)

/**
 * Move a stop to a new day and/or position, optimistically. `error` is the
 * last failed save's message, cleared by the next move or `clearError`.
 */
export function useMoveStop(
  dispatch: Dispatch<TripAction>,
  days: Day[],
  stops: Stop[],
) {
  const [error, setError] = useState<string | null>(null)
  // The latest move of each stop, so a slow failure doesn't undo a later move.
  const latest = useRef(new Map<string, number>())
  const counter = useRef(0)

  const move = useCallback(
    async (stop: Stop, placement: Placement) => {
      const id = ++counter.current
      // A new day can bring the end stop along, so it's moving too.
      const moving =
        placement.type === 'newDay'
          ? [stop.id, ...stops.filter((s) => s.kind === 'end').map((s) => s.id)]
          : [stop.id]
      for (const stopId of moving) latest.current.set(stopId, id)
      const isLatest = (stopId: string) => latest.current.get(stopId) === id
      setError(null)

      const message =
        placement.type === 'newDay'
          ? await moveToNewDay(stop, {
              days,
              stops,
              newDayId: crypto.randomUUID(),
              dispatch,
              insertDay,
              deleteDay,
              save: saveMove,
              isLatest,
            })
          : await moveStop(
              stop,
              placement.dayId === stop.day_id
                ? { position: placement.position }
                : { day_id: placement.dayId, position: placement.position },
              { dispatch, save: saveMove, isLatest: () => isLatest(stop.id) },
            )

      for (const stopId of moving) {
        if (isLatest(stopId)) latest.current.delete(stopId)
      }
      if (message) setError(`Couldn't move ${stop.name}: ${message}`)
    },
    [dispatch, days, stops],
  )

  const clearError = useCallback(() => setError(null), [])
  return { move, error, clearError }
}
