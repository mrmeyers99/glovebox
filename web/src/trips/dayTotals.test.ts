import { describe, expect, it } from 'vitest'
import type { Leg, StopInput, Totals } from '../lib/tripMath'
import {
  NO_ROUTE,
  PENDING,
  formatLeg,
  formatTotals,
  missingLegsNote,
} from './dayTotals'

function totals(extra: Partial<Totals> = {}): Totals {
  return {
    drivingMiles: 0,
    drivingSeconds: 0,
    gasCost: 0,
    costsByCategory: { lodging: 0, food: 0, activity: 0, other: 0 },
    stopCosts: 0,
    totalCost: 0,
    pendingLegs: 0,
    failedLegs: 0,
    ...extra,
  }
}

describe('formatTotals', () => {
  it('formats complete totals', () => {
    expect(
      formatTotals(
        totals({
          drivingMiles: 312.6,
          drivingSeconds: 5 * 3600 + 20 * 60,
          gasCost: 40.25,
          costsByCategory: { lodging: 120, food: 30, activity: 0, other: 0 },
          stopCosts: 150,
          totalCost: 190.25,
        }),
        { gasPriceKnown: true },
      ),
    ).toEqual({
      distance: '313 mi',
      duration: '5h 20m',
      gas: '$40.25',
      stopCosts: '$150.00',
      categories: [
        { category: 'lodging', label: 'Lodging', amount: '$120.00' },
        { category: 'food', label: 'Food', amount: '$30.00' },
      ],
      total: '$190.25',
      missingLegs: 0,
    })
  })

  it('shows pending driving values while routes are missing', () => {
    expect(
      formatTotals(totals({ pendingLegs: 1, stopCosts: 80, totalCost: 80 }), {
        gasPriceKnown: true,
      }),
    ).toMatchObject({
      distance: PENDING,
      duration: PENDING,
      gas: PENDING,
      stopCosts: '$80.00',
      total: '$80.00 + gas',
    })
  })

  it('shows known values and counts legs with no route', () => {
    const display = formatTotals(
      totals({
        drivingMiles: 100,
        drivingSeconds: 7200,
        gasCost: 16,
        totalCost: 16,
        failedLegs: 2,
      }),
      { gasPriceKnown: true },
    )
    expect(display).toMatchObject({
      distance: '100 mi',
      duration: '2h 00m',
      gas: '$16.00',
      total: '$16.00',
      missingLegs: 2,
    })
  })

  it('shows pending gas when the gas price is unknown', () => {
    const display = formatTotals(
      totals({ drivingMiles: 100, drivingSeconds: 3600 }),
      { gasPriceKnown: false },
    )
    expect(display.distance).toBe('100 mi')
    expect(display.gas).toBe(PENDING)
    expect(display.total).toBe('$0.00 + gas')
  })

  it('shows zeros for a rest day, even without a gas price', () => {
    expect(formatTotals(totals(), { gasPriceKnown: false })).toEqual({
      distance: '0 mi',
      duration: '0m',
      gas: '$0.00',
      stopCosts: '$0.00',
      categories: [],
      total: '$0.00',
      missingLegs: 0,
    })
  })
})

describe('formatLeg', () => {
  const stop = { id: 's' } as StopInput
  const leg = (extra: Partial<Leg>): Leg => ({
    from: stop,
    to: stop,
    dayId: 'd',
    route: undefined,
    status: 'pending',
    miles: 0,
    gasCost: 0,
    ...extra,
  })

  it('shows distance and drive time', () => {
    expect(
      formatLeg(
        leg({
          status: 'ok',
          route: { distanceM: 0, durationS: 2 * 3600 + 5 * 60 },
          miles: 123.2,
        }),
      ),
    ).toEqual({ status: 'ok', text: '123 mi · 2h 05m' })
  })

  it('shows failed legs as no route', () => {
    expect(formatLeg(leg({ status: 'failed' }))).toEqual({
      status: 'failed',
      text: NO_ROUTE,
    })
  })

  it('marks pending legs', () => {
    expect(formatLeg(leg({})).status).toBe('pending')
  })
})

describe('missingLegsNote', () => {
  it('is null with no missing legs', () => {
    expect(missingLegsNote(0)).toBeNull()
  })
  it('counts missing legs', () => {
    expect(missingLegsNote(1)).toBe('Excludes 1 leg with no route')
    expect(missingLegsNote(3)).toBe('Excludes 3 legs with no route')
  })
})
