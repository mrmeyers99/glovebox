import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Trip } from '../lib/database.types'
import { AddStopDialog } from './AddStopDialog'
import { DayListPanel } from './DayListPanel'
import { MapPanel } from './MapPanel'
import type { StopSelection } from './mapView'
import { ShareDialog } from './ShareDialog'
import { TripSettingsDialog } from './TripSettingsDialog'
import { useReorderStop } from './useReorderStop'
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
  const reorder = useReorderStop(dispatch)
  // Called before the early return below (hooks can't be conditional).
  const { summary, gasPriceKnown } = useTripSummary(trip, days, stops)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [addStopDay, setAddStopDay] = useState<{
    dayId: string
    dayNumber: number
  } | null>(null)
  // Which panel shows at phone width; desktop shows both.
  const [view, setView] = useState<View>('list')
  // Stop selected in the day list or on the map; the other panel follows.
  const [selection, setSelection] = useState<StopSelection | null>(null)
  const selectFromList = useCallback(
    (stopId: string) => setSelection({ stopId, source: 'list' }),
    [],
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
        {reorder.error && (
          <p role="alert" className="error panel-alert">
            {reorder.error}{' '}
            <button type="button" onClick={reorder.clearError}>
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
          onAddStop={canEdit ? setAddStopDay : undefined}
          onMoveStop={canEdit ? reorder.move : undefined}
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
        />
      </section>

      {settingsOpen && (
        <TripSettingsDialog
          trip={trip}
          dispatch={dispatch}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {addStopDay && canEdit && (
        <AddStopDialog
          tripId={trip.id}
          dayId={addStopDay.dayId}
          dayNumber={addStopDay.dayNumber}
          days={days}
          stops={stops}
          dispatch={dispatch}
          onClose={() => setAddStopDay(null)}
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
