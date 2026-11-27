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
import type { Day, Stop } from '../lib/database.types'
import type { Place } from '../lib/geocode'
import { comparePositions } from '../lib/tripMath'
import { StopDialog, type StopDialogMode } from './StopDialog'

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  lookup: undefined as unknown as () => Promise<Place | null>,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mocks.inserted.push(row)
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: 'new', ...row }, error: null }),
          }),
        }
      },
    }),
  },
}))

vi.mock('../lib/geocode', () => ({
  reverseGeocode: () => mocks.lookup(),
}))

// Search is tested on its own; here it only needs to pick a place.
vi.mock('./PlaceSearchField', () => ({
  PlaceSearchField: ({
    place,
    onPick,
  }: {
    place: Place | null
    onPick: (place: Place) => void
  }) => (
    <div>
      <output aria-label="Place">
        {place ? `${place.name} | ${place.address}` : ''}
      </output>
      <button
        type="button"
        onClick={() =>
          onPick({ name: 'Elsewhere', address: 'Main St', lat: 5, lng: 5 })
        }
      >
        Pick elsewhere
      </button>
    </div>
  ),
}))

beforeAll(() => {
  // jsdom doesn't open modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
})
beforeEach(() => {
  mocks.inserted = []
  mocks.lookup = () =>
    Promise.resolve({ name: 'Somewhere', address: '1 Corn St', lat: 0, lng: 0 })
})
afterEach(cleanup)

const day = (id: string, position: string) => ({ id, position }) as Day

function stop(id: string, dayId: string, position: string): Stop {
  return {
    id,
    trip_id: 't1',
    day_id: dayId,
    position,
    kind: 'waypoint',
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
    place_id: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
  }
}

const days = [day('d1', 'a0'), day('d2', 'a1')]
const stops = [stop('a', 'd1', 'a0'), stop('b', 'd1', 'a1')]

const mode: StopDialogMode = {
  type: 'add',
  dayId: 'd1',
  dayNumber: 1,
  at: { lat: 43.7, lng: -98.03 },
  suggestion: { placeId: 42, name: 'Corn Palace', beforeStopId: 'b' },
}

function renderDialog(dialogMode = mode) {
  const dispatch = vi.fn()
  const onClose = vi.fn()
  render(
    <StopDialog
      tripId="t1"
      mode={dialogMode}
      canEdit
      days={days}
      stops={stops}
      dispatch={dispatch}
      onClose={onClose}
    />,
  )
  return { dispatch, onClose }
}

const place = () => screen.getByRole('status', { name: 'Place' }).textContent

describe('StopDialog, adding a suggested place', () => {
  it('keeps the name, adds the address, and goes between its stops', async () => {
    const { dispatch, onClose } = renderDialog()
    screen.getByRole('heading', { name: 'Add to trip' })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Corn Palace',
    )
    await waitFor(() => expect(place()).toBe('Corn Palace | 1 Corn St'))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Corn Palace',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const row = mocks.inserted[0]
    expect(row).toMatchObject({
      day_id: 'd1',
      name: 'Corn Palace',
      address: '1 Corn St',
      lat: 43.7,
      lng: -98.03,
      place_id: 42,
    })
    const position = row.position as string
    expect(comparePositions('a0', position)).toBeLessThan(0)
    expect(comparePositions(position, 'a1')).toBeLessThan(0)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'upsertStop' }),
    )
  })

  it('goes at the end of another day if one is picked', async () => {
    const { onClose } = renderDialog()
    fireEvent.change(screen.getByRole('combobox', { name: 'Day' }), {
      target: { value: 'd2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.inserted[0]).toMatchObject({ day_id: 'd2', place_id: 42 })
  })

  it('forgets the place if another one is picked', async () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Pick elsewhere' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const row = mocks.inserted[0]
    expect(row).not.toHaveProperty('place_id')
    expect(row).toMatchObject({ day_id: 'd1', lat: 5, lng: 5 })
    // At the end of the day, as any stop added from search.
    expect(comparePositions(row.position as string, 'a1')).toBe(1)
  })

  it('saves the coordinates as the address if the lookup fails', async () => {
    mocks.lookup = () => Promise.reject(new Error('offline'))
    renderDialog()
    await screen.findByText(
      "Couldn't look up the address; it will be saved with its coordinates.",
    )
    expect(place()).toBe('Corn Palace | 43.70000, -98.03000')
  })
})

describe('StopDialog, adding at a spot or to a day', () => {
  const at = { lat: 43.7, lng: -98.03 }

  it('names a dropped pin after the place found there', async () => {
    renderDialog({ type: 'add', dayId: 'd1', dayNumber: 1, at })
    screen.getByRole('heading', { name: 'Add a stop here' })
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
        'value',
        'Somewhere',
      ),
    )
  })

  it('keeps a dropped pin if the lookup fails', async () => {
    mocks.lookup = () => Promise.reject(new Error('offline'))
    renderDialog({ type: 'add', dayId: 'd1', dayNumber: 1, at })
    await screen.findByText(
      "Couldn't look up this spot; it will be saved as a dropped pin.",
    )
  })

  it('adds to the end of a day', () => {
    renderDialog({ type: 'add', dayId: 'd2', dayNumber: 2 })
    screen.getByRole('heading', { name: 'Add a stop to Day 2' })
  })
})
