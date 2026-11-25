import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type { CostCategory, Day, Stop } from '../lib/database.types'
import type { Place } from '../lib/geocode'
import { supabase } from '../lib/supabase'
import {
  COST_CATEGORIES,
  emptyStopForm,
  MAX_NAME_LENGTH,
  nameAfterPick,
  newStopPosition,
  parseStopForm,
  placeQuery,
  searchFocus,
  type StopFormErrors,
  type StopFormInput,
} from './addStop'
import type { TripAction } from './tripState'
import { usePlaceSearch } from './usePlaceSearch'

type Props = {
  tripId: string
  dayId: string
  dayNumber: number
  days: Day[]
  stops: Stop[]
  dispatch: Dispatch<TripAction>
  onClose: () => void
}

type FieldName = keyof StopFormInput | 'place'

/** Modal form that adds a waypoint at the end of a day, via place search. */
export function AddStopDialog({
  tripId,
  dayId,
  dayNumber,
  days,
  stops,
  dispatch,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [input, setInput] = useState<StopFormInput>(emptyStopForm)
  const [errors, setErrors] = useState<StopFormErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Bias search toward where the trip is at that point; fixed while open.
  const [focus] = useState(() => searchFocus(days, stops, dayId))
  const search = usePlaceSearch(query, focus)
  const dayStops = useMemo(
    () => stops.filter((s) => s.day_id === dayId),
    [stops, dayId],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function update(field: keyof StopFormInput, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function pick(picked: Place) {
    setInput((prev) => ({
      ...prev,
      name: nameAfterPick(prev.name, place, picked),
    }))
    setPlace(picked)
    setQuery('')
    setErrors((prev) => ({ ...prev, place: undefined, name: undefined }))
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter picks the top result instead of submitting the form.
    if (event.key !== 'Enter') return
    event.preventDefault()
    const [first] = search.results
    if (first && !search.searching) pick(first)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const result = parseStopForm(input, place)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    setSaveError(null)
    const { data, error } = await supabase
      .from('stops')
      .insert({
        trip_id: tripId,
        day_id: dayId,
        // Recomputed at save time so stops added meanwhile are accounted for.
        position: newStopPosition(dayStops),
        kind: 'waypoint',
        ...result.fields,
      })
      .select()
      .single()
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    dispatch({ type: 'upsertStop', stop: data })
    onClose()
  }

  function fieldProps(field: keyof StopFormInput) {
    return {
      id: fieldId(field),
      value: input[field],
      onChange: (e: { target: { value: string } }) =>
        update(field, e.target.value),
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined,
    }
  }

  function fieldError(field: FieldName) {
    const message = errors[field]
    return message ? (
      <span id={`${fieldId(field)}-error`} className="field-error">
        {message}
      </span>
    ) : null
  }

  const showResults = placeQuery(query) !== null

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="add-stop-title"
      // Escape closes the dialog natively; keep React state in step.
      onClose={onClose}
    >
      <form className="dialog-form" noValidate onSubmit={save}>
        <h2 id="add-stop-title">Add a stop to Day {dayNumber}</h2>

        <div className="field">
          <label htmlFor={fieldId('place')}>Place</label>
          <input
            id={fieldId('place')}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={place ? 'Search to change the place' : 'Search places'}
            autoComplete="off"
            autoFocus
            aria-invalid={errors.place ? true : undefined}
            aria-describedby={
              errors.place
                ? `${fieldId('place')}-error`
                : 'add-stop-place-picked'
            }
          />
          {showResults && (
            <PlaceResults
              results={search.results}
              searching={search.searching}
              error={search.error}
              onPick={pick}
            />
          )}
          <span id="add-stop-place-picked" className="field-hint">
            {place
              ? `Selected: ${[place.name, place.address].filter(Boolean).join(', ')}`
              : 'Pick a result to set the location.'}
          </span>
          {fieldError('place')}
        </div>

        <div className="field">
          <label htmlFor={fieldId('name')}>Name</label>
          <input {...fieldProps('name')} maxLength={MAX_NAME_LENGTH} required />
          {fieldError('name')}
        </div>

        <div className="field">
          <label htmlFor={fieldId('notes')}>Notes</label>
          <textarea
            {...fieldProps('notes')}
            rows={3}
            placeholder="Reservation details, confirmation numbers…"
          />
          {fieldError('notes')}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={fieldId('costAmount')}>Cost ($)</label>
            <input
              {...fieldProps('costAmount')}
              inputMode="decimal"
              autoComplete="off"
            />
            {fieldError('costAmount')}
          </div>
          <div className="field">
            <label htmlFor={fieldId('costCategory')}>Category</label>
            <select
              {...fieldProps('costCategory')}
              onChange={(e) =>
                update('costCategory', e.target.value as CostCategory | '')
              }
            >
              <option value="">—</option>
              {COST_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={fieldId('arrivalTime')}>Arrival time</label>
            <input {...fieldProps('arrivalTime')} type="time" />
            {fieldError('arrivalTime')}
          </div>
          <div className="field">
            <label htmlFor={fieldId('stay')}>Stay</label>
            <input
              {...fieldProps('stay')}
              autoComplete="off"
              placeholder="e.g. 1h 30m"
            />
            {fieldError('stay')}
          </div>
        </div>

        {saveError && (
          <p role="alert" className="error">
            Couldn't add the stop: {saveError}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Adding…' : 'Add stop'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function fieldId(field: FieldName) {
  return `add-stop-${field}`
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
