// Leg rows between stops, and the day / trip totals built from tripMath.ts.

import type { Leg, Totals } from '../lib/tripMath'
import { formatLeg, formatTotals, missingLegsNote } from './dayTotals'

/** The drive into a stop, shown above it: "123 mi · 2h 05m". */
export function LegItem({ leg, fromName }: { leg: Leg; fromName: string }) {
  const { status, text } = formatLeg(leg)
  return (
    <li className="leg" data-status={status} aria-busy={status === 'pending'}>
      <span className="visually-hidden">Drive from {fromName}: </span>
      {text}
    </li>
  )
}

/** Driving, gas, costs by category and total, for a day or the whole trip. */
export function TotalsList({
  totals,
  gasPriceKnown,
  className,
}: {
  totals: Totals
  gasPriceKnown: boolean
  className: string
}) {
  const display = formatTotals(totals, { gasPriceKnown })
  const note = missingLegsNote(display.missingLegs)
  return (
    <>
      <dl className={className}>
        <div>
          <dt>Driving</dt>
          <dd>
            {display.distance} · {display.duration}
          </dd>
        </div>
        <div>
          <dt>Gas</dt>
          <dd>{display.gas}</dd>
        </div>
        {display.categories.map((cost) => (
          <div key={cost.category}>
            <dt>{cost.label}</dt>
            <dd>{cost.amount}</dd>
          </div>
        ))}
        <div>
          <dt>Total</dt>
          <dd>{display.total}</dd>
        </div>
      </dl>
      {note && <p className="totals-note">{note}</p>}
    </>
  )
}

/** Totals for the whole trip, pinned above the day list. */
export function TripTotalsBar({
  totals,
  gasPriceKnown,
}: {
  totals: Totals
  gasPriceKnown: boolean
}) {
  return (
    <section className="trip-totals" aria-label="Trip totals">
      <h2 className="trip-totals-title">Trip</h2>
      <TotalsList
        totals={totals}
        gasPriceKnown={gasPriceKnown}
        className="day-totals trip-totals-list"
      />
    </section>
  )
}
