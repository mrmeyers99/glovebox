import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { CostCategory, Day, Stop } from '../lib/database.types'
import { formatMoney, formatTimeOfDay } from '../lib/format'
import { reverseGeocode, type LatLng, type Place } from '../lib/geocode'
import { supabase } from '../lib/supabase'
import {
  canDeleteStop,
  changedStopFields,
  COST_CATEGORIES,
  emptyStopForm,
  formatStay,
  MAX_NAME_LENGTH,
  nameAfterPick,
  newStopPosition,
  parseStopForm,
  placeFromStop,
  searchFocus,
  stopFormFromStop,
  type StopFields,
  type StopFormErrors,
  type StopFormInput,
} from './addStop'
import {
  droppedPin,
  formatCoordinates,
  numberedDays,
  placeAtPoint,
} from './mapAdd'
import { PlaceSearchField } from './PlaceSearchField'
import { positionBeforeStop } from './suggestionStop'
import type { TripAction } from './tripState'

/**
 * Adding a waypoint to a day, opening an existing stop, or confirming a
 * waypoint's deletion (from its menu). A stop added at a spot picked on the
 * map (`at`) gets a day picker, starting on `dayId`. A suggested place
 * (`suggestion`, at `at`) keeps its name and goes before `beforeStopId` on
 * its default day.
 */
export type StopDialogMode =
  | {
      type: 'add'
      dayId: string
      dayNumber: number
      at?: LatLng
      suggestion?: SuggestedStop
    }
  | { type: 'edit'; stop: Stop; dayNumber: number }
  | { type: 'delete'; stop: Stop; dayNumber: number }

/** A suggested place being added as a stop. */
export type SuggestedStop = {
  placeId: number
  name: string
  /** On the default day, the new stop goes just before this one. */
  beforeStopId: string | null
}

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
      {mode.type === 'delete' ? (
        <DeleteStopConfirm
          stop={mode.stop}
          dayNumber={mode.dayNumber}
          dispatch={props.dispatch}
          onClose={onClose}
        />
      ) : mode.type === 'edit' && !canEdit ? (
        <StopDetails
          stop={mode.stop}
          dayNumber={mode.dayNumber}
          onClose={onClose}
        />
      ) : (
        <StopForm {...props} mode={mode} />
      )}
    </dialog>
  )
}

/**
 * Deletes stop `id`. Returns an error message, or null once it's deleted.
 */
async function deleteStopRow(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('stops')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) return `Couldn't delete the stop: ${error.message}`
  // No rows means row-level security hid it: no longer allowed to edit.
  if (data.length === 0)
    return "Couldn't delete the stop: you can't change this trip."
  return null
}

