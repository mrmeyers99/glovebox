import { describe, expect, it } from 'vitest'
import type { Totals } from '../lib/tripMath'
import { PENDING, formatTotals } from './dayTotals'

function totals(extra: Partial<Totals> = {}): Totals {
  return {
    drivingMiles: 0,
    drivingSeconds: 0,
    gasCost: 0,
    costsByCategory: { lodging: 0, food: 0, activity: 0, other: 0 },
    stopCosts: 0,
    totalCost: 0,
    pendingLegs: 0,
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
          stopCosts: 150,
          totalCost: 190.25,
        }),
        { gasPriceKnown: true },
      ),
    ).toEqual({
      distance: '313 mi',
      duration: '5h 20m',
      gas: '$40.25',
      other: '$150.00',
      total: '$190.25',
    })
  })

  it('shows pending driving values while routes are missing', () => {
    expect(
      formatTotals(totals({ pendingLegs: 1, stopCosts: 80, totalCost: 80 }), {
        gasPriceKnown: true,
      }),
    ).toEqual({
      distance: PENDING,
      duration: PENDING,
      gas: PENDING,
      other: '$80.00',
      total: '$80.00 + gas',
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
      other: '$0.00',
      total: '$0.00',
    })
  })
})
