// Text for legs and for day / trip summary rows, from tripMath.ts results.

import type { CostCategory } from '../lib/database.types'
import { formatDuration, formatMiles, formatMoney } from '../lib/format'
import type { Leg, LegStatus, Totals } from '../lib/tripMath'

/** Shown for values that depend on routes or prices not fetched yet. */
export const PENDING = '—'

export const NO_ROUTE = 'No route'

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  lodging: 'Lodging',
  food: 'Food',
  activity: 'Activities',
  other: 'Other',
}

export type CategoryCost = {
  category: CostCategory
  label: string
  amount: string
}

export type TotalsDisplay = {
  distance: string
  duration: string
  gas: string
  /** All stop costs. */
  stopCosts: string
  /** Stop costs per category, only categories with a cost, in a fixed order. */
  categories: CategoryCost[]
  total: string
  /** Legs with no route, left out of the driving values above. */
  missingLegs: number
}

/**
 * Formats totals. Driving values show as pending while any leg's route is
 * missing; gas also when the gas price isn't known yet. The total then
 * shows the known costs plus a note that gas is still to come. Legs with no
 * route are left out (and counted in `missingLegs`).
 */
export function formatTotals(
  totals: Totals,
  options: { gasPriceKnown: boolean },
): TotalsDisplay {
  const routesPending = totals.pendingLegs > 0
  const gasPending = routesPending || !options.gasPriceKnown
  // A day with no legs has no gas to price.
  const hasDriving = routesPending || totals.drivingMiles > 0
  const gasUnknown = gasPending && hasDriving

  const categories = (
    Object.keys(COST_CATEGORY_LABELS) as CostCategory[]
  ).flatMap((category) => {
    const amount = totals.costsByCategory[category]
    return amount > 0
      ? [
          {
            category,
            label: COST_CATEGORY_LABELS[category],
            amount: formatMoney(amount),
          },
        ]
      : []
  })

  return {
    distance: routesPending ? PENDING : formatMiles(totals.drivingMiles),
    duration: routesPending ? PENDING : formatDuration(totals.drivingSeconds),
    gas: gasUnknown ? PENDING : formatMoney(totals.gasCost),
    stopCosts: formatMoney(totals.stopCosts),
    categories,
    total: gasUnknown
      ? `${formatMoney(totals.stopCosts)} + gas`
      : formatMoney(totals.totalCost),
    missingLegs: totals.failedLegs,
  }
}

export type LegDisplay = { status: LegStatus; text: string }

/** A leg between two stops, e.g. `123 mi · 2h 05m`. */
export function formatLeg(leg: Leg): LegDisplay {
  if (leg.status === 'ok' && leg.route) {
    return {
      status: 'ok',
      text: `${formatMiles(leg.miles)} · ${formatDuration(leg.route.durationS)}`,
    }
  }
  if (leg.status === 'failed') return { status: 'failed', text: NO_ROUTE }
  return { status: 'pending', text: 'Finding route…' }
}

/** Note for totals that leave out legs with no route, or null. */
export function missingLegsNote(missingLegs: number) {
  if (missingLegs === 0) return null
  return missingLegs === 1
    ? 'Excludes 1 leg with no route'
    : `Excludes ${missingLegs} legs with no route`
}
