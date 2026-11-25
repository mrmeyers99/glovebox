import { describe, expect, it } from 'vitest'
import type { Place } from '../lib/geocode'
import {
  firstDay,
  lastDay,
  missingTripEnds,
  parseTripEndForm,
  tripEndSaveError,
  tripEndSlot,
} from './tripEnds'

const days = [
  { id: 'd2', position: 'a1' },
  { id: 'd1', position: 'a0' },
  { id: 'd3', position: 'a2' },
]
const stop = (
  id: string,
  kind: 'start' | 'waypoint' | 'end',
  dayId: string,
  position: string,
) => ({
  id,
  kind,
  day_id: dayId,
  position,
})

describe('lastDay', () => {
  it('is the day with the greatest position, whatever the input order', () => {
    expect(lastDay(days)?.id).toBe('d3')
    expect(lastDay([])).toBeUndefined()
  })

  it('compares keys byte-wise', () => {
    // 'Zz' < 'a0' byte-wise, though localeCompare says otherwise.
    expect(
      lastDay([
        { id: 'lower', position: 'a0' },
        { id: 'upper', position: 'Zz' },
      ])?.id,
    ).toBe('lower')
  })
})

describe('firstDay', () => {
  it('is the day with the smallest position, whatever the input order', () => {
    expect(firstDay(days)?.id).toBe('d1')
    expect(firstDay([])).toBeUndefined()
  })
})

describe('tripEndSlot', () => {
  const stops = [
    stop('a', 'waypoint', 'd1', 'a3'),
    stop('b', 'waypoint', 'd1', 'a1'),
    stop('c', 'waypoint', 'd3', 'a5'),
  ]

  it('puts a new start on the first day, before its stops', () => {
    const slot = tripEndSlot('start', days, stops)
    expect(slot?.dayId).toBe('d1')
    expect(slot!.position < 'a1').toBe(true)
  })

  it('puts a new end on the last day, after its stops', () => {
    const slot = tripEndSlot('end', days, stops)
    expect(slot?.dayId).toBe('d3')
    expect(slot!.position > 'a5').toBe(true)
  })

  it('ignores the stop being placed', () => {
    // An existing start with a low key doesn't push the new key lower.
    expect(
      tripEndSlot('start', days, [stop('s', 'start', 'd1', 'Zz')]),
    ).toEqual({ dayId: 'd1', position: 'a0' })
  })

  it('uses a key that fits on an empty day', () => {
    expect(tripEndSlot('start', days, [])).toEqual({
      dayId: 'd1',
      position: 'a0',
    })
    expect(tripEndSlot('end', days, [])).toEqual({
      dayId: 'd3',
      position: 'a0',
    })
  })

  it('compares keys byte-wise', () => {
    // 'Zz' sorts before 'a0' byte-wise, so the start must go before 'Zz'.
    const slot = tripEndSlot('start', days, [
      stop('a', 'waypoint', 'd1', 'a0'),
      stop('b', 'waypoint', 'd1', 'Zz'),
    ])
    expect(slot!.position < 'Zz').toBe(true)
  })

  it('is null without days', () => {
    expect(tripEndSlot('start', [], [])).toBeNull()
    expect(tripEndSlot('end', [], [])).toBeNull()
  })
})

describe('missingTripEnds', () => {
  it('lists the ends the trip has no stop for', () => {
    expect(missingTripEnds([])).toEqual(new Set(['start', 'end']))
    expect(missingTripEnds([{ kind: 'waypoint' }, { kind: 'start' }])).toEqual(
      new Set(['end']),
    )
    expect(missingTripEnds([{ kind: 'end' }, { kind: 'start' }])).toEqual(
      new Set(),
    )
  })
})

describe('parseTripEndForm', () => {
  const denver: Place = {
    name: 'Denver',
    address: 'CO, USA',
    lat: 39.74,
    lng: -104.99,
  }

  it('returns the place and trimmed name', () => {
    expect(parseTripEndForm('  Home  ', denver)).toEqual({
      ok: true,
      fields: { name: 'Home', address: 'CO, USA', lat: 39.74, lng: -104.99 },
    })
  })

  it('requires a place and a name', () => {
    const result = parseTripEndForm(' ', null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.place).toBeDefined()
      expect(result.errors.name).toBeDefined()
    }
  })

  it('stores a blank address as null', () => {
    const result = parseTripEndForm('Home', { ...denver, address: ' ' })
    expect(result.ok && result.fields.address).toBeNull()
  })
})

describe('tripEndSaveError', () => {
  it('explains a duplicate start or end', () => {
    expect(
      tripEndSaveError('start', { code: '23505', message: 'duplicate key' }),
    ).toMatch(/already has a start/)
    expect(
      tripEndSaveError('end', { code: '23505', message: 'duplicate key' }),
    ).toMatch(/already has an end/)
  })

  it('passes other errors through', () => {
    expect(tripEndSaveError('end', { message: 'Network error' })).toBe(
      'Network error',
    )
  })
})
