import { describe, expect, it } from 'vitest'
import {
  METERS_PER_MILE,
  dayDate,
  gasCost,
  orderTrip,
  summarizeTrip,
  type StopInput,
} from './tripMath'

function stop(
  id: string,
  dayId: string,
  position: string,
  extra: Partial<StopInput> = {},
): StopInput {
  return {
    id,
    dayId,
    position,
    kind: 'waypoint',
    skipped: false,
    lat: 0,
    lng: 0,
    costAmount: null,
    costCategory: null,
    ...extra,
  }
}

// Every leg is 100 miles and 2 hours.
const route = () => ({ distanceM: 100 * METERS_PER_MILE, durationS: 7200 })
const options = { mpg: 25, gasPricePerGallon: 4, route }

describe('gasCost', () => {
  it('is miles / mpg * price', () => {
    expect(gasCost(100, 25, 4)).toBe(16)
  })
  it('is 0 for a non-positive mpg', () => {
    expect(gasCost(100, 0, 4)).toBe(0)
  })
})

describe('orderTrip', () => {
  it('orders days and stops by position, byte-wise', () => {
    const days = [
      { id: 'd2', position: 'a1' },
      { id: 'd1', position: 'a0' },
    ]
    const stops = [
      stop('b', 'd1', 'a1'),
      stop('a', 'd1', 'Zz'), // uppercase sorts before lowercase
      stop('c', 'd2', 'a0'),
    ]
    const result = orderTrip(days, stops)
    expect(result.map((d) => d.day.id)).toEqual(['d1', 'd2'])
    expect(result[0].stops.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('pins start first and end last within a day', () => {
    const days = [{ id: 'd1', position: 'a0' }]
    const stops = [
      stop('end', 'd1', 'a0', { kind: 'end' }),
      stop('mid', 'd1', 'a1'),
      stop('start', 'd1', 'a2', { kind: 'start' }),
    ]
    expect(orderTrip(days, stops)[0].stops.map((s) => s.id)).toEqual([
      'start',
      'mid',
      'end',
    ])
  })
})

describe('summarizeTrip', () => {
  it('attributes each leg to the day of the stop it arrives at', () => {
    const days = [
      { id: 'd1', position: 'a0' },
      { id: 'd2', position: 'a1' },
    ]
    const stops = [
      stop('home', 'd1', 'a0', { kind: 'start' }),
      stop('hotel', 'd1', 'a1'),
      stop('park', 'd2', 'a0'),
      stop('dest', 'd2', 'a1', { kind: 'end' }),
    ]
    const summary = summarizeTrip(days, stops, options)
    expect(summary.legs.map((l) => `${l.from.id}>${l.to.id}`)).toEqual([
      'home>hotel',
      'hotel>park',
      'park>dest',
    ])
    expect(summary.days[0].legs).toHaveLength(1)
    expect(summary.days[1].legs).toHaveLength(2) // includes the morning drive
    expect(summary.days[1].drivingMiles).toBeCloseTo(200)
    expect(summary.days[1].drivingSeconds).toBe(14400)
    expect(summary.totals.drivingMiles).toBeCloseTo(300)
    expect(summary.totals.gasCost).toBeCloseTo(48)
  })

  it('gives empty (rest) days zero driving', () => {
    const days = [
      { id: 'd1', position: 'a0' },
      { id: 'rest', position: 'a1' },
      { id: 'd3', position: 'a2' },
    ]
    const stops = [
      stop('home', 'd1', 'a0', { kind: 'start' }),
      stop('moab', 'd1', 'a1'),
      stop('dest', 'd3', 'a0', { kind: 'end' }),
    ]
    const summary = summarizeTrip(days, stops, options)
    expect(summary.days.map((d) => d.dayNumber)).toEqual([1, 2, 3])
    expect(summary.days[1].drivingMiles).toBe(0)
    expect(summary.days[2].drivingMiles).toBeCloseTo(100)
  })

  it('routes around skipped stops and leaves out their costs', () => {
    const days = [{ id: 'd1', position: 'a0' }]
    const stops = [
      stop('home', 'd1', 'a0', { kind: 'start' }),
      stop('maybe', 'd1', 'a1', {
        skipped: true,
        costAmount: 30,
        costCategory: 'activity',
      }),
      stop('dest', 'd1', 'a2', {
        kind: 'end',
        costAmount: 150,
        costCategory: 'lodging',
      }),
    ]
    const summary = summarizeTrip(days, stops, options)
    expect(summary.legs.map((l) => `${l.from.id}>${l.to.id}`)).toEqual([
      'home>dest',
    ])
    expect(summary.totals.costsByCategory).toEqual({
      lodging: 150,
      food: 0,
      activity: 0,
      other: 0,
    })
    expect(summary.totals.totalCost).toBeCloseTo(150 + 16)
  })

  it('counts legs without a cached route as pending', () => {
    const days = [{ id: 'd1', position: 'a0' }]
    const stops = [
      stop('home', 'd1', 'a0', { kind: 'start' }),
      stop('dest', 'd1', 'a1', { kind: 'end' }),
    ]
    const summary = summarizeTrip(days, stops, {
      ...options,
      route: () => undefined,
    })
    expect(summary.totals.pendingLegs).toBe(1)
    expect(summary.totals.failedLegs).toBe(0)
    expect(summary.totals.drivingMiles).toBe(0)
    expect(summary.legs[0].status).toBe('pending')
  })

  it('counts legs with no route as failed and leaves them out of totals', () => {
    const days = [{ id: 'd1', position: 'a0' }]
    const stops = [
      stop('home', 'd1', 'a0', { kind: 'start', lat: 1 }),
      stop('island', 'd1', 'a1', { lat: 2 }),
      stop('dest', 'd1', 'a2', { kind: 'end', lat: 3 }),
    ]
    const summary = summarizeTrip(days, stops, {
      ...options,
      route: (from) => (from.id === 'home' ? null : route()),
    })
    expect(summary.legs.map((l) => l.status)).toEqual(['failed', 'ok'])
    expect(summary.legs[0].route).toBeUndefined()
    expect(summary.totals.failedLegs).toBe(1)
    expect(summary.totals.pendingLegs).toBe(0)
    expect(summary.totals.drivingMiles).toBeCloseTo(100)
    expect(summary.totals.gasCost).toBeCloseTo(16)
  })

  it('files uncategorized costs under other', () => {
    const days = [{ id: 'd1', position: 'a0' }]
    const stops = [stop('a', 'd1', 'a0', { costAmount: 12 })]
    const summary = summarizeTrip(days, stops, options)
    expect(summary.totals.costsByCategory.other).toBe(12)
  })
})

describe('dayDate', () => {
  it('adds days to the start date', () => {
    expect(dayDate('2027-06-28', 1)).toBe('2027-06-28')
    expect(dayDate('2027-06-28', 5)).toBe('2027-07-02')
  })
  it('is null without a start date', () => {
    expect(dayDate(null, 3)).toBeNull()
  })
})
