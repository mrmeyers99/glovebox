import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { CostCategory, Day, Stop } from '../lib/database.types'
import { formatMoney, formatTimeOfDay } from '../lib/format'
import type { Place } from '../lib/geocode'
import { supabase } from '../lib/supabase'
import {
  canDeleteStop,
  COST_CATEGORIES,
  emptyStopForm,
  formatStay,
  MAX_NAME_LENGTH,
  nameAfterPick,
  newStopPosition,
  parseStopForm,
  placeFromStop,
  placeQuery,
  searchFocus,
  stopFormFromStop,
  type StopFields,
  type StopFormErrors,
  type StopFormInput,
} from './addStop'
import type { TripAction } from './tripState'
import { usePlaceSearch } from './usePlaceSearch'

/** Adding a waypoint to a day, or opening an existing stop. */
export type StopDialogMode =
  | { type: 'add'; dayId: string; dayNumber: number }
  | { type: 'edit'; stop: Stop; dayNumber: number }

type Props = {
  tripId: string
  mode: StopDialogMode
  /** Owners and editors; viewers see the stop's details read-only. */
  canEdit: boolean
  days: Day[]
  stops: Stop[]
  dispatch: Dispatch<TripAction>
  onClose: () => void
}

type FieldName = keyof StopFormInput | 'place'

/**
 * Modal for a stop: adds a waypoint at the end of a day, or shows an existing
 * stop to edit or delete. Viewers get the details read-only.
 */
export function StopDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const { mode, canEdit, onClose } = props
  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="stop-dialog-title"
      // Escape closes the dialog natively; keep React state in step.
      onClose={onClose}
    >
      {mode.type === 'edit' && !canEdit ? (
        <StopDetails
          stop={mode.stop}
          dayNumber={mode.dayNumber}
          onClose={onClose}
        />
      ) : (
        <StopForm {...props} />
      )}
    </dialog>
  )
}

