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
  place_id: null,
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
    expect(ready()).toEqual({
      status: 'ready',
      removedIds: new Set(),
      refreshing: null,
      ...data,
    })
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
      removedIds: new Set(),
      refreshing: null,
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

  it('removes a stop', () => {
    const state = tripReducer(ready(), { type: 'removeStop', id: 's2' })
    expect(state.status === 'ready' && state.stops.map((s) => s.id)).toEqual([
      's1',
      's3',
    ])
  })

  it("doesn't bring back a removed stop on a late upsert", () => {
    let state = tripReducer(ready(), { type: 'removeStop', id: 's2' })
    state = tripReducer(state, {
      type: 'upsertStop',
      stop: makeStop('s2', 'd2', 'Late edit'),
    })
    expect(state.status === 'ready' && state.stops.map((s) => s.id)).toEqual([
      's1',
      's3',
    ])
  })

  it('remembers a removal even if the row was already gone', () => {
    // E.g. the delete was buffered and the snapshot already excluded it.
    let state = tripReducer(ready(), { type: 'removeStop', id: 's9' })
    state = tripReducer(state, {
      type: 'upsertStop',
      stop: makeStop('s9', 'd1'),
    })
    expect(state.status === 'ready' && state.stops.map((s) => s.id)).toEqual([
      's1',
      's2',
      's3',
    ])
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

  it("doesn't bring back a removed day or its stops on a late upsert", () => {
    let state = tripReducer(ready(), { type: 'removeDay', id: 'd2' })
    state = tripReducer(state, { type: 'upsertDay', day: makeDay('d2', 'a1') })
    state = tripReducer(state, {
      type: 'upsertStop',
      stop: makeStop('s2', 'd2'),
    })
    // A stop the client never saw, on the removed day.
    state = tripReducer(state, {
      type: 'upsertStop',
      stop: makeStop('s8', 'd2'),
    })
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

  it('ignores removals of ids it does not have when asked', () => {
    const start = ready()
    expect(
      tripReducer(start, { type: 'removeStop', id: 'x', ifPresent: true }),
    ).toBe(start)
    expect(
      tripReducer(start, { type: 'removeDay', id: 'y', ifPresent: true }),
    ).toBe(start)
    const removed = tripReducer(start, {
      type: 'removeStop',
      id: 's2',
      ifPresent: true,
    })
    if (removed.status !== 'ready') throw new Error('not ready')
    expect(removed.stops.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(removed.removedIds).toEqual(new Set(['s2']))
  })

  it('checks ifPresent removals buffered while loading on replay', () => {
    let state: TripState = tripReducer(initialTripState, {
      type: 'removeStop',
      id: 's2',
      ifPresent: true,
    })
    state = tripReducer(state, { type: 'removeStop', id: 'x', ifPresent: true })
    state = tripReducer(state, { type: 'loaded', data })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.stops.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(state.removedIds).toEqual(new Set(['s2']))
  })
})

describe('tripReducer refresh', () => {
  it('keeps showing data while refreshing and replays patches onto the snapshot', () => {
    let state = tripReducer(ready(), { type: 'refreshing' })
    expect(state).toMatchObject({ status: 'ready', refreshing: [] })

    // Applied right away, and remembered for the snapshot.
    state = tripReducer(state, {
      type: 'upsertStop',
      stop: makeStop('s9', 'd1'),
    })
    state = tripReducer(state, { type: 'removeStop', id: 's1' })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.stops.map((s) => s.id)).toEqual(['s2', 's3', 's9'])

    // The snapshot was taken before those changes and has a remote edit.
    state = tripReducer(state, {
      type: 'loaded',
      data: {
        ...data,
        days: [makeDay('d1', 'a0')],
        stops: [makeStop('s1', 'd1')],
      },
    })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.refreshing).toBeNull()
    expect(state.days.map((d) => d.id)).toEqual(['d1'])
    expect(state.stops.map((s) => s.id)).toEqual(['s9'])
  })

  it('stops buffering once loaded', () => {
    let state = tripReducer(ready(), { type: 'refreshing' })
    state = tripReducer(state, { type: 'loaded', data })
    state = tripReducer(state, { type: 'removeStop', id: 's1' })
    expect(state.status === 'ready' && state.refreshing).toBeNull()
  })

  it('keeps buffered patches if a refresh is superseded by another', () => {
    let state = tripReducer(ready(), { type: 'refreshing' })
    state = tripReducer(state, { type: 'removeStop', id: 's1' })
    state = tripReducer(state, { type: 'refreshing' })
    state = tripReducer(state, { type: 'loaded', data })
    expect(state.status === 'ready' && state.stops.map((s) => s.id)).toEqual([
      's2',
      's3',
    ])
  })

  it('keeps the current data if a refresh fails', () => {
    let state = tripReducer(ready(), { type: 'refreshing' })
    state = tripReducer(state, { type: 'removeStop', id: 's1' })
    state = tripReducer(state, { type: 'refreshFailed', error: 'offline' })
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.refreshing).toBeNull()
    expect(state.stops.map((s) => s.id)).toEqual(['s2', 's3'])
  })

  it('shows the error if a refresh replaced the first load and failed', () => {
    let state = tripReducer(initialTripState, { type: 'refreshing' })
    expect(state).toBe(initialTripState)
    state = tripReducer(state, { type: 'refreshFailed', error: 'offline' })
    expect(state).toEqual({ status: 'error', error: 'offline' })
  })

  it('replays patches buffered during the first load when a refresh finishes it', () => {
    let state = tripReducer(initialTripState, { type: 'refreshing' })
    state = tripReducer(state, { type: 'removeStop', id: 's1' })
    state = tripReducer(state, { type: 'loaded', data })
    expect(state.status === 'ready' && state.stops.map((s) => s.id)).toEqual([
      's2',
      's3',
    ])
  })

  it('recovers from an error or not found when a refresh succeeds', () => {
    const failed = tripReducer(initialTripState, { type: 'failed', error: 'x' })
    expect(tripReducer(failed, { type: 'refreshing' })).toBe(failed)
    expect(tripReducer(failed, { type: 'loaded', data }).status).toBe('ready')
  })
})
