import { useCallback, useRef, useState, type Dispatch } from 'react'
import type { Stop } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { moveStop, type SavePosition } from './reorderStops'
import type { TripAction } from './tripState'

// Writes only the moved stop's position (updated_by/updated_at are set by
// triggers).
const savePosition: SavePosition = async (stopId, position) =>
  supabase
    .from('stops')
    .update({ position })
    .eq('id', stopId)
    .select()
    .maybeSingle()

/**
 * Move a stop to a new position key, optimistically. `error` is the last
 * failed save's message, cleared by the next move or `clearError`.
 */
export function useReorderStop(dispatch: Dispatch<TripAction>) {
  const [error, setError] = useState<string | null>(null)
  // The latest move of each stop, so a slow failure doesn't undo a later move.
  const latest = useRef(new Map<string, number>())
  const counter = useRef(0)

  const move = useCallback(
    async (stop: Stop, position: string) => {
      const id = ++counter.current
      latest.current.set(stop.id, id)
      setError(null)
      const message = await moveStop(stop, position, {
        dispatch,
        save: savePosition,
        isLatest: () => latest.current.get(stop.id) === id,
      })
      if (latest.current.get(stop.id) === id) latest.current.delete(stop.id)
      if (message) setError(`Couldn't save the new order: ${message}`)
    },
    [dispatch],
  )

  const clearError = useCallback(() => setError(null), [])
  return { move, error, clearError }
}
