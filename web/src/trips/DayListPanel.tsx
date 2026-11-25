// Day list: days in order with their dates, notes, stops and totals. Owners
// and editors can drag waypoints to reorder them within a day.

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Day, Stop, Trip } from '../lib/database.types'
import { formatDayDate, formatMoney, formatTimeOfDay } from '../lib/format'
import {
  dayDate,
  summarizeTrip,
  type DaySummary,
  type Leg,
} from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { effectiveGasPrice } from '../lib/gasPrice'
import { dayColor, type StopSelection } from './mapView'
import { reorderAnnouncements, reorderedPosition } from './reorderStops'
import { LegItem, TotalsList, TripTotalsBar } from './RouteTotals'
import { useNationalAverage } from './useNationalAverage'
import { useRoutes } from './useRoutes'

export function DayListPanel({
  trip,
  days,
  stops,
  selection,
  onSelectStop,
  onAddStop,
  onMoveStop,
}: {
  trip: Trip
  days: Day[]
  stops: Stop[]
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  /** Shows an Add stop button on each day; pass only for owners and editors. */
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
  /** Makes waypoints draggable; pass only for owners and editors. */
  onMoveStop?: (stop: Stop, position: string) => void
}) {
  // The trip's own price, else the national average (null until it loads).
  const nationalAverage = useNationalAverage()
  const gasPrice = effectiveGasPrice(trip.gas_price_per_gallon, nationalAverage)
  const gasPriceKnown = gasPrice !== null
  const mpg = Number(trip.mpg)

  const dayInputs = useMemo(() => days.map(toDayInput), [days])
  const stopInputs = useMemo(() => stops.map(toStopInput), [stops])
  // The legs the trip needs, before any routes are known.
  const neededLegs = useMemo(
    () =>
      summarizeTrip(dayInputs, stopInputs, {
        mpg,
        gasPricePerGallon: gasPrice ?? 0,
        route: () => undefined,
      }).legs,
    [dayInputs, stopInputs, mpg, gasPrice],
  )
  const route = useRoutes(neededLegs)
  const summary = useMemo(
    () =>
      summarizeTrip(dayInputs, stopInputs, {
        mpg,
        gasPricePerGallon: gasPrice ?? 0,
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
            selection={selection}
            onSelectStop={onSelectStop}
            onAddStop={onAddStop}
            onMoveStop={onMoveStop}
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
  selection,
  onSelectStop,
  onAddStop,
  onMoveStop,
}: {
  summary: DaySummary
  notes: string | null
  date: string | null
  stopsById: Map<string, Stop>
  legsByArrival: Map<string, Leg>
  gasPriceKnown: boolean
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
  onMoveStop?: (stop: Stop, position: string) => void
}) {
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
        <StopList
          stops={summary.stops.flatMap((input) => {
            const stop = stopsById.get(input.id)
            return stop ? [stop] : []
          })}
          stopsById={stopsById}
          legsByArrival={legsByArrival}
          selection={selection}
          onSelectStop={onSelectStop}
          onMoveStop={onMoveStop}
        />
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

      <TotalsList
        totals={summary}
        gasPriceKnown={gasPriceKnown}
        className="day-totals"
      />
    </li>
  )
}

// Dragging only moves stops up and down.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/**
 * A day's stops in order, each with the leg arriving at it. With
 * `onMoveStop`, waypoints can be dragged by their handle to reorder them:
 * with a mouse, a touch press-and-hold (so a plain swipe still scrolls), or
 * the keyboard (Space or Enter on the handle, arrows, Space or Enter again).
 */
function StopList({
  stops,
  stopsById,
  legsByArrival,
  selection,
  onSelectStop,
  onMoveStop,
}: {
  /** The day's stops in display order. */
  stops: Stop[]
  stopsById: Map<string, Stop>
  legsByArrival: Map<string, Leg>
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  onMoveStop?: (stop: Stop, position: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const waypointIds = useMemo(
    () => stops.filter((s) => s.kind === 'waypoint').map((s) => s.id),
    [stops],
  )
  const sortable = onMoveStop !== undefined && waypointIds.length > 1

  const announcements = useMemo((): Announcements => {
    const name = (id: UniqueIdentifier) => stopsById.get(String(id))?.name ?? ''
    const index = (id: UniqueIdentifier | undefined) => {
      const i = id === undefined ? -1 : waypointIds.indexOf(String(id))
      return i === -1 ? null : i
    }
    const count = waypointIds.length
    return {
      onDragStart: ({ active }) =>
        reorderAnnouncements.start(name(active.id), index(active.id)!, count),
      onDragOver: ({ active, over }) =>
        reorderAnnouncements.over(name(active.id), index(over?.id), count),
      onDragEnd: ({ active, over }) =>
        reorderAnnouncements.end(name(active.id), index(over?.id), count),
      onDragCancel: ({ active }) =>
        reorderAnnouncements.cancel(name(active.id)),
    }
  }, [stopsById, waypointIds])

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setDragging(false)
      if (!over || !onMoveStop) return
      const stop = stopsById.get(String(active.id))
      const position = reorderedPosition(
        stops,
        String(active.id),
        String(over.id),
      )
      if (stop && position !== null) onMoveStop(stop, position)
    },
    [stops, stopsById, onMoveStop],
  )

  const items = stops.map((stop) => {
    const leg = legsByArrival.get(stop.id)
    const selected = selection?.stopId === stop.id
    const props = {
      stop,
      selected,
      // Scroll to stops picked on the map, not ones clicked here.
      scrollTo: selected && selection.source === 'map' ? selection : null,
      onSelect: onSelectStop,
    }
    return (
      <Fragment key={stop.id}>
        {leg && (
          <LegItem
            leg={leg}
            fromName={stopsById.get(leg.from.id)?.name ?? ''}
          />
        )}
        {sortable && stop.kind === 'waypoint' ? (
          <SortableStopItem {...props} />
        ) : (
          <StopItem {...props} />
        )}
      </Fragment>
    )
  })

  if (!sortable) return <ol className="stop-list">{items}</ol>

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={{ announcements }}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={waypointIds}
        strategy={verticalListSortingStrategy}
      >
        {/* Legs are hidden (keeping their space) while dragging: they'd be
            wrong until the drop, and the stops slide over them. */}
        <ol className="stop-list" data-dragging={dragging || undefined}>
          {items}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

type StopItemProps = {
  stop: Stop
  selected: boolean
  /** Set (a new object each time) when the list should scroll to this stop. */
  scrollTo: StopSelection | null
  onSelect: (stopId: string) => void
}

function SortableStopItem(props: StopItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.stop.id })

  return (
    <StopItem
      {...props}
      nodeRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="stop-handle"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${props.stop.name}`}
          // Dragging by the handle shouldn't also select the stop.
          onClick={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
            {[3, 8, 13].map((y) => (
              <Fragment key={y}>
                <circle cx="2.5" cy={y} r="1.5" />
                <circle cx="7.5" cy={y} r="1.5" />
              </Fragment>
            ))}
          </svg>
        </button>
      }
    />
  )
}

const KIND_LABELS = { start: 'Start', end: 'End' } as const

function StopItem({
  stop,
  selected,
  scrollTo,
  onSelect,
  nodeRef,
  style,
  dragging,
  handle,
}: StopItemProps & {
  nodeRef?: (node: HTMLLIElement | null) => void
  style?: CSSProperties
  dragging?: boolean
  /** A drag handle, shown before the stop's details. */
  handle?: ReactNode
}) {
  const kindLabel = stop.kind === 'waypoint' ? null : KIND_LABELS[stop.kind]
  const cost = stop.cost_amount == null ? 0 : Number(stop.cost_amount)
  const ref = useRef<HTMLLIElement>(null)
  const setRef = useCallback(
    (node: HTMLLIElement | null) => {
      ref.current = node
      nodeRef?.(node)
    },
    [nodeRef],
  )

  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [scrollTo])

  return (
    <li
      ref={setRef}
      className="stop"
      style={style}
      data-kind={stop.kind}
      data-skipped={stop.skipped || undefined}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      data-sortable={handle ? true : undefined}
      // The whole row is clickable; the name is a button for keyboard users.
      onClick={() => onSelect(stop.id)}
    >
      {handle}
      <div className="stop-body">
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
      </div>
    </li>
  )
}
