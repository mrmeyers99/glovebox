import { describe, expect, it } from 'vitest'
import type { Day, Stop, Trip } from '../lib/database.types'
import {
  initialTripState,
  tripReducer,
  type TripData,
  type TripState,
} from './tripState'

const trip: Trip = {
  id: 't1',
  owner_id: 'u1',
  name: 'Road trip',
  start_date: null,
  mpg: 25,
  gas_price_per_gallon: null,
  created_at: '',
  updated_at: '',
}

const makeDay = (id: string, position: string): Day => ({
  id,
  trip_id: 't1',
  position,
  notes: null,
  created_at: '',
  updated_at: '',
})

const makeStop = (id: string, dayId: string, name = id): Stop => ({
  id,
  trip_id: 't1',
  day_id: dayId,
  position: 'a0',
  kind: 'waypoint',
  name,
  lat: 0,
  lng: 0,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  created_at: '',
  updated_at: '',
  updated_by: null,
})

const data: TripData = {
  trip,
  days: [makeDay('d1', 'a0'), makeDay('d2', 'a1')],
  stops: [makeStop('s1', 'd1'), makeStop('s2', 'd2'), makeStop('s3', 'd2')],
  role: 'editor',
}

function ready(): Extract<TripState, { status: 'ready' }> {
  const state = tripReducer(initialTripState, { type: 'loaded', data })
  if (state.status !== 'ready') throw new Error('not ready')
  return state
}

describe('tripReducer', () => {
  it('moves through loading, error, not found and loaded', () => {
    expect(initialTripState).toEqual({ status: 'loading', pending: [] })
    expect(
      tripReducer(initialTripState, { type: 'failed', error: 'boom' }),
    ).toEqual({ status: 'error', error: 'boom' })
    expect(tripReducer(initialTripState, { type: 'notFound' })).toEqual({
      status: 'notFound',
    })
    expect(ready()).toEqual({ status: 'ready', ...data })
    expect(tripReducer(ready(), { type: 'loading' })).toEqual({
      status: 'loading',
      pending: [],
    })
  })

  it('replays patches that arrive while loading', () => {
    let state: TripState = tripReducer(initialTripState, {
      type: 'upsertStop',
      stop: makeStop('s9', 'd1'),
    })
    state = tripReducer(state, { type: 'removeStop', id: 's2' })
    state = tripReducer(state, { type: 'loaded', data })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.stops.map((s) => s.id)).toEqual(['s1', 's3', 's9'])
  })

  it('drops buffered patches on reload, error or not found', () => {
    const buffered = tripReducer(initialTripState, {
      type: 'removeStop',
      id: 's1',
    })
    expect(tripReducer(buffered, { type: 'loading' })).toEqual(initialTripState)
    expect(tripReducer(buffered, { type: 'notFound' })).toEqual({
      status: 'notFound',
    })
    const failed = tripReducer(buffered, { type: 'failed', error: 'x' })
    expect(tripReducer(failed, { type: 'removeStop', id: 's1' })).toBe(failed)
  })

  it('ignores rows older than the ones it has', () => {
    const at = (time: string) => `2026-11-25T${time}:00+00:00`
    const stop = { ...makeStop('s1', 'd1', 'New'), updated_at: at('10:00') }
    const day = {
      ...makeDay('d1', 'a0'),
      notes: 'New',
      updated_at: at('10:00'),
    }
    const start: TripState = {
      status: 'ready',
      ...data,
      trip: { ...trip, name: 'New', updated_at: at('10:00') },
      days: [day],
      stops: [stop],
    }
    const late = at('09:00')
    expect(
      tripReducer(start, {
        type: 'upsertStop',
        stop: { ...stop, name: 'Old', updated_at: late },
      }),
    ).toBe(start)
    expect(
      tripReducer(start, {
        type: 'upsertDay',
        day: { ...day, notes: 'Old', updated_at: late },
      }),
    ).toBe(start)
    expect(
      tripReducer(start, {
        type: 'updateTrip',
        trip: { name: 'Old', updated_at: late },
      }),
    ).toBe(start)

    // Same or newer versions still apply.
    const newer = tripReducer(start, {
      type: 'upsertStop',
      stop: { ...stop, name: 'Newer', updated_at: at('11:00') },
    })
    expect(newer.status === 'ready' && newer.stops[0].name).toBe('Newer')
    const same = tripReducer(start, {
      type: 'upsertStop',
      stop: { ...stop, name: 'Same' },
    })
    expect(same.status === 'ready' && same.stops[0].name).toBe('Same')
  })

  it('updates trip fields', () => {
    const state = tripReducer(ready(), {
      type: 'updateTrip',
      trip: { name: 'Renamed', mpg: 30 },
    })
    expect(state.status === 'ready' && state.trip).toEqual({
      ...trip,
      name: 'Renamed',
      mpg: 30,
    })
  })

  it('inserts and replaces stops by id', () => {
    let state: TripState = tripReducer(ready(), {
      type: 'upsertStop',
      stop: makeStop('s4', 'd1'),
    })
    state = tripReducer(state, {
      type: 'upsertStop',
      stop: makeStop('s1', 'd2', 'Moved'),
    })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.stops.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(state.stops[0]).toMatchObject({ day_id: 'd2', name: 'Moved' })
  })

  it('removes a stop, and is a no-op for unknown ids', () => {
    const start = ready()
    const state = tripReducer(start, { type: 'removeStop', id: 's2' })
    expect(state.status === 'ready' && state.stops.map((s) => s.id)).toEqual([
      's1',
      's3',
    ])
    expect(tripReducer(start, { type: 'removeStop', id: 'nope' })).toBe(start)
  })

  it('inserts and replaces days by id', () => {
    let state: TripState = tripReducer(ready(), {
      type: 'upsertDay',
      day: makeDay('d3', 'a2'),
    })
    state = tripReducer(state, {
      type: 'upsertDay',
      day: { ...makeDay('d1', 'a0'), notes: 'Hi' },
    })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.days.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(state.days[0].notes).toBe('Hi')
  })

  it('removes a day along with its stops', () => {
    const state = tripReducer(ready(), { type: 'removeDay', id: 'd2' })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.days.map((d) => d.id)).toEqual(['d1'])
    expect(state.stops.map((s) => s.id)).toEqual(['s1'])
  })

  it('ignores rows that belong to another trip', () => {
    const start = ready()
    const otherStop = { ...makeStop('x', 'd1'), trip_id: 't2' }
    const otherDay = { ...makeDay('y', 'a5'), trip_id: 't2' }
    expect(tripReducer(start, { type: 'upsertStop', stop: otherStop })).toBe(
      start,
    )
    expect(tripReducer(start, { type: 'upsertDay', day: otherDay })).toBe(start)
  })
})
