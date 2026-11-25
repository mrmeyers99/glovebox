import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import { initialTripState, tripReducer, type TripAction } from './tripState'

/**
 * The single source of trip state on the trip page: the trip, its days and
 * stops, and the signed-in user's role. Use `dispatch` to apply local edits
 * or realtime changes without refetching; changes dispatched while loading
 * are applied once the data arrives.
 *
 * `days` and `stops` are unordered. Order them with `orderTrip` (or
 * `comparePositions`), never `localeCompare`.
 */
export function useTrip(tripId: string | undefined) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [state, dispatch] = useReducer(tripReducer, initialTripState)
  // Ignore responses from a load that's been superseded.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    dispatch({ type: 'loading' })
    if (!tripId || !userId) {
      dispatch({ type: 'notFound' })
      return
    }

    const [trip, days, stops, member] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).maybeSingle(),
      supabase.from('days').select('*').eq('trip_id', tripId),
      supabase.from('stops').select('*').eq('trip_id', tripId),
      supabase
        .from('trip_members')
        .select('role')
        .eq('trip_id', tripId)
        .eq('user_id', userId)
        .maybeSingle(),
    ])
    if (id !== requestId.current) return

    const error = trip.error ?? days.error ?? stops.error ?? member.error
    let action: TripAction
    if (error?.code === '22P02') {
      // Malformed trip id in the URL.
      action = { type: 'notFound' }
    } else if (error) {
      action = { type: 'failed', error: error.message }
    } else if (!trip.data || !member.data) {
      // Row-level security hides trips you're not a member of.
      action = { type: 'notFound' }
    } else {
      action = {
        type: 'loaded',
        data: {
          trip: trip.data,
          days: days.data ?? [],
          stops: stops.data ?? [],
          role: member.data.role,
        },
      }
    }
    dispatch(action)
  }, [tripId, userId])

  useEffect(() => {
    const requests = requestId
    load()
    return () => {
      // Drop the in-flight response when the trip changes or we unmount.
      requests.current++
    }
  }, [load])

  const ready = state.status === 'ready' ? state : null
  const role = ready?.role ?? null
  return {
    trip: ready?.trip ?? null,
    days: ready?.days ?? [],
    stops: ready?.stops ?? [],
    role,
    canEdit: role === 'owner' || role === 'editor',
    loading: state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
    notFound: state.status === 'notFound',
    reload: load,
    dispatch,
  }
}
