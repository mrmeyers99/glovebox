// Client-side trip state. Local edits and realtime updates patch it through
// these actions instead of refetching.

import type { Day, Stop, Trip, TripRole } from '../lib/database.types'

export type TripData = {
  trip: Trip
  days: Day[]
  stops: Stop[]
  role: TripRole
}

export type TripState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'notFound' }
  | ({ status: 'ready' } & TripData)

export type TripAction =
  | { type: 'loading' }
  | { type: 'loaded'; data: TripData }
  | { type: 'failed'; error: string }
  | { type: 'notFound' }
  | { type: 'updateTrip'; trip: Partial<Trip> }
  | { type: 'upsertDay'; day: Day }
  | { type: 'removeDay'; id: string }
  | { type: 'upsertStop'; stop: Stop }
  | { type: 'removeStop'; id: string }

export const initialTripState: TripState = { status: 'loading' }

function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  const index = rows.findIndex((r) => r.id === row.id)
  if (index === -1) return [...rows, row]
  const next = [...rows]
  next[index] = row
  return next
}

function remove<T extends { id: string }>(rows: T[], id: string): T[] {
  return rows.some((r) => r.id === id) ? rows.filter((r) => r.id !== id) : rows
}

export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case 'loading':
      return { status: 'loading' }
    case 'loaded':
      return { status: 'ready', ...action.data }
    case 'failed':
      return { status: 'error', error: action.error }
    case 'notFound':
      return { status: 'notFound' }
  }

  // Patches only apply once the trip is loaded.
  if (state.status !== 'ready') return state

  switch (action.type) {
    case 'updateTrip':
      return { ...state, trip: { ...state.trip, ...action.trip } }
    case 'upsertDay':
      if (action.day.trip_id !== state.trip.id) return state
      return { ...state, days: upsert(state.days, action.day) }
    case 'removeDay': {
      const days = remove(state.days, action.id)
      if (days === state.days) return state
      // Stops cascade-delete with their day.
      return {
        ...state,
        days,
        stops: state.stops.filter((s) => s.day_id !== action.id),
      }
    }
    case 'upsertStop':
      if (action.stop.trip_id !== state.trip.id) return state
      return { ...state, stops: upsert(state.stops, action.stop) }
    case 'removeStop': {
      const stops = remove(state.stops, action.id)
      return stops === state.stops ? state : { ...state, stops }
    }
  }
}
