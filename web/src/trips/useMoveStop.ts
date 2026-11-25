import { useCallback, useRef, useState, type Dispatch } from 'react'
import type { Day, Stop } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import {
  applyMove,
  planMove,
  type DeleteDay,
  type InsertDay,
  type Placement,
  type SaveStopChanges,
} from './moveStops'
import type { TripAction } from './tripState'

// Writes only the changed stops' day, position and kind, in one transaction
// (updated_by/updated_at are set by triggers).
const saveChanges: SaveStopChanges = async (changes) =>
  supabase.rpc('move_stops', { p_moves: changes })

const insertDay: InsertDay = async (day) =>
  supabase.from('days').insert(day).select().single()

const deleteDay: DeleteDay = async (dayId) =>
  supabase.from('days').delete().eq('id', dayId)

/**
 * Move a stop to a new day and/or position, optimistically. `error` is the
 * last failed move's message, cleared by the next move or `clearError`.
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
      setError(null)
      const plan = planMove(days, stops, stop, placement, crypto.randomUUID())
      if (!plan) return
      if ('error' in plan) {
        setError(`Couldn't move ${stop.name}: ${plan.error}`)
        return
      }

      const id = ++counter.current
      // A move can change other stops too (the start or end handing over).
      const moving = plan.changes.map((c) => c.id)
      for (const stopId of moving) latest.current.set(stopId, id)
      const isLatest = (stopId: string) => latest.current.get(stopId) === id

      const message = await applyMove(plan, {
        stops,
        dispatch,
        insertDay,
        deleteDay,
        save: saveChanges,
        isLatest,
      })

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
