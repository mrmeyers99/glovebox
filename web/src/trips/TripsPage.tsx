import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Trip } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export function TripsPage() {
  const navigate = useNavigate()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('trips')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTrips(data)
      })
  }, [])

  async function createTrip(event: FormEvent) {
    event.preventDefault()
    const { data, error } = await supabase
      .from('trips')
      .insert({ name: name.trim() })
      .select()
      .single()
    if (error) {
      setError(error.message)
      return
    }
    // Every trip starts with Day 1.
    const { error: dayError } = await supabase
      .from('days')
      .insert({ trip_id: data.id, position: 'a0' })
    if (dayError) setError(dayError.message)
    else navigate(`/trips/${data.id}`)
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Your trips</h1>
        <button type="button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <form className="inline-form" onSubmit={createTrip}>
        <label htmlFor="trip-name">New trip</label>
        <input
          id="trip-name"
          required
          maxLength={200}
          placeholder="Cross-country 2027"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">Create</button>
      </form>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {trips === null ? (
        <p>Loading…</p>
      ) : trips.length === 0 ? (
        <p>No trips yet.</p>
      ) : (
        <ul className="trip-list">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link to={`/trips/${trip.id}`}>{trip.name}</Link>
              {trip.start_date && <span> · starts {trip.start_date}</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
