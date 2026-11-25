// Day list: days in order with their dates, notes, stops and totals. Owners
// and editors can drag waypoints to reorder them within a day, move them to
// another day, or drop them on the "+ Day N+1" zone to start a new day, and
// set or change the trip's start and end. Each stop has a menu (StopMenu),
// opened from its "⋯" button, a right-click or a long-press.

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
  type Over,
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
  type DaySummary,
  type Leg,
  type TripSummary,
} from '../lib/tripMath'
import { dayColor, type StopSelection } from './mapView'
import {
  dropPlacement,
  moveAnnouncements,
  type DropTarget,
  type Placement,
} from './moveStops'
import { LegItem, TotalsList, TripTotalsBar } from './RouteTotals'
import type { MenuAnchor } from './stopMenu'
import { missingTripEnds, type TripEndKind } from './tripEnds'
import { useStopMenuTrigger } from './useStopMenuTrigger'

/** Opens the form to set the trip's start or end, or change `stop`. */
export type SetTripEnd = (kind: TripEndKind, stop?: Stop) => void

/** Opens stop `stopId`'s menu at `anchor`. */
export type OpenStopMenu = (stopId: string, anchor: MenuAnchor) => void

/** What each draggable stop and drop zone is, on its dnd-kit `data`. */
type DragData =
  | { type: 'stop'; dayId: string }
  | { type: 'day'; dayId: string }
  | { type: 'newDay' }

const NEW_DAY_ID = 'new-day'

function dragData(item: { data: { current?: unknown } } | null | undefined) {
  return item?.data.current as DragData | undefined
}

/**
 * Prefer the "+ Day N+1" zone or the day under the pointer (with the
 * keyboard, the day the dragged stop overlaps most), then the closest stop
 * on that day. A day with no waypoints is a target itself.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  const hits = pointer.length > 0 ? pointer : rectIntersection(args)
  const containers = args.droppableContainers
  for (const hit of hits) {
    const data = dragData(containers.find((c) => c.id === hit.id))
    if (data?.type === 'newDay') return [hit]
    if (data?.type === 'day') {
      const dayStops = containers.filter((c) => {
        const d = dragData(c)
        return d?.type === 'stop' && d.dayId === data.dayId
      })
      return dayStops.length > 0
        ? closestCenter({ ...args, droppableContainers: dayStops })
        : [hit]
    }
  }
  return []
}

/** Where the dragged stop would land if dropped now. */
function dropTargetOf(active: Active, over: Over | null): DropTarget | null {
  const data = dragData(over)
  if (!over || !data) return null
  if (data.type === 'newDay') return { type: 'newDay' }
  if (data.type === 'day') return { type: 'day', dayId: data.dayId }
  // Over the lower half of a stop means after it.
  const rect = active.rect.current.translated
  const after =
    rect !== null &&
    rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2
  return { type: 'stop', dayId: data.dayId, stopId: String(over.id), after }
}

function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Days are stacked, so dragging only moves stops up and down.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/**
 * With `onMoveStop`, waypoints can be dragged by their handle: with a mouse,
 * a touch press-and-hold (so a plain swipe still scrolls), or the keyboard
 * (Space or Enter on the handle, arrows, Space or Enter again).
 */
