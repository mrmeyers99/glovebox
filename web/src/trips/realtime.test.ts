import { describe, expect, it } from 'vitest'
import type { Day, Stop, Trip } from '../lib/database.types'
import { changeToAction } from './realtime'
import { initialTripState, tripReducer, type TripState } from './tripState'

const trip: Trip = {
  id: 't1',
  owner_id: 'u1',
  name: 'Road trip',
  start_date: null,
  mpg: 25,
  gas_price_per_gallon: null,
  created_at: '',
  updated_at: '2026-11-25T10:00:00+00:00',
}

const day: Day = {
  id: 'd1',
  trip_id: 't1',
  position: 'a0',
  notes: null,
  created_at: '',
  updated_at: '2026-11-25T10:00:00+00:00',
}

const stop: Stop = {
  id: 's1',
  trip_id: 't1',
  day_id: 'd1',
  position: 'a0',
  kind: 'waypoint',
  name: 'Diner',
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
  updated_at: '2026-11-25T10:00:00+00:00',
  place_id: null,
  updated_by: null,
}

describe('changeToAction', () => {
  it('maps inserts and updates to upserts', () => {
    expect(
      changeToAction(
        { table: 'stops', eventType: 'INSERT', new: stop, old: {} },
        't1',
      ),
    ).toEqual({ type: 'upsertStop', stop })
    expect(
      changeToAction(
        { table: 'days', eventType: 'UPDATE', new: day, old: day },
        't1',
      ),
    ).toEqual({ type: 'upsertDay', day })
    expect(
      changeToAction(
        { table: 'trips', eventType: 'UPDATE', new: trip, old: trip },
        't1',
      ),
    ).toEqual({ type: 'updateTrip', trip })
  })

  it('ignores inserts and updates for other trips', () => {
    const other = { ...stop, trip_id: 't2' }
    expect(
      changeToAction(
        { table: 'stops', eventType: 'INSERT', new: other, old: {} },
        't1',
      ),
    ).toBeNull()
    expect(
      changeToAction(
        {
          table: 'days',
          eventType: 'UPDATE',
          new: { ...day, trip_id: 't2' },
          old: {},
        },
        't1',
      ),
    ).toBeNull()
    expect(
      changeToAction(
        {
          table: 'trips',
          eventType: 'UPDATE',
          new: { ...trip, id: 't2' },
          old: {},
        },
        't1',
      ),
    ).toBeNull()
  })

  it('maps deletes with only an id to removals of known rows', () => {
    // With RLS, Realtime sends only the primary key of a deleted row.
    expect(
      changeToAction(
        { table: 'stops', eventType: 'DELETE', new: {}, old: { id: 's1' } },
        't1',
      ),
    ).toEqual({ type: 'removeStop', id: 's1', ifPresent: true })
    expect(
      changeToAction(
        { table: 'days', eventType: 'DELETE', new: {}, old: { id: 'd1' } },
        't1',
      ),
    ).toEqual({ type: 'removeDay', id: 'd1', ifPresent: true })
  })

  it('ignores deletes for other trips when the trip id is known', () => {
    expect(
      changeToAction(
        {
          table: 'stops',
          eventType: 'DELETE',
          new: {},
          old: { id: 's1', trip_id: 't2' },
        },
        't1',
      ),
    ).toBeNull()
    expect(
      changeToAction(
        { table: 'stops', eventType: 'DELETE', new: {}, old: {} },
        't1',
      ),
    ).toBeNull()
  })

  it('treats deleting the open trip as not found', () => {
    expect(
      changeToAction(
        { table: 'trips', eventType: 'DELETE', new: {}, old: { id: 't1' } },
        't1',
      ),
    ).toEqual({ type: 'notFound' })
    expect(
      changeToAction(
        { table: 'trips', eventType: 'DELETE', new: {}, old: { id: 't2' } },
        't1',
      ),
    ).toBeNull()
  })
})

describe('incoming events through the reducer', () => {
  function apply(
    state: TripState,
    ...changes: Parameters<typeof changeToAction>[0][]
  ) {
    for (const change of changes) {
      const action = changeToAction(change, 't1')
      if (action) state = tripReducer(state, action)
    }
    return state
  }

  const start = tripReducer(initialTripState, {
    type: 'loaded',
    data: { trip, days: [day], stops: [stop], role: 'editor' },
  })

  it("doesn't duplicate a stop when your own insert echoes back", () => {
    const added = { ...stop, id: 's2', name: 'Motel' }
    // Applied locally from the insert's response, then echoed by Realtime.
    let state = tripReducer(start, { type: 'upsertStop', stop: added })
    state = apply(state, {
      table: 'stops',
      eventType: 'INSERT',
      new: added,
      old: {},
    })
    expect(state.status === 'ready' && state.stops.map((s) => s.id)).toEqual([
      's1',
      's2',
    ])
  })

  it("doesn't let a late echo overwrite a newer local edit", () => {
    const first = {
      ...stop,
      name: 'First',
      updated_at: '2026-11-25T11:00:00+00:00',
    }
    const second = {
      ...stop,
      name: 'Second',
      updated_at: '2026-11-25T11:00:01.5+00:00',
    }
    let state = tripReducer(start, { type: 'upsertStop', stop: first })
    state = tripReducer(state, { type: 'upsertStop', stop: second })
    state = apply(
      state,
      { table: 'stops', eventType: 'UPDATE', new: first, old: stop },
      { table: 'stops', eventType: 'UPDATE', new: second, old: first },
    )
    expect(state.status === 'ready' && state.stops[0].name).toBe('Second')
  })

  it('applies moves, skips and deletes from another editor', () => {
    const d2 = { ...day, id: 'd2', position: 'a1' }
    const later = '2026-11-25T12:00:00+00:00'
    let state = apply(
      start,
      { table: 'days', eventType: 'INSERT', new: d2, old: {} },
      {
        table: 'stops',
        eventType: 'UPDATE',
        new: { ...stop, day_id: 'd2', skipped: true, updated_at: later },
        old: stop,
      },
      { table: 'days', eventType: 'DELETE', new: {}, old: { id: 'd1' } },
      // Someone else's trip.
      { table: 'stops', eventType: 'DELETE', new: {}, old: { id: 'zz' } },
    )
    if (state.status !== 'ready') throw new Error('not ready')
    expect(state.days.map((d) => d.id)).toEqual(['d2'])
    expect(state.stops).toEqual([
      { ...stop, day_id: 'd2', skipped: true, updated_at: later },
    ])
    expect(state.removedIds).toEqual(new Set(['d1']))

    state = apply(state, {
      table: 'stops',
      eventType: 'DELETE',
      new: {},
      old: { id: 's1' },
    })
    expect(state.status === 'ready' && state.stops).toEqual([])
  })
})
