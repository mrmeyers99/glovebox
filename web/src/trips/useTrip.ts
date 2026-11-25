import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useAuth } from '../auth/useAuth'
import type { Day, Stop, Trip } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { changeToAction, type TripChange } from './realtime'
import { initialTripState, tripReducer, type TripAction } from './tripState'

/**
 * The single source of trip state on the trip page: the trip, its days and
 * stops, and the signed-in user's role. Use `dispatch` to apply local edits
 * without refetching; changes dispatched while loading are applied once the
 * data arrives.
 *
 * Changes by other editors arrive through Supabase Realtime and go through
 * the same actions. Each time the channel (re)subscribes, e.g. after a laptop
 * wakes from sleep, the trip is refetched in the background to catch up on
 * anything missed while disconnected.
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

  /**
   * Fetch the trip. 'load' shows the loading state; 'refresh' keeps the
   * current data on screen and keeps it if the fetch fails.
   */
  const fetchTrip = useCallback(
    async (mode: 'load' | 'refresh') => {
      const id = ++requestId.current
      dispatch({ type: mode === 'load' ? 'loading' : 'refreshing' })
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
        action =
          mode === 'refresh'
            ? { type: 'refreshFailed', error: error.message }
            : { type: 'failed', error: error.message }
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
    },
    [tripId, userId],
  )

  const load = useCallback(() => fetchTrip('load'), [fetchTrip])

  useEffect(() => {
    const requests = requestId
    load()
    return () => {
      // Drop the in-flight response when the trip changes or we unmount.
      requests.current++
    }
  }, [load])

  useEffect(() => {
    if (!tripId || !userId) return
    const onChange = (change: TripChange) => {
      const action = changeToAction(change, tripId)
      if (action) dispatch(action)
    }
    const schema = 'public'
    const byTrip = `trip_id=eq.${tripId}`
    // INSERT and UPDATE are filtered by Realtime (which also applies RLS).
    // DELETE can't be filtered, so changeToAction filters it; see realtime.ts.
    // A unique topic: supabase.channel() reuses a channel with the same
    // topic, which could be one still being removed (e.g. StrictMode).
    const channel = supabase
      .channel(`trip:${tripId}:${crypto.randomUUID()}`)
      .on<Trip>(
        'postgres_changes',
        { event: 'UPDATE', schema, table: 'trips', filter: `id=eq.${tripId}` },
        (payload) => onChange({ ...payload, table: 'trips' }),
      )
      .on<Trip>(
        'postgres_changes',
        { event: 'DELETE', schema, table: 'trips' },
        (payload) => onChange({ ...payload, table: 'trips' }),
      )
    for (const event of ['INSERT', 'UPDATE'] as const) {
      channel
        .on<Day>(
          'postgres_changes',
          { event, schema, table: 'days', filter: byTrip },
          (payload) => onChange({ ...payload, table: 'days' }),
        )
        .on<Stop>(
          'postgres_changes',
          { event, schema, table: 'stops', filter: byTrip },
          (payload) => onChange({ ...payload, table: 'stops' }),
        )
    }
    channel
      .on<Day>(
        'postgres_changes',
        { event: 'DELETE', schema, table: 'days' },
        (payload) => onChange({ ...payload, table: 'days' }),
      )
      .on<Stop>(
        'postgres_changes',
        { event: 'DELETE', schema, table: 'stops' },
        (payload) => onChange({ ...payload, table: 'stops' }),
      )
      .subscribe((status) => {
        // Fires on the first join and again on every rejoin after the
        // connection drops. Events from before the join were missed (the
        // first load may also have raced the join), so refetch to catch up;
        // events arriving meanwhile are replayed onto the fresh data.
        if (status === 'SUBSCRIBED') fetchTrip('refresh')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId, userId, fetchTrip])

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
