import { Link, useParams } from 'react-router-dom'
import { useTrip } from './useTrip'

// Placeholder: the day list + map editor is the next milestone.
export function TripPage() {
  const { tripId } = useParams()
  const { trip, loading, error, notFound, reload } = useTrip(tripId)

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
      {trip && (
        <>
          <h1>{trip.name}</h1>
          <p>Day list and map coming next.</p>
        </>
      )}
    </main>
  )
}
