import { campgroundDistanceLabel } from '../lib/campgrounds'
import { distanceFromRoute, haversineKm, type LatLng } from '../lib/corridor'
import {
  categoryInfo,
  routeDistanceLabel,
  type Suggestion,
} from '../lib/suggestions'
import { CampgroundDetails } from './CampgroundDetails'

/** What a suggested place is, shown when its marker is clicked. */
export function SuggestionCard({
  place,
  lines,
  inTrip,
  onAdd,
  from,
  addLabel = 'Add to trip',
}: {
  place: Suggestion
  /** Route lines, for the distance from the route. */
  lines: LatLng[][]
  /** A stop was already added from this place. */
  inTrip: boolean
  /** Owners and editors: add the place to the trip as a stop. */
  onAdd?: (place: Suggestion) => void
  /** Give the distance from this point (a stop) instead of from the route. */
  from?: LatLng
  addLabel?: string
}) {
  const { label, icon } = categoryInfo(place.category)
  const distance = from
    ? campgroundDistanceLabel(haversineKm(from, [place.lat, place.lng]))
    : routeDistanceLabel(distanceFromRoute([place.lat, place.lng], lines))
  const { image } = place
  return (
    <article className="suggestion-card" aria-label={place.name}>
      {image && (
        <figure>
          <img src={image.thumbnail_url} alt="" loading="lazy" />
          <figcaption>
            <a href={image.page_url} target="_blank" rel="noreferrer">
              {[image.credit ?? 'Photo', image.license]
                .filter(Boolean)
                .join(' · ')}
            </a>
            {' / Wikimedia Commons'}
          </figcaption>
        </figure>
      )}
      <h3>{place.name}</h3>
      <p className="suggestion-meta">
        <span aria-hidden="true">{icon}</span> {label}
        {distance && <> · {distance}</>}
      </p>
      {place.kind === 'campground' && <CampgroundDetails place={place} />}
      {(place.wikipedia_url || place.osm_url) && (
        <p className="suggestion-links">
          {place.wikipedia_url && (
            <a href={place.wikipedia_url} target="_blank" rel="noreferrer">
              Wikipedia
            </a>
          )}
          {place.osm_url && (
            <a href={place.osm_url} target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>
          )}
        </p>
      )}
      {inTrip ? (
        <p className="suggestion-in-trip">In your trip</p>
      ) : (
        onAdd && (
          <button type="button" onClick={() => onAdd(place)}>
            {addLabel}
          </button>
        )
      )}
    </article>
  )
}
