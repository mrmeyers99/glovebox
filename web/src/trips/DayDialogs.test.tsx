// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { Day, Stop, StopKind } from '../lib/database.types'
import { DayNotesDialog, DeleteDayDialog } from './DayDialogs'

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn(), rpc: vi.fn() }))
const update = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => {
        update(values)
        return {
          eq: () => ({ select: () => ({ maybeSingle: mocks.maybeSingle }) }),
        }
      },
    }),
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}))

beforeAll(() => {
  // jsdom doesn't open modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
})
beforeEach(() => {
  mocks.maybeSingle.mockReset()
  mocks.rpc.mockReset()
  update.mockReset()
})
afterEach(cleanup)

const makeDay = (id: string, position: string, notes: string | null = null) =>
  ({
    id,
    trip_id: 't1',
    position,
    notes,
    created_at: '',
    updated_at: '',
  }) satisfies Day

const makeStop = (
  id: string,
  dayId: string,
  position: string,
  kind: StopKind = 'waypoint',
): Stop => ({
  id,
  trip_id: 't1',
  day_id: dayId,
  position,
  kind,
  name: id,
  lat: 0,
  lng: 0,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  created_at: '',
  updated_at: '',
  updated_by: null,
})

describe('DayNotesDialog', () => {
  function renderNotes(notes: string | null = 'Old') {
    const dispatch = vi.fn()
    const onClose = vi.fn()
    const day = makeDay('d1', 'a0', notes)
    render(
      <DayNotesDialog
        day={day}
        dayNumber={2}
        dispatch={dispatch}
        onClose={onClose}
      />,
    )
    screen.getByRole('heading', { name: 'Notes for Day 2' })
    const field = screen.getByLabelText('Notes') as HTMLTextAreaElement
    const save = () =>
      act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })
    return { dispatch, onClose, day, field, save }
  }

  it('saves the trimmed notes', async () => {
    const { dispatch, onClose, day, field, save } = renderNotes()
    expect(field.value).toBe('Old')
    fireEvent.change(field, { target: { value: ' Two nights in Moab ' } })
    const saved = { ...day, notes: 'Two nights in Moab' }
    mocks.maybeSingle.mockResolvedValue({ data: saved, error: null })
    await save()
    expect(update).toHaveBeenCalledWith({ notes: 'Two nights in Moab' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'upsertDay', day: saved })
    expect(onClose).toHaveBeenCalled()
  })

  it('clears blank notes, and closes without saving if unchanged', async () => {
    const { field, save, onClose } = renderNotes(null)
    expect(field.value).toBe('')
    fireEvent.change(field, { target: { value: '   ' } })
    await save()
    expect(update).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows why a save failed', async () => {
    const { field, save, onClose, dispatch } = renderNotes()
    fireEvent.change(field, { target: { value: '' } })
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'offline' },
    })
    await save()
    expect(update).toHaveBeenCalledWith({ notes: null })
    screen.getByText("Couldn't save: offline")

    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    await save()
    screen.getByText(/no longer exists/)
    expect(onClose).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('closes on Cancel', () => {
    const { onClose } = renderNotes()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('DeleteDayDialog', () => {
  const days = [makeDay('d1', 'a0'), makeDay('d2', 'a1'), makeDay('d3', 'a2')]
  const stops = [
    makeStop('Home', 'd1', 'a0', 'start'),
    makeStop('Diner', 'd1', 'a1'),
    makeStop('Arches', 'd2', 'a0'),
    makeStop('Canyon', 'd2', 'a1'),
    makeStop('Motel', 'd3', 'a0', 'end'),
  ]

  function renderDelete(dayId: string, dayList = days, stopList = stops) {
    const dispatch = vi.fn()
    const onClose = vi.fn()
    const save = vi.fn().mockResolvedValue({ data: [], error: null })
    render(
      <DeleteDayDialog
        day={dayList.find((d) => d.id === dayId)!}
        days={dayList}
        stops={stopList}
        dispatch={dispatch}
        onClose={onClose}
        save={save}
      />,
    )
    const confirm = (name: string | RegExp) =>
      act(async () => {
        fireEvent.click(screen.getByRole('button', { name }))
      })
    return { dispatch, onClose, save, confirm }
  }

  it('asks what to do with the stops, moving them by default', async () => {
    const { save, confirm, onClose, dispatch } = renderDelete('d2')
    screen.getByRole('heading', { name: 'Delete Day 2?' })
    screen.getByText(/Day 2 has 2 stops/)
    const move = screen.getByLabelText('Move them to Day 1') as HTMLInputElement
    expect(move.checked).toBe(true)
    await confirm('Delete day')
    expect(save).toHaveBeenCalledWith({
      dayId: 'd2',
      moves: [
        expect.objectContaining({ id: 'Arches', day_id: 'd1' }),
        expect.objectContaining({ id: 'Canyon', day_id: 'd1' }),
      ],
      deleteIds: [],
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'removeDay',
      id: 'd2',
      ifPresent: true,
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('deletes the stops if chosen', async () => {
    const { save, confirm } = renderDelete('d2')
    fireEvent.click(screen.getByLabelText('Delete them'))
    await confirm('Delete day and 2 stops')
    expect(save).toHaveBeenCalledWith({
      dayId: 'd2',
      moves: [],
      deleteIds: ['Arches', 'Canyon'],
    })
  })

  it('moves Day 1’s stops to the next day and says the start moves', () => {
    renderDelete('d1')
    screen.getByText(/Day 1 has 1 stop\. What should happen to it/)
    screen.getByLabelText('Move it to the next day (Day 2)')
    screen.getByLabelText('Delete it')
    screen.getByText("The trip's start, Home, moves to the new Day 1.")
  })

  it('just confirms a day with no stops but the end', async () => {
    const { save, confirm } = renderDelete('d3')
    expect(screen.queryByRole('radio')).toBeNull()
    screen.getByText('Later days move up a day.')
    screen.getByText("The trip's end, Motel, moves to the new last day.")
    await confirm('Delete day')
    expect(save).toHaveBeenCalledWith({
      dayId: 'd3',
      moves: [expect.objectContaining({ id: 'Motel', day_id: 'd2' })],
      deleteIds: [],
    })
  })

  it('shows why a delete failed and stays open', async () => {
    const { save, confirm, onClose } = renderDelete('d2')
    save.mockResolvedValue({
      data: null,
      error: { code: '23503', message: '' },
    })
    await confirm('Delete day')
    screen.getByText(/Couldn't delete the day: Someone added a stop/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refuses to delete the only day', () => {
    const only = [makeDay('d1', 'a0')]
    const { onClose } = renderDelete('d1', only, [])
    screen.getByText('A trip needs at least one day.')
    expect(screen.queryByRole('button', { name: 'Delete day' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('saves through delete_day by default', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    render(
      <DeleteDayDialog
        day={days[1]}
        days={days}
        stops={[]}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete day' }))
    })
    expect(mocks.rpc).toHaveBeenCalledWith('delete_day', {
      p_day_id: 'd2',
      p_moves: [],
      p_delete_stop_ids: [],
    })
  })
})
