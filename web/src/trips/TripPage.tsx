import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Stop, Trip } from '../lib/database.types'
import type { LatLng } from '../lib/geocode'
import { DayListPanel } from './DayListPanel'
import { defaultDropDay } from './mapAdd'
import { MapPanel } from './MapPanel'
import type { StopSelection } from './mapView'
import { PresenceAvatars } from './PresenceAvatars'
import { editingFocus } from './presence'
import { ShareDialog } from './ShareDialog'
import { StopDialog, type StopDialogMode } from './StopDialog'
import { TripEndDialog } from './TripEndDialog'
import type { TripEndKind } from './tripEnds'
import { TripSettingsDialog } from './TripSettingsDialog'
import { dropPlacement } from './moveStops'
import { StopMenu } from './StopMenu'
import type { MenuAnchor } from './stopMenu'
import { useMoveStop } from './useMoveStop'
import { usePresence } from './usePresence'
import { useTrip } from './useTrip'
import { useTripSummary } from './useTripSummary'

type View = 'list' | 'map'

export function TripPage() {
  const { tripId } = useParams()
  const {
    trip,
    role,
    days,
    stops,
    canEdit,
    loading,
    error,
    notFound,
    reload,
    dispatch,
  } = useTrip(tripId)
  const stopUpdates = useMoveStop(dispatch, days, stops)
  // Called before the early return below (hooks can't be conditional).
  const { summary, gasPriceKnown } = useTripSummary(trip, days, stops)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // The stop dialog: adding to a day (optionally at a spot picked on the
  // map), or the id of the stop opened.
  const [stopDialog, setStopDialog] = useState<
    | { type: 'add'; dayId: string; dayNumber: number; at?: LatLng }
    | { type: 'edit' | 'delete'; stopId: string }
    | null
  >(null)
  // The open stop menu, and where it opened.
  const [stopMenu, setStopMenu] = useState<{
    stopId: string
    anchor: MenuAnchor
  } | null>(null)
  const openStopMenu = useCallback(
    (stopId: string, anchor: MenuAnchor) => setStopMenu({ stopId, anchor }),
    [],
  )
  const closeStopMenu = useCallback(() => setStopMenu(null), [])
  // The start or end being set (no stop) or changed.
  const [tripEnd, setTripEnd] = useState<{
    kind: TripEndKind
    stop?: Stop
  } | null>(null)
  const openTripEnd = useCallback(
    (kind: TripEndKind, stop?: Stop) => setTripEnd({ kind, stop }),
    [],
  )
  // Which panel shows at phone width; desktop shows both.
  const [view, setView] = useState<View>('list')
  // Stop selected in the day list or on the map; the other panel follows.
  const [selection, setSelection] = useState<StopSelection | null>(null)
  // Clicking a stop in the list selects it and opens its details.
  const selectFromList = useCallback((stopId: string) => {
    setSelection({ stopId, source: 'list' })
    setStopDialog({ type: 'edit', stopId })
  }, [])
  const openAddStop = useCallback(
    (day: { dayId: string; dayNumber: number }) =>
      setStopDialog({ type: 'add', ...day }),
    [],
  )
  // A spot picked on the map goes to the selected stop's day, else the last.
  const addStopAt = useCallback(
    (at: LatLng) => {
      const day = defaultDropDay(days, stops, selection?.stopId ?? null)
      if (day) setStopDialog({ type: 'add', ...day, at })
    },
    [days, stops, selection],
  )
  // Resolved on every render so the dialog follows live changes; it closes
  // if the stop is deleted meanwhile.
  const stopDialogMode = useMemo((): StopDialogMode | null => {
    if (stopDialog?.type === 'add' || !stopDialog) return stopDialog
    const stop = stops.find((s) => s.id === stopDialog.stopId)
    const day = summary.days.find((d) => d.dayId === stop?.day_id)
    return stop && day
      ? { type: stopDialog.type, stop, dayNumber: day.dayNumber }
      : null
  }, [stopDialog, stops, summary.days])
  // The stop whose menu is open; it closes if the stop is deleted meanwhile.
  const menuStop = stopMenu
    ? stops.find((s) => s.id === stopMenu.stopId)
    : undefined
  // Forget it too, rather than keep state for a menu that can't show.
  if (stopMenu && !menuStop && !loading) setStopMenu(null)
  const menuDays = useMemo(
    () => summary.days.map(({ dayId, dayNumber }) => ({ dayId, dayNumber })),
    [summary.days],
  )
  // Move to the end of a day (before its end stop) or a new day at the end,
  // as dropping the stop there does.
  function moveToDay(stop: Stop, dayId: string | null) {
    const placement = dropPlacement(
      (id) => summary.days.find((d) => d.dayId === id)?.stops ?? [],
      stop,
      dayId === null ? { type: 'newDay' } : { type: 'day', dayId },
    )
    if (placement) void stopUpdates.move(stop, placement)
  }
  const presence = usePresence(
    trip ? tripId : undefined,
    editingFocus(canEdit, stopDialogMode, tripEnd?.stop?.id),
  )
  const selectFromMap = useCallback(
    (stopId: string) => setSelection({ stopId, source: 'map' }),
    [],
  )

  if (!trip) {
    return (
      <main className="page">
        <p>
          <Link to="/">← All trips</Link>
        </p>
        {loading && <p>Loading…</p>}
        {error && (
          <p role="alert" className="error">
            Couldn't load this trip: {error}{' '}
            <button type="button" onClick={reload}>
              Try again
            </button>
          </p>
        )}
        {notFound && (
          <p role="alert">
            This trip doesn't exist, or you don't have access to it.
          </p>
        )}
      </main>
    )
  }

  return (
    <div className="trip-layout" data-view={view}>
      <header className="trip-header">
        <Link to="/" className="trip-back" aria-label="All trips">
          ←
        </Link>
        <div className="trip-title">
          <h1>{trip.name}</h1>
          <TripSummary trip={trip} />
        </div>
        <PresenceAvatars peers={presence.peers} />
        <button type="button" onClick={() => setShareOpen(true)}>
          Share
        </button>
        {canEdit && (
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        )}
      </header>

      <div className="trip-tabs" role="tablist" aria-label="Trip view">
        <ViewTab view="list" current={view} onSelect={setView}>
          List
        </ViewTab>
        <ViewTab view="map" current={view} onSelect={setView}>
          Map
        </ViewTab>
      </div>

      <section
        id="trip-panel-list"
        className="trip-panel trip-panel-list"
        aria-label="Days and stops"
      >
        {stopUpdates.error && (
          <p role="alert" className="error panel-alert">
            {stopUpdates.error}{' '}
            <button type="button" onClick={stopUpdates.clearError}>
              Dismiss
            </button>
          </p>
        )}
        <DayListPanel
          trip={trip}
          days={days}
          stops={stops}
          summary={summary}
          gasPriceKnown={gasPriceKnown}
          selection={selection}
          onSelectStop={selectFromList}
          onAddStop={canEdit ? openAddStop : undefined}
          onMoveStop={canEdit ? stopUpdates.move : undefined}
          onSetTripEnd={canEdit ? openTripEnd : undefined}
          menuStopId={menuStop?.id ?? null}
          onOpenStopMenu={openStopMenu}
          presence={presence.index}
        />
      </section>
      <section
        id="trip-panel-map"
        className="trip-panel trip-panel-map"
        aria-label="Map"
      >
        <MapPanel
          days={days}
          stops={stops}
          summary={summary}
          selection={selection}
          onSelectStop={selectFromMap}
          onAddStopAt={canEdit && days.length > 0 ? addStopAt : undefined}
        />
      </section>

      {settingsOpen && (
        <TripSettingsDialog
          trip={trip}
          dispatch={dispatch}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {stopMenu && menuStop && (
        <StopMenu
          stop={menuStop}
          anchor={stopMenu.anchor}
          canEdit={canEdit}
          days={menuDays}
          onMoveToDay={(dayId) => moveToDay(menuStop, dayId)}
          onSetSkipped={(skipped) =>
            void stopUpdates.setSkipped(menuStop, skipped)
          }
          onOpen={() => selectFromList(menuStop.id)}
          onDelete={() =>
            setStopDialog({ type: 'delete', stopId: menuStop.id })
          }
          onClose={closeStopMenu}
        />
      )}
      {stopDialogMode && (stopDialogMode.type === 'edit' || canEdit) && (
        <StopDialog
          // A fresh form for each stop opened.
          key={
            stopDialogMode.type === 'add'
              ? stopDialogMode.at
                ? `add:${stopDialogMode.at.lat},${stopDialogMode.at.lng}`
                : `add:${stopDialogMode.dayId}`
              : `${stopDialogMode.type}:${stopDialogMode.stop.id}`
          }
          tripId={trip.id}
          mode={stopDialogMode}
          canEdit={canEdit}
          days={days}
          stops={stops}
          dispatch={dispatch}
          onClose={() => setStopDialog(null)}
        />
      )}
      {tripEnd && canEdit && (
        <TripEndDialog
          tripId={trip.id}
          kind={tripEnd.kind}
          stop={tripEnd.stop}
          days={days}
          stops={stops}
          dispatch={dispatch}
          onClose={() => setTripEnd(null)}
        />
      )}
      {shareOpen && role && (
        <ShareDialog
          trip={trip}
          role={role}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  )
}

function TripSummary({ trip }: { trip: Trip }) {
  return (
    <p className="trip-meta">
      {trip.start_date
        ? `Starts ${formatDate(trip.start_date)}`
        : 'No start date'}
      {' · '}
      {trip.mpg} mpg
      {' · '}
      {trip.gas_price_per_gallon === null
        ? 'national avg. gas price'
        : `${formatPrice(trip.gas_price_per_gallon)}/gal`}
    </p>
  )
}

function formatPrice(price: number) {
  return price.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 3,
  })
}

/** Formats a YYYY-MM-DD date without shifting it across time zones. */
function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function ViewTab({
  view,
  current,
  onSelect,
  children,
}: {
  view: View
  current: View
  onSelect: (view: View) => void
  children: string
}) {
  const selected = view === current
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`trip-panel-${view}`}
      className="trip-tab"
      onClick={() => onSelect(view)}
    >
      {children}
    </button>
  )
}
