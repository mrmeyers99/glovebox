// Read-only day list: days in order with their dates, notes, stops and totals.

import { Fragment, useMemo } from 'react'
import type { Day, Stop, Trip } from '../lib/database.types'
import { formatDayDate, formatMoney, formatTimeOfDay } from '../lib/format'
import {
  dayDate,
  effectiveGasPrice,
  summarizeTrip,
  type DaySummary,
  type Leg,
} from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { LegItem, TotalsList, TripTotalsBar } from './RouteTotals'
import { useRoutes } from './useRoutes'

// The national average is a constant for now, so the price is always known.
const gasPriceKnown = true

export function DayListPanel({
  trip,
  days,
  stops,
}: {
  trip: Trip
  days: Day[]
  stops: Stop[]
}) {
  const gasPrice = effectiveGasPrice(
    trip.gas_price_per_gallon === null
      ? null
      : Number(trip.gas_price_per_gallon),
  )
  const mpg = Number(trip.mpg)

  const dayInputs = useMemo(() => days.map(toDayInput), [days])
  const stopInputs = useMemo(() => stops.map(toStopInput), [stops])
  // The legs the trip needs, before any routes are known.
  const neededLegs = useMemo(
    () =>
      summarizeTrip(dayInputs, stopInputs, {
        mpg,
        gasPricePerGallon: gasPrice,
        route: () => undefined,
      }).legs,
    [dayInputs, stopInputs, mpg, gasPrice],
  )
  const route = useRoutes(neededLegs)
  const summary = useMemo(
    () =>
      summarizeTrip(dayInputs, stopInputs, {
        mpg,
        gasPricePerGallon: gasPrice,
        route,
      }),
    [dayInputs, stopInputs, mpg, gasPrice, route],
  )
  // Each leg is shown above the stop it arrives at.
  const legsByArrival = useMemo(
    () => new Map(summary.legs.map((leg) => [leg.to.id, leg])),
    [summary.legs],
  )
  const daysById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days])
  const stopsById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])

  if (summary.days.length === 0) {
    return (
      <div className="panel-placeholder">
        <p>This trip has no days yet.</p>
      </div>
    )
  }

  return (
    <>
      <TripTotalsBar totals={summary.totals} gasPriceKnown={gasPriceKnown} />
      <ol className="day-list">
        {summary.days.map((day) => (
          <DayCard
            key={day.dayId}
            summary={day}
            notes={daysById.get(day.dayId)?.notes ?? null}
            date={dayDate(trip.start_date, day.dayNumber)}
            stopsById={stopsById}
            legsByArrival={legsByArrival}
            gasPriceKnown={gasPriceKnown}
          />
        ))}
      </ol>
    </>
  )
}

function DayCard({
  summary,
  notes,
  date,
  stopsById,
  legsByArrival,
  gasPriceKnown,
}: {
  summary: DaySummary
  notes: string | null
  date: string | null
  stopsById: Map<string, Stop>
  legsByArrival: Map<string, Leg>
  gasPriceKnown: boolean
}) {
  const headingId = `day-${summary.dayId}`

  return (
    <li className="day-card" aria-labelledby={headingId}>
      <header className="day-header">
        <h2 id={headingId}>Day {summary.dayNumber}</h2>
        {date && <time dateTime={date}>{formatDayDate(date)}</time>}
      </header>
      {notes && <p className="day-notes">{notes}</p>}

      {summary.stops.length === 0 ? (
        <p className="day-rest">Rest day</p>
      ) : (
        <ol className="stop-list">
          {summary.stops.map((input) => {
            const stop = stopsById.get(input.id)
            const leg = legsByArrival.get(input.id)
            return (
              stop && (
                <Fragment key={stop.id}>
                  {leg && (
                    <LegItem
                      leg={leg}
                      fromName={stopsById.get(leg.from.id)?.name ?? ''}
                    />
                  )}
                  <StopItem stop={stop} />
                </Fragment>
              )
            )
          })}
        </ol>
      )}

      <TotalsList
        totals={summary}
        gasPriceKnown={gasPriceKnown}
        className="day-totals"
      />
    </li>
  )
}

const KIND_LABELS = { start: 'Start', end: 'End' } as const

function StopItem({ stop }: { stop: Stop }) {
  const kindLabel = stop.kind === 'waypoint' ? null : KIND_LABELS[stop.kind]
  const cost = stop.cost_amount == null ? 0 : Number(stop.cost_amount)

  return (
    <li
      className="stop"
      data-kind={stop.kind}
      data-skipped={stop.skipped || undefined}
    >
      <div className="stop-main">
        <span className="stop-name">
          {kindLabel && <span className="stop-badge">{kindLabel}</span>}
          {stop.skipped && (
            <span className="stop-badge stop-badge-skipped">Skipped</span>
          )}
          {stop.name}
        </span>
        {stop.arrival_time && (
          <time className="stop-arrival" dateTime={stop.arrival_time}>
            {formatTimeOfDay(stop.arrival_time)}
          </time>
        )}
      </div>
      {stop.address && <p className="stop-address">{stop.address}</p>}
      {/* Skipped stops don't count toward the totals, so don't show a cost. */}
      {cost > 0 && !stop.skipped && (
        <p className="stop-cost">
          {formatMoney(cost)}
          {stop.cost_category && ` · ${stop.cost_category}`}
        </p>
      )}
    </li>
  )
}