export function DayListPanel({
  trip,
  days,
  stops,
  summary,
  gasPriceKnown,
  selection,
  onSelectStop,
  onAddStop,
  onMoveStop,
  onSetTripEnd,
  menuStopId,
  onOpenStopMenu,
}: {
  trip: Trip
  days: Day[]
  stops: Stop[]
  /** Legs and totals, from useTripSummary. */
  summary: TripSummary
  /** False while the national average gas price is loading or unavailable. */
  gasPriceKnown: boolean
  selection: StopSelection | null
  onSelectStop: (stopId: string) => void
  /** Shows an Add stop button on each day; pass only for owners and editors. */
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
  /** Makes waypoints draggable; pass only for owners and editors. */
  onMoveStop?: (stop: Stop, placement: Placement) => void
  /**
   * Shows "Set start" / "Set end" prompts while the trip lacks them, and a
   * Change button on them; pass only for owners and editors.
   */
  onSetTripEnd?: SetTripEnd
  /** The stop whose menu is open, if any. */
  menuStopId: string | null
  onOpenStopMenu: OpenStopMenu
}) {
  // Each leg is shown above the stop it arrives at.
  const legsByArrival = useMemo(
    () => new Map(summary.legs.map((leg) => [leg.to.id, leg])),
    [summary.legs],
  )
  const daysById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days])
  const stopsById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])
  // Each day's stops in display order, and its number.
  const stopsByDay = useMemo(
    () =>
      new Map(
        summary.days.map((day) => [
          day.dayId,
          day.stops.flatMap((input) => {
            const stop = stopsById.get(input.id)
            return stop ? [stop] : []
          }),
        ]),
      ),
    [summary.days, stopsById],
  )
  const dayNumbers = useMemo(
    () => new Map(summary.days.map((d) => [d.dayId, d.dayNumber])),
    [summary.days],
  )
  const newDayNumber = summary.days.length + 1
  const missingEnds = useMemo(() => missingTripEnds(stops), [stops])

  // The stop being dragged, and where it would land.
  const [activeStop, setActiveStop] = useState<Stop | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const announcements = useMemo((): Announcements => {
    const name = (id: string) => stopsById.get(id)?.name ?? ''
    // Where a stop on `dayId` is, among that day's waypoints.
    const positionOnDay = (dayId: string, stopId: string) => {
      const waypoints = (stopsByDay.get(dayId) ?? []).filter(
        (s) => s.kind === 'waypoint',
      )
      const i = waypoints.findIndex((s) => s.id === stopId)
      return i === -1
        ? null
        : `position ${i + 1} of ${waypoints.length} on Day ${dayNumbers.get(dayId)}`
    }
    const where = (active: Active, over: Over | null) => {
      const t = dropTargetOf(active, over)
      if (!t) return null
      if (t.type === 'newDay') return `a new Day ${newDayNumber}`
      if (t.type === 'day') return `the end of Day ${dayNumbers.get(t.dayId)}`
      if (stopsById.get(String(active.id))?.day_id === t.dayId)
        return positionOnDay(t.dayId, t.stopId)
      return `Day ${dayNumbers.get(t.dayId)}, ${t.after ? 'after' : 'before'} ${name(t.stopId)}`
    }
    return {
      onDragStart: ({ active }) => {
        const stop = stopsById.get(String(active.id))
        return moveAnnouncements.start(
          name(String(active.id)),
          (stop && positionOnDay(stop.day_id, stop.id)) ?? '',
        )
      },
      onDragOver: ({ active, over }) =>
        moveAnnouncements.over(name(String(active.id)), where(active, over)),
      onDragEnd: ({ active, over }) =>
        moveAnnouncements.end(name(String(active.id)), where(active, over)),
      onDragCancel: ({ active }) =>
        moveAnnouncements.cancel(name(String(active.id))),
    }
  }, [stopsById, stopsByDay, dayNumbers, newDayNumber])

  const onDragMove = useCallback(({ active, over }: DragMoveEvent) => {
    const next = dropTargetOf(active, over)
    setTarget((current) => (sameTarget(current, next) ? current : next))
  }, [])

  const endDrag = useCallback(() => {
    setActiveStop(null)
    setTarget(null)
  }, [])

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      endDrag()
      const stop = stopsById.get(String(active.id))
      const dropTarget = dropTargetOf(active, over)
      if (!stop || !dropTarget || !onMoveStop) return
      const placement = dropPlacement(
        (dayId) => stopsByDay.get(dayId) ?? [],
        stop,
        dropTarget,
      )
      if (placement) onMoveStop(stop, placement)
    },
    [stopsById, stopsByDay, onMoveStop, endDrag],
  )

  if (summary.days.length === 0) {
    return (
      <div className="panel-placeholder">
        <p>This trip has no days yet.</p>
      </div>
    )
  }

  // Drops within the stop's own day show as the list rearranging; drops
  // elsewhere are highlighted on the target.
  const crossDayTarget =
    activeStop &&
    target &&
    !(target.type !== 'newDay' && target.dayId === activeStop.day_id)
      ? target
      : null

  return (
    <>
      <TripTotalsBar totals={summary.totals} gasPriceKnown={gasPriceKnown} />
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        modifiers={[verticalOnly]}
        accessibility={{ announcements }}
        onDragStart={({ active }) =>
          setActiveStop(stopsById.get(String(active.id)) ?? null)
        }
        onDragMove={onDragMove}
        onDragOver={onDragMove}
        onDragCancel={endDrag}
        onDragEnd={onDragEnd}
      >
        {/* Legs are hidden (keeping their space) while dragging: they'd be
            wrong until the drop, and the stops slide over them. */}
        <ol className="day-list" data-dragging={activeStop ? true : undefined}>
          {summary.days.map((day, i) => (
            <DayCard
              key={day.dayId}
              summary={day}
              notes={daysById.get(day.dayId)?.notes ?? null}
              date={dayDate(trip.start_date, day.dayNumber)}
              stops={stopsByDay.get(day.dayId) ?? []}
              stopsById={stopsById}
              legsByArrival={legsByArrival}
              gasPriceKnown={gasPriceKnown}
              selection={selection}
              dropTarget={
                crossDayTarget?.type !== 'newDay' &&
                crossDayTarget?.dayId === day.dayId
                  ? crossDayTarget
                  : null
              }
              onSelectStop={onSelectStop}
              onAddStop={onAddStop}
              canMove={onMoveStop !== undefined}
              onSetTripEnd={onSetTripEnd}
              menuStopId={menuStopId}
              onOpenStopMenu={onOpenStopMenu}
              promptStart={i === 0 && missingEnds.has('start')}
              promptEnd={
                i === summary.days.length - 1 && missingEnds.has('end')
              }
            />
          ))}
        </ol>
        <DragOverlay dropAnimation={null}>
          {activeStop && <DraggedStop stop={activeStop} />}
        </DragOverlay>
        {onMoveStop && (
          <NewDayZone dayNumber={newDayNumber} dragging={activeStop !== null} />
        )}
      </DndContext>
    </>
  )
}

