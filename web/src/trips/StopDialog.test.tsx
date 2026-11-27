// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { Stop } from '../lib/database.types'
import { StopDialog, type StopDialogMode } from './StopDialog'

type Deleted = {
  data: { id: string }[] | null
  error: { message: string } | null
}

const mocks = vi.hoisted(() => ({
  deleted: undefined as unknown as Promise<Deleted>,
  eq: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          mocks.eq(column, value)
          return { select: () => mocks.deleted }
        },
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}))

beforeAll(() => {
  // jsdom doesn't open modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
})
beforeEach(() => mocks.eq.mockReset())
afterEach(cleanup)

const stop: Stop = {
  id: 's1',
  trip_id: 't1',
  day_id: 'd1',
  position: 'a0',
  kind: 'waypoint',
  name: 'Diner',
  lat: 0,
  lng: 0,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  place_id: null,
  updated_by: null,
  created_at: '',
  updated_at: '',
}

function renderDialog(mode: StopDialogMode) {
  const dispatch = vi.fn()
  const onClose = vi.fn()
  render(
    <StopDialog
      tripId="t1"
      mode={mode}
      canEdit
      days={[]}
      stops={[stop]}
      dispatch={dispatch}
      onClose={onClose}
    />,
  )
  return { dispatch, onClose }
}

const confirmDelete = { type: 'delete', stop, dayNumber: 2 } as const

describe('StopDialog, confirming a deletion', () => {
  it('asks first, then deletes the stop', async () => {
    mocks.deleted = Promise.resolve({ data: [{ id: 's1' }], error: null })
    const { dispatch, onClose } = renderDialog(confirmDelete)
    screen.getByRole('heading', { name: 'Delete Diner?' })
    screen.getByText(/removed from Day 2/)

    fireEvent.click(screen.getByRole('button', { name: 'Delete stop' }))
    expect(screen.getByRole('button', { name: 'Deleting…' })).toHaveProperty(
      'disabled',
      true,
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.eq).toHaveBeenCalledWith('id', 's1')
    expect(dispatch).toHaveBeenCalledWith({ type: 'removeStop', id: 's1' })
  })

  it('keeps the stop when asked', () => {
    const { dispatch, onClose } = renderDialog(confirmDelete)
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(onClose).toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(mocks.eq).not.toHaveBeenCalled()
  })

  it('shows why the deletion failed', async () => {
    mocks.deleted = Promise.resolve({
      data: null,
      error: { message: 'denied' },
    })
    const { dispatch, onClose } = renderDialog(confirmDelete)
    fireEvent.click(screen.getByRole('button', { name: 'Delete stop' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't delete the stop: denied",
    )
    expect(dispatch).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a stop row-level security hid as no longer editable', async () => {
    mocks.deleted = Promise.resolve({ data: [], error: null })
    renderDialog(confirmDelete)
    fireEvent.click(screen.getByRole('button', { name: 'Delete stop' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't delete the stop: you can't change this trip.",
    )
  })
})

describe('StopDialog, deleting from the edit form', () => {
  it('deletes after confirming, or shows the error', async () => {
    mocks.deleted = Promise.resolve({
      data: null,
      error: { message: 'denied' },
    })
    const failed = renderDialog({ type: 'edit', stop, dayNumber: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete stop' }))
    await screen.findByText("Couldn't delete the stop: denied")
    expect(failed.onClose).not.toHaveBeenCalled()
    cleanup()

    mocks.deleted = Promise.resolve({ data: [{ id: 's1' }], error: null })
    const { dispatch, onClose } = renderDialog({
      type: 'edit',
      stop,
      dayNumber: 1,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete stop' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(dispatch).toHaveBeenCalledWith({ type: 'removeStop', id: 's1' })
  })
})
