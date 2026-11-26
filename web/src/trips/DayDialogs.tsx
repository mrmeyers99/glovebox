// Dialogs opened from a day's menu: editing its notes, and deleting it.

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { Day, Stop } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { comparePositions } from '../lib/tripMath'
import {
  deleteDay,
  deleteDayTarget,
  parseDayNotes,
  planDeleteDay,
  type DeleteDayChoice,
  type SaveDeleteDay,
} from './dayActions'
import type { TripAction } from './tripState'

/** A modal dialog, open while mounted. Escape or Cancel calls `onClose`. */
function Modal({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={labelledBy}
      // Escape closes the dialog natively; keep React state in step.
      onClose={onClose}
    >
      {children}
    </dialog>
  )
}

/** The form for a day's notes. Blank clears them. */
export function DayNotesDialog({
  day,
  dayNumber,
  dispatch,
  onClose,
}: {
  day: Day
  dayNumber: number
  dispatch: Dispatch<TripAction>
  onClose: () => void
}) {
  // Start from the notes as they were when the dialog opened.
  const [text, setText] = useState(() => day.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    const notes = parseDayNotes(text)
    if (notes === day.notes) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    const { data, error } = await supabase
      .from('days')
      .update({ notes })
      .eq('id', day.id)
      .select()
      .maybeSingle()
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    // No row means row-level security hid it, or it was deleted.
    if (!data) {
      setError("This day no longer exists, or you can't change this trip.")
      return
    }
    dispatch({ type: 'upsertDay', day: data })
    onClose()
  }

  return (
    <Modal labelledBy="day-notes-title" onClose={onClose}>
      <form className="dialog-form" noValidate onSubmit={save}>
        <h2 id="day-notes-title">Notes for Day {dayNumber}</h2>
        <div className="field">
          <label htmlFor="day-notes-text">Notes</label>
          <textarea
            id="day-notes-text"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Rest day in Moab: Arches in the morning"
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="error">
            Couldn't save: {error}
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
    </Modal>
  )
}

const saveDeleteDay: SaveDeleteDay = async (plan) =>
  supabase.rpc('delete_day', {
    p_day_id: plan.dayId,
    p_moves: plan.moves,
    p_delete_stop_ids: plan.deleteIds,
  })

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Asks before deleting `day`. If it has stops, the user chooses whether to
 * move them to the day before (the next day, for Day 1) or delete them; the
 * trip's start and end always move.
 */
export function DeleteDayDialog({
  day,
  days,
  stops,
  dispatch,
  onClose,
  save = saveDeleteDay,
}: {
  day: Day
  days: Day[]
  stops: Stop[]
  dispatch: Dispatch<TripAction>
  onClose: () => void
  /** Replaced in tests. */
  save?: SaveDeleteDay
}) {
  const [choice, setChoice] = useState<DeleteDayChoice>('move')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ordered = [...days].sort((a, b) =>
    comparePositions(a.position, b.position),
  )
  const numberOf = (id: string) => ordered.findIndex((d) => d.id === id) + 1
  const dayNumber = numberOf(day.id)
  const target = deleteDayTarget(days, day.id)
  const targetName = target
    ? dayNumber === 1
      ? `the next day (Day ${numberOf(target.id)})`
      : `Day ${numberOf(target.id)}`
    : null
  const onDay = stops.filter((s) => s.day_id === day.id)
  const waypoints = onDay.filter((s) => s.kind === 'waypoint').length
  const ends = onDay.filter((s) => s.kind !== 'waypoint')

  async function confirm() {
    const plan = planDeleteDay(days, stops, day.id, choice)
    if ('error' in plan) {
      setError(plan.error)
      return
    }
    setDeleting(true)
    setError(null)
    const message = await deleteDay(plan, { dispatch, save })
    setDeleting(false)
    if (message) {
      setError(message)
      return
    }
    onClose()
  }

  return (
    <Modal labelledBy="delete-day-title" onClose={onClose}>
      <div className="dialog-form stop-view">
        <h2 id="delete-day-title">Delete Day {dayNumber}?</h2>
        {!targetName ? (
          <p>A trip needs at least one day.</p>
        ) : (
          <>
            {waypoints > 0 ? (
              <fieldset className="field day-delete-choice">
                <legend>
                  Day {dayNumber} has {plural(waypoints, 'stop')}. What should
                  happen to {waypoints === 1 ? 'it' : 'them'}?
                </legend>
                <label>
                  <input
                    type="radio"
                    name="delete-day-choice"
                    value="move"
                    checked={choice === 'move'}
                    onChange={() => setChoice('move')}
                  />
                  Move {waypoints === 1 ? 'it' : 'them'} to {targetName}
                </label>
                <label>
                  <input
                    type="radio"
                    name="delete-day-choice"
                    value="delete"
                    checked={choice === 'delete'}
                    onChange={() => setChoice('delete')}
                  />
                  Delete {waypoints === 1 ? 'it' : 'them'}
                </label>
              </fieldset>
            ) : (
              <p>Later days move up a day.</p>
            )}
            {ends.map((stop) => (
              <p key={stop.id}>
                The trip's {stop.kind}, {stop.name}, moves to{' '}
                {stop.kind === 'start' ? 'the new Day 1' : 'the new last day'}.
              </p>
            ))}
          </>
        )}
        {error && (
          <p role="alert" className="error">
            Couldn't delete the day: {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={deleting} autoFocus>
            Keep it
          </button>
          {targetName && (
            <button
              type="button"
              className="danger"
              onClick={confirm}
              disabled={deleting}
            >
              {deleting
                ? 'Deleting…'
                : choice === 'delete' && waypoints > 0
                  ? `Delete day and ${plural(waypoints, 'stop')}`
                  : 'Delete day'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