function StopForm({ tripId, mode, days, stops, dispatch, onClose }: Props) {
  const editing = mode.type === 'edit' ? mode.stop : null
  const dayId = mode.type === 'add' ? mode.dayId : mode.stop.day_id
  const [query, setQuery] = useState('')
  const [place, setPlace] = useState<Place | null>(() =>
    editing ? placeFromStop(editing) : null,
  )
  const [input, setInput] = useState<StopFormInput>(() =>
    editing ? stopFormFromStop(editing) : emptyStopForm,
  )
  const [errors, setErrors] = useState<StopFormErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Bias search toward where the trip is at that point (or the stop being
  // edited); fixed while open.
  const [focus] = useState(() =>
    editing
      ? { lat: editing.lat, lng: editing.lng }
      : searchFocus(days, stops, dayId),
  )
  const search = usePlaceSearch(query, focus)
  const dayStops = useMemo(
    () => stops.filter((s) => s.day_id === dayId),
    [stops, dayId],
  )

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

  function insert(fields: StopFields) {
    return supabase
      .from('stops')
      .insert({
        trip_id: tripId,
        day_id: dayId,
        // Recomputed at save time so stops added meanwhile are accounted for.
        position: newStopPosition(dayStops),
        kind: 'waypoint',
        ...fields,
      })
      .select()
      .single()
  }

  function updateStop(id: string, fields: StopFields) {
    return supabase.from('stops').update(fields).eq('id', id).select().single()
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
    const { data, error } = editing
      ? await updateStop(editing.id, result.fields)
      : await insert(result.fields)
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    dispatch({ type: 'upsertStop', stop: data })
    onClose()
  }

  async function deleteStop() {
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    const { data, error } = await supabase
      .from('stops')
      .delete()
      .eq('id', editing.id)
      .select('id')
    setSaving(false)
    if (error || data.length === 0) {
      // No rows means row-level security hid it: no longer allowed to edit.
      setSaveError(error?.message ?? "You can't delete stops on this trip.")
      setConfirmingDelete(false)
      return
    }
    dispatch({ type: 'removeStop', id: editing.id })
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
  const title = editing
    ? `Edit ${kindNoun(editing)} on Day ${mode.dayNumber}`
    : `Add a stop to Day ${mode.dayNumber}`

  return (
    <form className="dialog-form" noValidate onSubmit={save}>
      <h2 id="stop-dialog-title">{title}</h2>

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
          // When editing, details are more often what changes than the place.
          autoFocus={!editing}
          aria-invalid={errors.place ? true : undefined}
          aria-describedby={
            errors.place ? `${fieldId('place')}-error` : 'stop-place-picked'
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
        <span id="stop-place-picked" className="field-hint">
          {place
            ? `Selected: ${placeLabel(place)}`
            : 'Pick a result to set the location.'}
        </span>
        {fieldError('place')}
      </div>

      <div className="field">
        <label htmlFor={fieldId('name')}>Name</label>
        <input
          {...fieldProps('name')}
          maxLength={MAX_NAME_LENGTH}
          required
          autoFocus={editing !== null}
        />
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
          {editing ? "Couldn't save the stop" : "Couldn't add the stop"}:{' '}
          {saveError}
        </p>
      )}

      {confirmingDelete && editing ? (
        <div className="dialog-confirm" role="alert">
          <p>
            Delete <strong>{editing.name}</strong>? This can't be undone.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={saving}
              autoFocus
            >
              Keep it
            </button>
            <button
              type="button"
              className="danger"
              onClick={deleteStop}
              disabled={saving}
            >
              {saving ? 'Deleting…' : 'Delete stop'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dialog-actions">
          {editing && canDeleteStop(editing) && (
            <button
              type="button"
              className="danger-text dialog-actions-start"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {editing
              ? saving
                ? 'Saving…'
                : 'Save'
              : saving
                ? 'Adding…'
                : 'Add stop'}
          </button>
        </div>
      )}
    </form>
  )
}

/** A stop's details for viewers, who can read but not change them. */
function StopDetails({
  stop,
  dayNumber,
  onClose,
}: {
  stop: Stop
  dayNumber: number
  onClose: () => void
}) {
  const cost = stop.cost_amount == null ? null : Number(stop.cost_amount)
  const category = COST_CATEGORIES.find((c) => c.value === stop.cost_category)
  const rows: [string, ReactNode][] = []
  if (stop.address) rows.push(['Address', stop.address])
  if (stop.notes) rows.push(['Notes', stop.notes])
  if (cost !== null)
    rows.push([
      'Cost',
      `${formatMoney(cost)}${category ? ` · ${category.label}` : ''}`,
    ])
  if (stop.arrival_time)
    rows.push(['Arrival time', formatTimeOfDay(stop.arrival_time)])
  if (stop.stay_minutes != null)
    rows.push(['Stay', formatStay(stop.stay_minutes)])

  return (
    <div className="dialog-form stop-view">
      <h2 id="stop-dialog-title">{stop.name}</h2>
      <p className="field-hint">
        {kindNoun(stop, true)} on Day {dayNumber}
        {stop.skipped && ' · Skipped'}
      </p>
      {rows.length > 0 ? (
        <dl className="stop-details">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">No details yet.</p>
      )}
      <p className="field-hint">You can view this trip but not change it.</p>
      <div className="dialog-actions">
        <button type="button" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>
  )
}

function kindNoun(stop: Pick<Stop, 'kind'>, capitalized = false) {
  const noun =
    stop.kind === 'start' ? 'start' : stop.kind === 'end' ? 'end' : 'stop'
  return capitalized ? noun[0].toUpperCase() + noun.slice(1) : noun
}

function placeLabel(place: Place) {
  return [place.name, place.address].filter(Boolean).join(', ')
}

function fieldId(field: FieldName) {
  return `stop-${field}`
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
