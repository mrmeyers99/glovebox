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
  // Patches that arrive while loading are buffered and replayed on load.
  | { status: 'loading'; pending: TripPatch[] }
  | { status: 'error'; error: string }
  | { status: 'notFound' }
  | ({ status: 'ready' } & TripData)

/** Changes from local edits or realtime events. */
export type TripPatch =
  | { type: 'updateTrip'; trip: Partial<Trip> }
  | { type: 'upsertDay'; day: Day }
  | { type: 'removeDay'; id: string }
  | { type: 'upsertStop'; stop: Stop }
  | { type: 'removeStop'; id: string }

export type TripAction =
  | { type: 'loading' }
  | { type: 'loaded'; data: TripData }
  | { type: 'failed'; error: string }
  | { type: 'notFound' }
  | TripPatch

export const initialTripState: TripState = { status: 'loading', pending: [] }

type Versioned = { id: string; updated_at: string }

/** True if `incoming` is an older version than `existing` (e.g. a late event). */
function isStale(incoming: { updated_at?: string }, existing: Versioned) {
  if (incoming.updated_at === undefined) return false
  return Date.parse(incoming.updated_at) < Date.parse(existing.updated_at)
}

function upsert<T extends Versioned>(rows: T[], row: T): T[] {
  const index = rows.findIndex((r) => r.id === row.id)
  if (index === -1) return [...rows, row]
  if (isStale(row, rows[index])) return rows
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
      return { status: 'loading', pending: [] }
    case 'loaded':
      // Stale checks make replaying safe if the snapshot already has a change.
      return state.status === 'loading'
        ? state.pending.reduce<TripState>(applyPatch, {
            status: 'ready',
            ...action.data,
          })
        : { status: 'ready', ...action.data }
    case 'failed':
      return { status: 'error', error: action.error }
    case 'notFound':
      return { status: 'notFound' }
  }

  if (state.status === 'loading') {
    return { ...state, pending: [...state.pending, action] }
  }
  return applyPatch(state, action)
}

function applyPatch(state: TripState, action: TripPatch): TripState {
  if (state.status !== 'ready') return state

  switch (action.type) {
    case 'updateTrip':
      if (isStale(action.trip, state.trip)) return state
      return { ...state, trip: { ...state.trip, ...action.trip } }
    case 'upsertDay': {
      if (action.day.trip_id !== state.trip.id) return state
      const days = upsert(state.days, action.day)
      return days === state.days ? state : { ...state, days }
    }
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
    case 'upsertStop': {
      if (action.stop.trip_id !== state.trip.id) return state
      const stops = upsert(state.stops, action.stop)
      return stops === state.stops ? state : { ...state, stops }
    }
    case 'removeStop': {
      const stops = remove(state.stops, action.id)
      return stops === state.stops ? state : { ...state, stops }
    }
  }
}
