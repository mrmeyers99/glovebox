// Read-only day list: days in order with their dates, notes, stops and totals.

import { useMemo } from 'react'
import type { Day, Stop, Trip } from '../lib/database.types'
import { formatDayDate, formatMoney, formatTimeOfDay } from '../lib/format'
import {
  dayDate,
  summarizeTrip,
  type DaySummary,
  type RouteLookup,
} from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { formatTotals } from './dayTotals'

// Routes aren't fetched yet (#21), so every leg is pending.
const noRoutes: RouteLookup = () => undefined

export function DayListPanel({
  trip,
  days,
  stops,
  onAddStop,
}: {
  trip: Trip
  days: Day[]
  stops: Stop[]
  /** Shows an Add stop button on each day; pass only for owners and editors. */
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
}) {
  const gasPrice =
    trip.gas_price_per_gallon === null
      ? null
      : Number(trip.gas_price_per_gallon)

  const summary = useMemo(
    () =>
      summarizeTrip(days.map(toDayInput), stops.map(toStopInput), {
        mpg: Number(trip.mpg),
        gasPricePerGallon: gasPrice ?? 0,
        route: noRoutes,
      }),
    [days, stops, trip.mpg, gasPrice],
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
    <ol className="day-list">
      {summary.days.map((day) => (
        <DayCard
          key={day.dayId}
          summary={day}
          notes={daysById.get(day.dayId)?.notes ?? null}
          date={dayDate(trip.start_date, day.dayNumber)}
          stopsById={stopsById}
          gasPriceKnown={gasPrice !== null}
          onAddStop={onAddStop}
        />
      ))}
    </ol>
  )
}

function DayCard({
  summary,
  notes,
  date,
  stopsById,
  gasPriceKnown,
  onAddStop,
}: {
  summary: DaySummary
  notes: string | null
  date: string | null
  stopsById: Map<string, Stop>
  gasPriceKnown: boolean
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
}) {
  const totals = formatTotals(summary, { gasPriceKnown })
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
            return stop && <StopItem key={stop.id} stop={stop} />
          })}
        </ol>
      )}

      {onAddStop && (
        <button
          type="button"
          className="day-add-stop"
          onClick={() =>
            onAddStop({ dayId: summary.dayId, dayNumber: summary.dayNumber })
          }
        >
          + Add stop
        </button>
      )}

      <dl className="day-totals">
        <div>
          <dt>Driving</dt>
          <dd>
            {totals.distance} · {totals.duration}
          </dd>
        </div>
        <div>
          <dt>Gas</dt>
          <dd>{totals.gas}</dd>
        </div>
        <div>
          <dt>Other</dt>
          <dd>{totals.other}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{totals.total}</dd>
        </div>
      </dl>
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
