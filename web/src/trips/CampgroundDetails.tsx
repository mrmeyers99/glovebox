import { amenityBadges, feeLabel, reservationLabel } from '../lib/campgrounds'
import type { Suggestion } from '../lib/suggestions'

/**
 * What a campground offers, as far as it says: its park, amenity icons, fee,
 * reservations and website. We don't handle bookings; the website does.
 */
export function CampgroundDetails({ place }: { place: Suggestion }) {
  const { amenities } = place
  const badges = amenityBadges(amenities)
  const fee = feeLabel(amenities)
  const reservation = reservationLabel(amenities)
  const facts = [fee, reservation].filter(Boolean).join(' · ')
  return (
    <>
      {place.parent_name && (
        <p className="campground-park">In {place.parent_name}</p>
      )}
      {badges.length > 0 && (
        <ul className="campground-amenities" aria-label="Amenities">
          {badges.map((badge) => (
            <li
              key={badge.key}
              data-no={badge.no || undefined}
              title={badge.no ? `No ${badge.label.toLowerCase()}` : badge.label}
            >
              <span aria-hidden="true">{badge.icon}</span>
              <span className="visually-hidden">
                {badge.no ? `No ${badge.label.toLowerCase()}` : badge.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {facts && <p className="campground-facts">{facts}</p>}
      {amenities?.website && (
        <p className="suggestion-links">
          <a href={amenities.website} target="_blank" rel="noreferrer">
            Website
            {reservation && amenities.reservation !== 'no' && ' & reservations'}
          </a>
        </p>
      )}
    </>
  )
}