/** Drop a stop here to add a day after the last one and move it there. */
function NewDayZone({
  dayNumber,
  dragging,
}: {
  dayNumber: number
  dragging: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: NEW_DAY_ID,
    data: { type: 'newDay' } satisfies DragData,
  })
  return (
    <div
      ref={setNodeRef}
      className="day-new"
      data-dragging={dragging || undefined}
      data-over={isOver || undefined}
    >
      <span className="day-new-label">+ Day {dayNumber}</span>
      <span className="day-new-hint">Drag a stop here to start a new day</span>
    </div>
  )
}

function DayCard({
  summary,
  notes,
  date,
  stops,
  stopsById,
  legsByArrival,
  gasPriceKnown,
  selection,
  dropTarget,
  onSelectStop,
  onAddStop,
  canMove,
  onSetTripEnd,
  menuStopId,
  onOpenStopMenu,
  promptStart,
  promptEnd,
}: {
  summary: DaySummary
  notes: string | null
  date: string | null
  /** The day's stops in display order. */
  stops: Stop[]
  stopsById: Map<string, Stop>
  legsByArrival: Map<string, Leg>
  gasPriceKnown: boolean
  selection: StopSelection | null
  /** Set while a stop from another day is dragged over this one. */
  dropTarget: Exclude<DropTarget, { type: 'newDay' }> | null
  onSelectStop: (stopId: string) => void
  onAddStop?: (day: { dayId: string; dayNumber: number }) => void
  canMove: boolean
  onSetTripEnd?: SetTripEnd
  menuStopId: string | null
  onOpenStopMenu: OpenStopMenu
  /** This is the first day and the trip has no start. */
  promptStart: boolean
  /** This is the last day and the trip has no end. */
  promptEnd: boolean
}) {
  const headingId = `day-${summary.dayId}`
  // The whole card is a drop zone, so stops can land on a rest day.
  const { setNodeRef } = useDroppable({
    id: `day:${summary.dayId}`,
    data: { type: 'day', dayId: summary.dayId } satisfies DragData,
    disabled: !canMove,
  })

  return (
    <li
      ref={setNodeRef}
      className="day-card"
      aria-labelledby={headingId}
      data-drop-target={dropTarget ? true : undefined}
    >
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

      {onSetTripEnd && promptStart && (
        <TripEndPrompt kind="start" onSetTripEnd={onSetTripEnd} />
      )}

      {stops.length === 0 ? (
        !(onSetTripEnd && (promptStart || promptEnd)) && (
          <p className="day-rest">Rest day</p>
        )
      ) : (
        <StopList
          dayId={summary.dayId}
          stops={stops}
          stopsById={stopsById}
          legsByArrival={legsByArrival}
          selection={selection}
          dropTarget={dropTarget?.type === 'stop' ? dropTarget : null}
          onSelectStop={onSelectStop}
          canMove={canMove}
          onSetTripEnd={onSetTripEnd}
          menuStopId={menuStopId}
          onOpenStopMenu={onOpenStopMenu}
        />
      )}

      {onSetTripEnd && promptEnd && (
        <TripEndPrompt kind="end" onSetTripEnd={onSetTripEnd} />
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

/** Where the trip's start or end will go, until it's set. */
function TripEndPrompt({
  kind,
  onSetTripEnd,
}: {
  kind: TripEndKind
  onSetTripEnd: SetTripEnd
}) {
  return (
    <button
      type="button"
      className="trip-end-prompt"
      data-kind={kind}
      onClick={() => onSetTripEnd(kind)}
    >
      <span className="stop-badge">{KIND_LABELS[kind]}</span>
      {kind === 'start' ? 'Set start' : 'Set end'}
    </button>
  )
}

/**
 * A day's stops in order, each with the leg arriving at it. With `canMove`,
 * waypoints can be dragged by their handle. With `onSetTripEnd`, the start
 * and end have a Change button.
 */
function StopList({
  dayId,
  stops,
  stopsById,
  legsByArrival,
  selection,
  dropTarget,
  onSelectStop,
  canMove,
  onSetTripEnd,
  menuStopId,
  onOpenStopMenu,
}: {
  dayId: string
  /** The day's stops in display order. */
  stops: Stop[]
  stopsById: Map<string, Stop>
  legsByArrival: Map<string, Leg>
  selection: StopSelection | null
  /** Set while a stop from another day is dragged over one of these. */
  dropTarget: Extract<DropTarget, { type: 'stop' }> | null
  onSelectStop: (stopId: string) => void
  canMove: boolean
  onSetTripEnd?: SetTripEnd
  menuStopId: string | null
  onOpenStopMenu: OpenStopMenu
}) {
  const waypointIds = useMemo(
    () => stops.filter((s) => s.kind === 'waypoint').map((s) => s.id),
    [stops],
  )

  const items = stops.map((stop) => {
    const leg = legsByArrival.get(stop.id)
    const endKind = stop.kind === 'waypoint' ? null : stop.kind
    const selected = selection?.stopId === stop.id
    const props = {
      stop,
      selected,
      // Scroll to stops picked on the map, not ones clicked here.
      scrollTo: selected && selection.source === 'map' ? selection : null,
      dropSide:
        dropTarget?.stopId === stop.id
          ? dropTarget.after
            ? ('after' as const)
            : ('before' as const)
          : undefined,
      onSelect: onSelectStop,
      menuOpen: menuStopId === stop.id,
      onOpenMenu: onOpenStopMenu,
    }
    return (
      <Fragment key={stop.id}>
        {leg && (
          <LegItem
            leg={leg}
            fromName={stopsById.get(leg.from.id)?.name ?? ''}
          />
        )}
        {canMove && stop.kind === 'waypoint' ? (
          <SortableStopItem {...props} dayId={dayId} />
        ) : (
          <StopItem
            {...props}
            action={
              onSetTripEnd && endKind ? (
                <button
                  type="button"
                  className="stop-action"
                  aria-label={`Change the trip's ${endKind}`}
                  // Changing the stop shouldn't also select it.
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetTripEnd(endKind, stop)
                  }}
                >
                  Change
                </button>
              ) : undefined
            }
          />
        )}
      </Fragment>
    )
  })

  if (!canMove) return <ol className="stop-list">{items}</ol>

  return (
    <SortableContext items={waypointIds} strategy={verticalListSortingStrategy}>
      <ol className="stop-list">{items}</ol>
    </SortableContext>
  )
}

type StopItemProps = {
  stop: Stop
  selected: boolean
  /** Set (a new object each time) when the list should scroll to this stop. */
  scrollTo: StopSelection | null
  /** Where a stop dragged from another day would land, next to this one. */
  dropSide?: 'before' | 'after'
  onSelect: (stopId: string) => void
  /** This stop's menu is open. */
  menuOpen?: boolean
  /** Gives the stop a "⋯" menu button, right-click and long-press menu. */
  onOpenMenu?: OpenStopMenu
}

function SortableStopItem({
  dayId,
  ...props
}: StopItemProps & { dayId: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.stop.id,
    data: { type: 'stop', dayId } satisfies DragData,
  })

  return (
    <StopItem
      {...props}
      nodeRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      placeholder={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="stop-handle"
          {...attributes}
          {...listeners}
          aria-label={`Move ${props.stop.name}`}
          // Dragging by the handle shouldn't also select the stop.
          onClick={(e) => e.stopPropagation()}
        >
          <GripIcon />
        </button>
      }
    />
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
      {[3, 8, 13].map((y) => (
        <Fragment key={y}>
          <circle cx="2.5" cy={y} r="1.5" />
          <circle cx="7.5" cy={y} r="1.5" />
        </Fragment>
      ))}
    </svg>
  )
}

/** The stop being dragged, following the pointer across days. */
function DraggedStop({ stop }: { stop: Stop }) {
  return (
    <ol className="stop-list">
      <StopItem
        stop={stop}
        selected={false}
        scrollTo={null}
        onSelect={() => {}}
        dragging
        handle={
          <span className="stop-handle">
            <GripIcon />
          </span>
        }
      />
    </ol>
  )
}

const KIND_LABELS = { start: 'Start', end: 'End' } as const

function StopItem({
  stop,
  selected,
  scrollTo,
  dropSide,
  onSelect,
  menuOpen,
  onOpenMenu,
  nodeRef,
  style,
  placeholder,
  dragging,
  handle,
  action,
}: StopItemProps & {
  nodeRef?: (node: HTMLLIElement | null) => void
  style?: CSSProperties
  /** The stop's place in the list while it's being dragged. */
  placeholder?: boolean
  /** The copy of the stop that follows the pointer. */
  dragging?: boolean
  /** A drag handle, shown before the stop's details. */
  handle?: ReactNode
  /** A button shown after the stop's name, e.g. to change it. */
  action?: ReactNode
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

  const menuButton = useRef<HTMLButtonElement>(null)
  const openMenu = useMemo(
    () => onOpenMenu && ((anchor: MenuAnchor) => onOpenMenu(stop.id, anchor)),
    [onOpenMenu, stop.id],
  )
  const menuButtonNode = useCallback(() => menuButton.current, [])
  const menuTrigger = useStopMenuTrigger(openMenu, {
    returnFocus: menuButtonNode,
    // A long-press on the handle starts a drag instead.
    ignoreSelector: '.stop-handle',
  })

  return (
    <li
      ref={setRef}
      className="stop"
      style={style}
      data-kind={stop.kind}
      data-skipped={stop.skipped || undefined}
      data-selected={selected || undefined}
      data-placeholder={placeholder || undefined}
      data-dragging={dragging || undefined}
      data-drop={dropSide}
      data-sortable={handle ? true : undefined}
      data-menu-open={menuOpen || undefined}
      // The whole row is clickable; the name is a button for keyboard users.
      onClick={() => onSelect(stop.id)}
      {...(openMenu ? menuTrigger : {})}
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
          {action}
          {openMenu && (
            <button
              type="button"
              ref={menuButton}
              className="stop-menu-button"
              aria-label={`Actions for ${stop.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen ?? false}
              // Opening the menu shouldn't also select the stop.
              onClick={(e) => {
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                openMenu({
                  x: rect.left,
                  y: rect.bottom,
                  returnFocus: e.currentTarget,
                })
              }}
            >
              ⋯
            </button>
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
