// Read-only day list: days in order with their dates, notes, stops and totals.

import { useEffect, useMemo, useRef } from 'react'
import type { Day, Stop, Trip } from '../lib/database.types'
import { formatDayDate, formatMoney, formatTimeOfDay } from '../lib/format'
import {
  dayDate,
  summarizeTrip,
  type DaySummary,
  type RouteLookup,
} from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { effectiveGasPrice } from '../lib/gasPrice'
import { formatTotals } from './dayTotals'
import { dayColor, type StopSelection } from './mapView'
import { useNationalAverage } from './useNationalAverage'

// Routes aren't fetched yet (#21), so every leg is pending.
const noRoutes: RouteLookup = () => undefined

export function DayListPanel({
  trip,
  days,
  stops,
  selection,
  onSelectStop,
  onAddStop,
}: {
  trip: Trip
  days: Day[]
  stops: Stop[]
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  /** Shows an Add stop button on each day; pass only for owners and editors. */
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
}) {
  // The trip's own price, else the national average (null until it loads).
  const nationalAverage = useNationalAverage()
  const gasPrice = effectiveGasPrice(trip.gas_price_per_gallon, nationalAverage)

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
          selection={selection}
          onSelectStop={onSelectStop}
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
  selection,
  onSelectStop,
  onAddStop,
}: {
  summary: DaySummary
  notes: string | null
  date: string | null
  stopsById: Map<string, Stop>
  gasPriceKnown: boolean
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
}) {
  const totals = formatTotals(summary, { gasPriceKnown })
  const headingId = `day-${summary.dayId}`

  return (
    <li className="day-card" aria-labelledby={headingId}>
      <header className="day-header">
        <h2 id={headingId}>
          {/* Matches this day's markers on the map. */}
          <span
            className="day-swatch"
            aria-hidden="true"
            style={{ background: dayColor(summary.dayNumber) }}
          />
          Day {summary.dayNumber}
        </h2>
        {date && <time dateTime={date}>{formatDayDate(date)}</time>}
      </header>
      {notes && <p className="day-notes">{notes}</p>}

      {summary.stops.length === 0 ? (
        <p className="day-rest">Rest day</p>
      ) : (
        <ol className="stop-list">
          {summary.stops.map((input) => {
            const stop = stopsById.get(input.id)
            const selected = selection?.stopId === input.id
            return (
              stop && (
                <StopItem
                  key={stop.id}
                  stop={stop}
                  selected={selected}
                  // Scroll to stops picked on the map, not ones clicked here.
                  scrollTo={
                    selected && selection.source === 'map' ? selection : null
                  }
                  onSelect={onSelectStop}
                />
              )
            )
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

function StopItem({
  stop,
  selected,
  scrollTo,
  onSelect,
}: {
  stop: Stop
  selected: boolean
  /** Set (a new object each time) when the list should scroll to this stop. */
  scrollTo: StopSelection | null
  onSelect: (stopId: string) => void
}) {
  const kindLabel = stop.kind === 'waypoint' ? null : KIND_LABELS[stop.kind]
  const cost = stop.cost_amount == null ? 0 : Number(stop.cost_amount)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [scrollTo])

  return (
    <li
      ref={ref}
      className="stop"
      data-kind={stop.kind}
      data-skipped={stop.skipped || undefined}
      data-selected={selected || undefined}
      // The whole row is clickable; the name is a button for keyboard users.
      onClick={() => onSelect(stop.id)}
    >
      <div className="stop-main">
        <button type="button" className="stop-name" aria-pressed={selected}>
          {kindLabel && <span className="stop-badge">{kindLabel}</span>}
          {stop.skipped && (
            <span className="stop-badge stop-badge-skipped">Skipped</span>
          )}
          {stop.name}
        </button>
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
