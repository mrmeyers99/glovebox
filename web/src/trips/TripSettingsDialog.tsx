import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from 'react'
import type { Trip } from '../lib/database.types'
import { formatNationalAverage } from '../lib/gasPrice'
import { supabase } from '../lib/supabase'
import {
  changedSettings,
  parseTripSettings,
  toSettingsInput,
  type TripSettingsErrors,
  type TripSettingsInput,
} from './tripSettings'
import type { TripAction } from './tripState'
import { useNationalAverage } from './useNationalAverage'

type Props = {
  trip: Trip
  dispatch: Dispatch<TripAction>
  onClose: () => void
}

/** Modal form for a trip's name, start date, mpg and gas price. */
export function TripSettingsDialog({ trip, dispatch, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Start from the trip as it was when the dialog opened, and remember that
  // snapshot so a save only sends the fields this user changed.
  const [opened] = useState(() => trip)
  const [input, setInput] = useState(() => toSettingsInput(trip))
  const [errors, setErrors] = useState<TripSettingsErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nationalAverage = useNationalAverage()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function update(field: keyof TripSettingsInput, value: string) {
    setInput((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const result = parseTripSettings(input)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    const changes = changedSettings(result.patch, opened)
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }
    setSaving(true)
    setSaveError(null)
    const { data, error } = await supabase
      .from('trips')
      .update(changes)
      .eq('id', trip.id)
      .select()
      .single()
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    dispatch({ type: 'updateTrip', trip: data })
    onClose()
  }

  function fieldProps(field: keyof TripSettingsInput) {
    const id = `trip-settings-${field}`
    return {
      id,
      value: input[field],
      onChange: (e: { target: { value: string } }) =>
        update(field, e.target.value),
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': errors[field] ? `${id}-error` : undefined,
    }
  }

  function fieldError(field: keyof TripSettingsInput) {
    const message = errors[field]
    return message ? (
      <span id={`trip-settings-${field}-error`} className="field-error">
        {message}
      </span>
    ) : null
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="trip-settings-title"
      // Escape closes the dialog natively; keep React state in step.
      onClose={onClose}
    >
      <form className="dialog-form" noValidate onSubmit={save}>
        <h2 id="trip-settings-title">Trip settings</h2>

        <div className="field">
          <label htmlFor="trip-settings-name">Name</label>
          <input {...fieldProps('name')} maxLength={200} required />
          {fieldError('name')}
        </div>

        <div className="field">
          <label htmlFor="trip-settings-startDate">Start date</label>
          <input {...fieldProps('startDate')} type="date" />
          {fieldError('startDate')}
        </div>

        <div className="field">
          <label htmlFor="trip-settings-mpg">Average mpg</label>
          <input
            {...fieldProps('mpg')}
            inputMode="decimal"
            autoComplete="off"
            required
          />
          {fieldError('mpg')}
        </div>

        <div className="field">
          <label htmlFor="trip-settings-gasPrice">
            Gas price per gallon ($)
          </label>
          <input
            {...fieldProps('gasPrice')}
            inputMode="decimal"
            autoComplete="off"
            placeholder="National average"
          />
          <span className="field-hint">
            {input.gasPrice.trim() === '' && nationalAverage
              ? formatNationalAverage(nationalAverage)
              : 'Leave blank to use the national average.'}
          </span>
          {fieldError('gasPrice')}
        </div>

        {saveError && (
          <p role="alert" className="error">
            Couldn't save: {saveError}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
