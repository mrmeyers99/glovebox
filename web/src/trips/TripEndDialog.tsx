import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from 'react'
import type { Day, Stop } from '../lib/database.types'
import type { Place } from '../lib/geocode'
import { supabase } from '../lib/supabase'
import { MAX_NAME_LENGTH, nameAfterPick, searchFocus } from './addStop'
import { PlaceSearchField } from './PlaceSearchField'
import {
  firstDay,
  lastDay,
  parseTripEndForm,
  tripEndSaveError,
  tripEndSlot,
  type TripEndFields,
  type TripEndKind,
} from './tripEnds'
import type { TripAction } from './tripState'

type Props = {
  tripId: string
  kind: TripEndKind
  /** The current start or end stop, to change it; omit to set a new one. */
  stop?: Stop
  days: Day[]
  stops: Stop[]
  dispatch: Dispatch<TripAction>
  onClose: () => void
}

const LABELS = { start: 'start', end: 'end' } as const

/**
 * Modal form that sets the trip's start or end point via place search, or
 * changes the place of the existing one (keeping its notes, cost and so on).
 */
export function TripEndDialog({
  tripId,
  kind,
  stop,
  days,
  stops,
  dispatch,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [name, setName] = useState(stop?.name ?? '')
  const [errors, setErrors] = useState<{ name?: string; place?: string }>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Bias search toward the trip's nearest stops at that end; fixed while open.
  const [focus] = useState(() => {
    const day = kind === 'start' ? firstDay(days) : lastDay(days)
    return day ? searchFocus(days, stops, day.id) : undefined
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function pick(picked: Place) {
    // The current stop's name counts as a pick, so changing the place of
    // "Denver" to Boulder renames it, but a custom name like "Home" stays.
    const previous = place ?? stop ?? null
    setName((current) => nameAfterPick(current, previous, picked))
    setPlace(picked)
    setErrors({})
  }

  async function saveTripEnd(fields: TripEndFields) {
    if (stop) {
      // Null data means the stop was deleted meanwhile.
      return supabase
        .from('stops')
        .update(fields)
        .eq('id', stop.id)
        .select()
        .maybeSingle()
    }
    // Worked out at save time so stops added meanwhile are accounted for.
    const slot = tripEndSlot(kind, days, stops)
    if (!slot)
      return { data: null, error: { message: 'This trip has no days.' } }
    return supabase
      .from('stops')
      .insert({
        trip_id: tripId,
        day_id: slot.dayId,
        position: slot.position,
        kind,
        ...fields,
      })
      .select()
      .single()
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const result = parseTripEndForm(name, place)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    setSaveError(null)
    const { data, error } = await saveTripEnd(result.fields)
    setSaving(false)
    if (error || !data) {
      setSaveError(
        error
          ? tripEndSaveError(kind, error)
          : `The ${LABELS[kind]} was deleted.`,
      )
      return
    }
    dispatch({ type: 'upsertStop', stop: data })
    onClose()
  }

  const label = LABELS[kind]
  const title = stop ? `Change the trip's ${label}` : `Set the trip's ${label}`
  const nameId = `trip-end-name`

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="trip-end-title"
      // Escape closes the dialog natively; keep React state in step.
      onClose={onClose}
    >
      <form className="dialog-form" noValidate onSubmit={save}>
        <h2 id="trip-end-title">{title}</h2>

        {stop && (
          <p className="field-hint">
            Now: {[stop.name, stop.address].filter(Boolean).join(', ')}
          </p>
        )}

        <PlaceSearchField
          id="trip-end-place"
          label={kind === 'start' ? 'Start point' : 'End point'}
          place={place}
          focus={focus}
          error={errors.place}
          onPick={pick}
        />

        <div className="field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setErrors((prev) => ({ ...prev, name: undefined }))
            }}
            maxLength={MAX_NAME_LENGTH}
            required
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
          />
          {errors.name && (
            <span id={`${nameId}-error`} className="field-error">
              {errors.name}
            </span>
          )}
        </div>

        {saveError && (
          <p role="alert" className="error">
            Couldn't save the {label}: {saveError}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : stop ? `Change ${label}` : `Set ${label}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}
