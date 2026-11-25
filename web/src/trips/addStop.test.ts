import { describe, expect, it } from 'vitest'
import type { Day, Stop } from '../lib/database.types'
import type { Place } from '../lib/geocode'
import { comparePositions } from '../lib/tripMath'
import {
  emptyStopForm,
  nameAfterPick,
  newStopPosition,
  parseCost,
  parseStay,
  parseStopForm,
  placeQuery,
  searchFocus,
  type StopFormInput,
} from './addStop'

const moab: Place = {
  name: 'Moab',
  address: 'UT, USA',
  lat: 38.57,
  lng: -109.55,
}
const arches: Place = {
  name: 'Arches National Park',
  address: 'Moab, UT, USA',
  lat: 38.73,
  lng: -109.59,
}

const form = (patch: Partial<StopFormInput> = {}): StopFormInput => ({
  ...emptyStopForm,
  name: 'Moab',
  ...patch,
})

const makeDay = (id: string, position: string): Day => ({
  id,
  trip_id: 't1',
  position,
  notes: null,
  created_at: '',
  updated_at: '',
})

const makeStop = (
  id: string,
  dayId: string,
  position: string,
  patch: Partial<Stop> = {},
): Stop => ({
  id,
  trip_id: 't1',
  day_id: dayId,
  position,
  kind: 'waypoint',
  name: id,
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
  ...patch,
})

describe('parseStopForm', () => {
  it('builds the insert fields from the form and the picked place', () => {
    const result = parseStopForm(
      form({
        name: '  Moab Motel ',
        notes: ' Conf #123\nLate check-in ',
        costAmount: '$1,250.505',
        costCategory: 'lodging',
        arrivalTime: '14:30',
        stay: '1h 30m',
      }),
      moab,
    )
    expect(result).toEqual({
      ok: true,
      fields: {
        name: 'Moab Motel',
        address: 'UT, USA',
        lat: 38.57,
        lng: -109.55,
        notes: 'Conf #123\nLate check-in',
        cost_amount: 1250.51,
        cost_category: 'lodging',
        arrival_time: '14:30',
        stay_minutes: 90,
      },
    })
  })

  it('stores blank optional fields as null', () => {
    const result = parseStopForm(form({ costCategory: 'food' }), {
      ...moab,
      address: '',
    })
    expect(result).toEqual({
      ok: true,
      fields: {
        name: 'Moab',
        address: null,
        lat: 38.57,
        lng: -109.55,
        notes: null,
        cost_amount: null,
        // No amount, so the category is dropped.
        cost_category: null,
        arrival_time: null,
        stay_minutes: null,
      },
    })
  })

  it('allows a zero cost and zero stay', () => {
    const result = parseStopForm(form({ costAmount: '0', stay: '0' }), moab)
    expect(result.ok && result.fields).toMatchObject({
      cost_amount: 0,
      stay_minutes: 0,
    })
  })

  it('requires a place', () => {
    const result = parseStopForm(form(), null)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors.place).toBeTruthy()
  })

  it('requires a name of 1 to 200 characters', () => {
    const blank = parseStopForm(form({ name: '   ' }), moab)
    expect(!blank.ok && blank.errors.name).toBe('Enter a name.')

    // 200 code points is fine even if it's more UTF-16 units.
    const emoji = '🚗'.repeat(200)
    expect(parseStopForm(form({ name: emoji }), moab).ok).toBe(true)

    const long = parseStopForm(form({ name: 'a'.repeat(201) }), moab)
    expect(!long.ok && long.errors.name).toMatch(/200/)
  })

  it('rejects negative or non-numeric costs', () => {
    for (const costAmount of ['-5', 'abc', '1.2.3', '100000000']) {
      const result = parseStopForm(form({ costAmount }), moab)
      expect(!result.ok && result.errors.costAmount, costAmount).toBeTruthy()
    }
  })

  it('rejects negative or unreadable stays', () => {
    for (const stay of ['-10', 'soon', '1:75', 'h']) {
      const result = parseStopForm(form({ stay }), moab)
      expect(!result.ok && result.errors.stay, stay).toBeTruthy()
    }
  })

  it('rejects invalid arrival times', () => {
    for (const arrivalTime of ['25:00', '2pm', '12:60']) {
      const result = parseStopForm(form({ arrivalTime }), moab)
      expect(!result.ok && result.errors.arrivalTime, arrivalTime).toBeTruthy()
    }
    expect(parseStopForm(form({ arrivalTime: '09:05:00' }), moab).ok).toBe(true)
  })

  it('reports every error at once', () => {
    const result = parseStopForm(
      form({ name: '', costAmount: '-1', stay: 'x', arrivalTime: 'x' }),
      null,
    )
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual([
      'arrivalTime',
      'costAmount',
      'name',
      'place',
      'stay',
    ])
  })
})

describe('parseCost', () => {
  it('reads dollar amounts', () => {
    expect(parseCost('120')).toBe(120)
    expect(parseCost(' $45.5 ')).toBe(45.5)
    expect(parseCost('.99')).toBe(0.99)
    expect(parseCost('10.')).toBe(10)
    expect(parseCost('99999999.99')).toBe(99999999.99)
  })

  it('rejects anything else', () => {
    expect(parseCost('')).toBeNull()
    expect(parseCost('-1')).toBeNull()
    expect(parseCost('1e3')).toBeNull()
    expect(parseCost('99999999.999')).toBeNull()
  })
})