function StopForm({
  tripId,
  mode,
  days,
  stops,
  dispatch,
  onClose,
}: Props & { mode: Exclude<StopDialogMode, { type: 'delete' }> }) {
  const editing = mode.type === 'edit' ? mode.stop : null
  // The stop as it was when opened; saving sends only what changed since.
  const [original] = useState(editing)
  // The spot picked on the map, if any, and its pin until it's looked up.
  const [at] = useState(() => (mode.type === 'add' ? mode.at : undefined))
  const [suggestion] = useState(() =>
    mode.type === 'add' && mode.at ? mode.suggestion : undefined,
  )
  const [pin] = useState((): Place | null => {
    if (!at) return null
    return suggestion
      ? { name: suggestion.name, address: formatCoordinates(at), ...at }
      : droppedPin(at)
  })
  const [chosenDayId, setDayId] = useState(() =>
    mode.type === 'add' ? mode.dayId : mode.stop.day_id,
  )
  const [place, setPlace] = useState<Place | null>(() =>
    editing ? placeFromStop(editing) : pin,
  )
  const [input, setInput] = useState<StopFormInput>(() =>
    editing
      ? stopFormFromStop(editing)
      : { ...emptyStopForm, name: pin?.name ?? '' },
  )
  const [lookingUp, setLookingUp] = useState(at !== undefined)
  const [lookupFailed, setLookupFailed] = useState(false)
  // Set once a place is picked from search, so a slow lookup can't replace it.
  const picked = useRef(false)
  const [errors, setErrors] = useState<StopFormErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Bias search toward where the trip is at that point (or the stop being
  // edited, or the spot picked); fixed while open.
  const [focus] = useState(() =>
    editing
      ? { lat: editing.lat, lng: editing.lng }
      : (at ?? searchFocus(days, stops, chosenDayId)),
  )
  const dayChoices = useMemo(() => numberedDays(days), [days])
  // If a collaborator deletes the chosen day meanwhile, fall back to the last.
  const dayId =
    !at || dayChoices.some((d) => d.dayId === chosenDayId)
      ? chosenDayId
      : (dayChoices.at(-1)?.dayId ?? chosenDayId)

  // Name the picked spot after the nearest place, keeping it where it was
  // dropped. Without one (or if the lookup fails) it stays a dropped pin.
  useEffect(() => {
    if (!at || !pin) return
    let active = true
    reverseGeocode(at).then(
      (found) => {
        if (!active) return
        setLookingUp(false)
        if (!found || picked.current) return
        const resolved = placeAtPoint(at, found)
        // A suggestion keeps its own name; the lookup only adds the address.
        if (suggestion) {
          setPlace({ ...resolved, name: suggestion.name })
          return
        }
        setPlace(resolved)
        setInput((prev) => ({
          ...prev,
          name: nameAfterPick(prev.name, pin, resolved),
        }))
      },
      () => {
        if (!active) return
        setLookingUp(false)
        setLookupFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [at, pin, suggestion])

  const dayStops = useMemo(
    () => stops.filter((s) => s.day_id === dayId),
    [stops, dayId],
  )

  function update(field: keyof StopFormInput, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function pick(chosen: Place) {
    picked.current = true
    setLookingUp(false)
    setLookupFailed(false)
    setInput((prev) => ({
      ...prev,
      name: nameAfterPick(prev.name, place, chosen),
    }))
    setPlace(chosen)
    setErrors((prev) => ({ ...prev, place: undefined, name: undefined }))
  }

  function insert(fields: StopFields) {
    // A suggestion goes between the stops it lies between, unless the user
    // picked another day or another place.
    const suggested = suggestion && !picked.current ? suggestion : null
    const onDefaultDay = mode.type === 'add' && dayId === mode.dayId
    return supabase
      .from('stops')
      .insert({
        trip_id: tripId,
        day_id: dayId,
        // Recomputed at save time so stops added meanwhile are accounted for.
        position:
          suggested && onDefaultDay
            ? positionBeforeStop(dayStops, suggested.beforeStopId)
            : newStopPosition(dayStops),
        kind: 'waypoint',
        ...fields,
        ...(suggested && { place_id: suggested.placeId }),
      })
      .select()
      .single()
  }

  function updateStop(id: string, fields: Partial<StopFields>) {
    return supabase.from('stops').update(fields).eq('id', id).select().single()
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const result = parseStopForm(input, place)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    const changes = original
      ? changedStopFields(original, result.fields)
      : result.fields
    if (original && Object.keys(changes).length === 0) {
      onClose()
      return
    }
    setSaving(true)
    setSaveError(null)
    const { data, error } = original
      ? await updateStop(original.id, changes)
      : await insert(result.fields)
    setSaving(false)
    if (error) {
      setSaveError(
        `${original ? "Couldn't save the stop" : "Couldn't add the stop"}: ${error.message}`,
      )
      return
    }
    dispatch({ type: 'upsertStop', stop: data })
    onClose()
  }

  async function deleteStop() {
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    const message = await deleteStopRow(editing.id)
    setSaving(false)
    if (message) {
      setSaveError(message)
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

  const title = editing
    ? `Edit ${kindNoun(editing)} on Day ${mode.dayNumber}`
    : suggestion
      ? 'Add to trip'
      : at
        ? 'Add a stop here'
        : `Add a stop to Day ${mode.dayNumber}`

  return (
    <form className="dialog-form" noValidate onSubmit={save}>
      <h2 id="stop-dialog-title">{title}</h2>

      <PlaceSearchField
        id={fieldId('place')}
        place={place}
        focus={focus}
        error={errors.place}
        // When editing, or adding at a picked spot, the place is already set.
        autoFocus={!editing && !at}
        onPick={pick}
      />
      {at && (lookingUp || lookupFailed) && (
        <p className="field-hint" aria-live="polite">
          {lookingUp
            ? 'Looking up this spot…'
            : suggestion
              ? "Couldn't look up the address; it will be saved with its coordinates."
              : "Couldn't look up this spot; it will be saved as a dropped pin."}
        </p>
      )}

      {at && (
        <div className="field">
          <label htmlFor="stop-day">Day</label>
          <select
            id="stop-day"
            value={dayId}
            onChange={(e) => setDayId(e.target.value)}
          >
            {dayChoices.map((d) => (
              <option key={d.dayId} value={d.dayId}>
                Day {d.dayNumber}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor={fieldId('name')}>Name</label>
        <input
          {...fieldProps('name')}
          maxLength={MAX_NAME_LENGTH}
          required
          autoFocus={editing !== null || at !== undefined}
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

/** Asks before deleting `stop`, when Delete is picked from its menu. */
function DeleteStopConfirm({
  stop,
  dayNumber,
  dispatch,
  onClose,
}: {
  stop: Stop
  dayNumber: number
  dispatch: Dispatch<TripAction>
  onClose: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setDeleting(true)
    setError(null)
    const message = await deleteStopRow(stop.id)
    setDeleting(false)
    if (message) {
      setError(message)
      return
    }
    dispatch({ type: 'removeStop', id: stop.id })
    onClose()
  }

  return (
    <div className="dialog-form stop-view">
      <h2 id="stop-dialog-title">Delete {stop.name}?</h2>
      <p>It will be removed from Day {dayNumber}. This can't be undone.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose} disabled={deleting} autoFocus>
          Keep it
        </button>
        <button
          type="button"
          className="danger"
          onClick={confirm}
          disabled={deleting}
        >
          {deleting ? 'Deleting…' : 'Delete stop'}
        </button>
      </div>
    </div>
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

function fieldId(field: FieldName) {
  return `stop-${field}`
}
