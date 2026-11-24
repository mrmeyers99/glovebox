import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Trip } from '../lib/database.types'
import { supabase } from '../lib/supabase'

// Placeholder: the day list + map editor is the next milestone.
export function TripPage() {
  const { tripId } = useParams()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId) return
    supabase
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTrip(data)
      })
  }, [tripId])

  return (
    <main className="page">
      <p>
        <Link to="/">← All trips</Link>
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
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