describe('parseStay', () => {
  it.each([
    ['90', 90],
    ['0', 0],
    ['1:30', 90],
    ['0:05', 5],
    ['2h', 120],
    ['2 hours', 120],
    ['45m', 45],
    ['45 min', 45],
    ['1h 30m', 90],
    ['1h30m', 90],
    ['1.5h', 90],
    ['3 hrs 15 mins', 195],
  ])('reads %s as %i minutes', (text, minutes) => {
    expect(parseStay(text)).toBe(minutes)
  })

  it.each(['', 'h', 'abc', '-5', '1:5', '1.5m', '9999999999'])(
    'rejects %j',
    (text) => {
      expect(parseStay(text)).toBeNull()
    },
  )
})

describe('nameAfterPick', () => {
  it("uses the place's name when the name is blank", () => {
    expect(nameAfterPick('  ', null, moab)).toBe('Moab')
  })

  it("replaces the previous pick's name", () => {
    expect(nameAfterPick('Moab', moab, arches)).toBe('Arches National Park')
  })

  it('keeps a name the user typed', () => {
    expect(nameAfterPick('Our motel', moab, arches)).toBe('Our motel')
    expect(nameAfterPick('Our motel', null, arches)).toBe('Our motel')
  })
})

describe('placeQuery', () => {
  it('trims and requires two characters', () => {
    expect(placeQuery('  Moab ')).toBe('Moab')
    expect(placeQuery(' M ')).toBeNull()
    expect(placeQuery('')).toBeNull()
  })

  it('caps the query at the search limit', () => {
    expect(placeQuery('a'.repeat(250))).toHaveLength(200)
  })
})

describe('newStopPosition', () => {
  const before = (a: string, b: string) =>
    expect(comparePositions(a, b)).toBeLessThan(0)

  it('starts an empty day', () => {
    expect(typeof newStopPosition([])).toBe('string')
  })

  it('goes after every other stop on the day', () => {
    const stops = [
      { kind: 'waypoint' as const, position: 'a2' },
      { kind: 'start' as const, position: 'a0' },
      { kind: 'waypoint' as const, position: 'a1' },
    ]
    before('a2', newStopPosition(stops))
  })

  it("goes before the trip's end stop", () => {
    const position = newStopPosition([
      { kind: 'waypoint', position: 'a0' },
      { kind: 'end', position: 'a1' },
      { kind: 'waypoint', position: 'a0V' },
    ])
    before('a0V', position)
    before(position, 'a1')
  })

  it('goes before an end stop that is alone on its day', () => {
    before(newStopPosition([{ kind: 'end', position: 'a0' }]), 'a0')
  })

  it('still goes after the other stops if the end key sorts early', () => {
    // Shown last anyway, since the end stop is always listed last.
    before(
      'a5',
      newStopPosition([
        { kind: 'end', position: 'a1' },
        { kind: 'waypoint', position: 'a5' },
      ]),
    )
  })

  it('compares keys byte-wise, not by locale', () => {
    // 'Z' sorts before 'a' byte-wise; localeCompare would disagree.
    before(
      'a0a',
      newStopPosition([
        { kind: 'waypoint', position: 'a0Z' },
        { kind: 'waypoint', position: 'a0a' },
      ]),
    )
  })
})

describe('searchFocus', () => {
  const days = [makeDay('d2', 'a1'), makeDay('d1', 'a0'), makeDay('d3', 'a2')]

  it('uses the last active stop before the new one on that day', () => {
    const stops = [
      makeStop('s1', 'd2', 'a0', { lat: 1, lng: 1 }),
      makeStop('s2', 'd2', 'a1', { lat: 2, lng: 2 }),
      makeStop('s3', 'd2', 'a2', { lat: 3, lng: 3, skipped: true }),
      makeStop('end', 'd2', 'a3', { lat: 9, lng: 9, kind: 'end' }),
    ]
    expect(searchFocus(days, stops, 'd2')).toEqual({ lat: 2, lng: 2 })
  })

  it('falls back to the previous days', () => {
    const stops = [
      makeStop('start', 'd1', 'a0', { lat: 1, lng: 1, kind: 'start' }),
      makeStop('s2', 'd1', 'a1', { lat: 2, lng: 2 }),
      makeStop('end', 'd3', 'a0', { lat: 9, lng: 9, kind: 'end' }),
    ]
    expect(searchFocus(days, stops, 'd3')).toEqual({ lat: 2, lng: 2 })
  })

  it('falls back to any active stop on the trip', () => {
    const stops = [makeStop('end', 'd3', 'a0', { lat: 9, lng: 9, kind: 'end' })]
    expect(searchFocus(days, stops, 'd1')).toEqual({ lat: 9, lng: 9 })
  })

  it('is undefined for a trip with no stops', () => {
    expect(searchFocus(days, [], 'd1')).toBeUndefined()
  })
})
