// Text for a day's summary row, from its totals in tripMath.ts.

import { formatDuration, formatMiles, formatMoney } from '../lib/format'
import type { Totals } from '../lib/tripMath'

/** Shown for values that depend on routes or prices not fetched yet. */
export const PENDING = '—'

export type TotalsDisplay = {
  distance: string
  duration: string
  gas: string
  other: string
  total: string
}

/**
 * Formats totals. Driving values show as pending while any leg's route is
 * missing; gas also when the gas price isn't known yet. The total then
 * shows the known costs plus a note that gas is still to come.
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

  return {
    distance: routesPending ? PENDING : formatMiles(totals.drivingMiles),
    duration: routesPending ? PENDING : formatDuration(totals.drivingSeconds),
    gas: gasUnknown ? PENDING : formatMoney(totals.gasCost),
    other: formatMoney(totals.stopCosts),
    total: gasUnknown
      ? `${formatMoney(totals.stopCosts)} + gas`
      : formatMoney(totals.totalCost),
  }
}
