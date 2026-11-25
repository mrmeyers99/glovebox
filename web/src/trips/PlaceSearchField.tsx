import { useState, type KeyboardEvent } from 'react'
import type { LatLng, Place } from '../lib/geocode'
import { placeQuery } from './addStop'
import { usePlaceSearch } from './usePlaceSearch'

/**
 * A place search box with its results, for a form. Picking a result (or
 * pressing Enter for the top one) calls `onPick` and clears the search.
 */
export function PlaceSearchField({
  id,
  label = 'Place',
  place,
  focus,
  error,
  onPick,
}: {
  id: string
  label?: string
  /** The place picked so far, shown under the box. */
  place: Place | null
  /** Where to bias results toward. */
  focus?: LatLng
  error?: string
  onPick: (place: Place) => void
}) {
  const [query, setQuery] = useState('')
  const search = usePlaceSearch(query, focus)
  const pickedId = `${id}-picked`
  const errorId = `${id}-error`

  function pick(picked: Place) {
    setQuery('')
    onPick(picked)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter picks the top result instead of submitting the form.
    if (event.key !== 'Enter') return
    event.preventDefault()
    const [first] = search.results
    if (first && !search.searching) pick(first)
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={place ? 'Search to change the place' : 'Search places'}
        autoComplete="off"
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : pickedId}
      />
      {placeQuery(query) !== null && (
        <PlaceResults
          results={search.results}
          searching={search.searching}
          error={search.error}
          onPick={pick}
        />
      )}
      <span id={pickedId} className="field-hint">
        {place
          ? `Selected: ${[place.name, place.address].filter(Boolean).join(', ')}`
          : 'Pick a result to set the location.'}
      </span>
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  )
}

function PlaceResults({
  results,
  searching,
  error,
  onPick,
}: {
  results: Place[]
  searching: boolean
  error: string | null
  onPick: (place: Place) => void
}) {
  if (error) {
    return (
      <p role="alert" className="field-error">
        {error}
      </p>
    )
  }
  if (results.length === 0) {
    return (
      <p className="field-hint" aria-live="polite">
        {searching ? 'Searching…' : 'No places found.'}
      </p>
    )
  }
  return (
    <ul
      className="place-results"
      aria-label="Search results"
      aria-busy={searching}
    >
      {results.map((result) => (
        <li key={`${result.lat},${result.lng},${result.name}`}>
          <button type="button" onClick={() => onPick(result)}>
            <span className="place-name">{result.name}</span>
            {result.address && (
              <span className="place-address">{result.address}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
