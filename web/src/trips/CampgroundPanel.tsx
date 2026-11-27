// Campgrounds near a day's last stop (issue #65), in the day list's place
// while open: filters, a list nearest first, and "Add as overnight stop".
// The same campgrounds are highlighted on the map.

import {
  AMENITY_FILTERS,
  campgroundDistanceLabel,
  CAMPGROUND_RADIUS_KM,
  isFilteringCampgrounds,
  type AmenityFilter,
  type CampgroundFilter,
  type NearbyCampground,
} from '../lib/campgrounds'
import { formatMiles } from '../lib/format'
import { categoryInfo, type Suggestion } from '../lib/suggestions'
import { CampgroundDetails } from './CampgroundDetails'
import type { CampgroundsState } from './useCampgrounds'

const RADIUS_MILES = formatMiles(CAMPGROUND_RADIUS_KM / 1.609344)

export function CampgroundPanel({
  dayNumber,
  stopName,
  currentPlaceId,
  state,
  shown,
  filter,
  onFilterChange,
  inTrip,
  onAdd,
  onClose,
}: {
  dayNumber: number
  /** The day's last stop, where the search is centred. */
  stopName: string
  /** The place that stop was added from, when it is a campground. */
  currentPlaceId: number | null
  state: CampgroundsState
  /** The nearby campgrounds that pass the filter, nearest first. */
  shown: readonly NearbyCampground[]
  filter: CampgroundFilter
  onFilterChange: (filter: CampgroundFilter) => void
  /** Ids of the places the trip's stops were added from. */
  inTrip: ReadonlySet<number>
  /** Owners and editors: add a campground as the day's last stop. */
  onAdd?: (place: Suggestion) => void
  onClose: () => void
}) {
  const current = state.nearby.find((c) => c.place.id === currentPlaceId)
  return (
    <section className="campground-panel" aria-labelledby="campground-title">
      <header className="campground-header">
        <h2 id="campground-title">
          {currentPlaceId === null ? 'Campgrounds' : 'Other campgrounds'} near{' '}
          {stopName}
        </h2>
        <button type="button" onClick={onClose}>
          Back to days
        </button>
      </header>
      <p className="campground-intro">
        Day {dayNumber} ends here. Showing campgrounds within {RADIUS_MILES},
        nearest first.
      </p>
      {current && (
        <p className="campground-current">
          Tonight: <strong>{current.place.name}</strong>
        </p>
      )}
      <CampgroundFilters filter={filter} onChange={onFilterChange} />
      <CampgroundsNote state={state} shown={shown.length} />
      {shown.length > 0 && (
        <ol className="campground-list">
          {shown.map(({ place, km }) => (
            <CampgroundRow
              key={place.id}
              place={place}
              km={km}
              dayNumber={dayNumber}
              current={place.id === currentPlaceId}
              inTrip={inTrip.has(place.id)}
              onAdd={onAdd}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function CampgroundRow({
  place,
  km,
  dayNumber,
  current,
  inTrip,
  onAdd,
}: {
  place: Suggestion
  km: number
  dayNumber: number
  current: boolean
  inTrip: boolean
  onAdd?: (place: Suggestion) => void
}) {
  const { label, icon } = categoryInfo(place.category)
  return (
    <li className="campground-row" aria-label={place.name}>
      <h3>{place.name}</h3>
      <p className="suggestion-meta">
        <span aria-hidden="true">{icon}</span> {label} ·{' '}
        {campgroundDistanceLabel(km)}
      </p>
      <CampgroundDetails place={place} />
      {place.osm_url && (
        <p className="suggestion-links">
          <a href={place.osm_url} target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>
        </p>
      )}
      {current ? (
        <p className="suggestion-in-trip">Day {dayNumber}'s overnight stop</p>
      ) : inTrip ? (
        <p className="suggestion-in-trip">In your trip</p>
      ) : (
        onAdd && (
          <button type="button" onClick={() => onAdd(place)}>
            Add as Day {dayNumber}'s overnight stop
          </button>
        )
      )}
    </li>
  )
}

/** What's happening with the search, when there's something to say. */
export function CampgroundsNote({
  state,
  shown,
}: {
  state: CampgroundsState
  shown: number
}) {
  let text: string | null = null
  if (state.error) text = "Couldn't load campgrounds. Try again later."
  else if (state.pending > 0) text = 'Finding campgrounds…'
  else if (state.nearby.length === 0)
    text =
      state.failed > 0
        ? "Couldn't look for campgrounds here yet. Try again later."
        : 'No campgrounds found nearby.'
  else if (shown === 0) text = 'No campgrounds match your filters.'
  if (!text) return null
  return (
    <p className="map-note" role="status">
      {text}
    </p>
  )
}

/** Amenity, fee and ownership filters. */
export function CampgroundFilters({
  filter,
  onChange,
}: {
  filter: CampgroundFilter
  onChange: (filter: CampgroundFilter) => void
}) {
  const toggle = (id: AmenityFilter, on: boolean) => {
    const picked = new Set(filter.amenities)
    if (on) picked.add(id)
    else picked.delete(id)
    onChange({
      ...filter,
      // Kept in panel order, so the saved filter doesn't depend on clicks.
      amenities: AMENITY_FILTERS.map((a) => a.id).filter((id) =>
        picked.has(id),
      ),
    })
  }
  return (
    <fieldset className="campground-filters">
      <legend>Must have</legend>
      {AMENITY_FILTERS.map((amenity) => (
        <label key={amenity.id}>
          <input
            type="checkbox"
            checked={filter.amenities.includes(amenity.id)}
            onChange={(e) => toggle(amenity.id, e.target.checked)}
          />
          {amenity.label}
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={filter.free}
          onChange={(e) => onChange({ ...filter, free: e.target.checked })}
        />
        Free
      </label>
      <label>
        Run by
        <select
          value={filter.ownership}
          onChange={(e) =>
            onChange({
              ...filter,
              ownership: e.target.value as CampgroundFilter['ownership'],
            })
          }
        >
          <option value="any">Anyone</option>
          <option value="public">Public (parks, forests)</option>
          <option value="private">Private</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={filter.confirmedOnly}
          onChange={(e) =>
            onChange({ ...filter, confirmedOnly: e.target.checked })
          }
        />
        Only campgrounds that say so
      </label>
      {isFilteringCampgrounds(filter) && !filter.confirmedOnly && (
        <p className="campground-filters-hint">
          Most campgrounds don't list everything, so those that don't say are
          still shown.
        </p>
      )}
    </fieldset>
  )
}
