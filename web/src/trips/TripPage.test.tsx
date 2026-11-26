// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { Day, Stop, Trip } from '../lib/database.types'
import { summarizeTrip } from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { TripPage } from './TripPage'

const trip: Trip = {
  id: 't1',
  owner_id: 'u1',
  name: 'Road trip',
  start_date: null,
  mpg: 25,
  gas_price_per_gallon: 3,
  created_at: '',
  updated_at: '',
}

const day = (id: string, position: string): Day => ({
  id,
  trip_id: 't1',
  position,
  notes: null,
  created_at: '',
  updated_at: '',
})

const stop = (
  id: string,
  dayId: string,
  position: string,
  name: string,
): Stop => ({
  id,
  trip_id: 't1',
  day_id: dayId,
  position,
  kind: 'waypoint',
  name,
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

const days = [day('d1', 'a0'), day('d2', 'a1')]
const diner = stop('s1', 'd1', 'a0', 'Diner')
const museum = stop('s2', 'd1', 'a1', 'Museum')

const mocks = vi.hoisted(() => ({
  stops: [] as Stop[],
  canEdit: true,
  move: vi.fn(),
  setSkipped: vi.fn(),
  insertDayAfter: vi.fn(),
  days: [] as Day[],
}))

vi.mock('./useTrip', () => ({
  useTrip: () => ({
    trip,
    role: mocks.canEdit ? 'editor' : 'viewer',
    days: mocks.days,
    stops: mocks.stops,
    canEdit: mocks.canEdit,
    loading: false,
    error: null,
    notFound: false,
    reload: () => {},
    dispatch: () => {},
  }),
}))
vi.mock('./useTripSummary', () => ({
  useTripSummary: (_trip: Trip, days: Day[], stops: Stop[]) => ({
    summary: summarizeTrip(days.map(toDayInput), stops.map(toStopInput), {
      mpg: 25,
      gasPricePerGallon: 3,
      route: () => undefined,
    }),
    gasPriceKnown: true,
  }),
}))
vi.mock('./useMoveStop', () => ({
  useMoveStop: () => ({
    move: mocks.move,
    setSkipped: mocks.setSkipped,
    insertDayAfter: mocks.insertDayAfter,
    error: null,
    clearError: () => {},
  }),
}))
vi.mock('./usePresence', () => ({
  usePresence: () => ({
    peers: [],
    index: { stops: new Map(), days: new Map() },
  }),
}))
// The map needs WebGL.
vi.mock('./MapPanel', () => ({ MapPanel: () => null }))
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))

beforeAll(() => {
  // jsdom doesn't open modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
})
beforeEach(() => {
  mocks.stops = [diner, museum]
  mocks.days = days
  mocks.insertDayAfter.mockReset()
  mocks.canEdit = true
  mocks.move.mockReset()
  mocks.setSkipped.mockReset()
})
afterEach(cleanup)

function renderPage() {
  const page = () => (
    <MemoryRouter initialEntries={['/trips/t1']}>
      <Routes>
        <Route path="/trips/:tripId" element={<TripPage />} />
      </Routes>
    </MemoryRouter>
  )
  const result = render(page())
  return { rerender: () => result.rerender(page()) }
}

const openMenu = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
const pick = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('menuitem', { name }))

describe('TripPage stop menu', () => {
  it('opens from the "⋯" button, marking it expanded', () => {
    renderPage()
    openMenu('Museum')
    screen.getByRole('menu', { name: 'Museum actions' })
    expect(
      screen
        .getByRole('button', { name: 'Actions for Museum' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('opens on right-clicking the stop', () => {
    renderPage()
    fireEvent.contextMenu(screen.getByText('Diner'), { clientX: 5, clientY: 5 })
    screen.getByRole('menu', { name: 'Diner actions' })
  })

  it('skips the stop', () => {
    renderPage()
    openMenu('Museum')
    pick('Skip')
    expect(mocks.setSkipped).toHaveBeenCalledWith(museum, true)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves the stop to the end of another day, or a new day', () => {
    renderPage()
    openMenu('Diner')
    pick('Move to day…')
    pick('Day 2')
    expect(mocks.move).toHaveBeenCalledWith(diner, {
      type: 'day',
      dayId: 'd2',
      index: expect.any(Number),
    })

    openMenu('Diner')
    pick('Move to day…')
    pick(/New day/)
    expect(mocks.move).toHaveBeenLastCalledWith(diner, { type: 'newDay' })
  })

  it('opens the stop to edit, or asks before deleting it', () => {
    renderPage()
    openMenu('Museum')
    pick('Edit')
    screen.getByRole('heading', { name: 'Edit stop on Day 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    openMenu('Museum')
    pick('Delete…')
    screen.getByRole('heading', { name: 'Delete Museum?' })
  })

  it('offers viewers only the stop details', () => {
    mocks.canEdit = false
    renderPage()
    openMenu('Museum')
    pick('View details')
    screen.getByRole('heading', { name: 'Museum' })
  })

  it('closes if the stop is deleted meanwhile', () => {
    const { rerender } = renderPage()
    openMenu('Museum')
    mocks.stops = [diner]
    rerender()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('TripPage day menu', () => {
  const openDayMenu = (n: number) =>
    fireEvent.click(
      screen.getByRole('button', { name: `Actions for Day ${n}` }),
    )

  it('inserts a day after the chosen one', () => {
    renderPage()
    openDayMenu(1)
    screen.getByRole('menu', { name: 'Day 1 actions' })
    expect(
      screen
        .getByRole('button', { name: 'Actions for Day 1' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    pick('Insert day after')
    expect(mocks.insertDayAfter).toHaveBeenCalledWith('d1')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the notes form, or asks before deleting the day', () => {
    renderPage()
    openDayMenu(2)
    pick('Edit notes…')
    screen.getByRole('heading', { name: 'Notes for Day 2' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByRole('heading', { name: 'Notes for Day 2' }),
    ).toBeNull()

    openDayMenu(1)
    pick('Delete day…')
    screen.getByRole('heading', { name: 'Delete Day 1?' })
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('heading', { name: 'Delete Day 1?' })).toBeNull()
  })

  it('closes the menu and dialog if the day is deleted meanwhile', () => {
    const { rerender } = renderPage()
    openDayMenu(2)
    mocks.days = [days[0]]
    rerender()
    expect(screen.queryByRole('menu')).toBeNull()

    mocks.days = days
    rerender()
    openDayMenu(2)
    pick('Delete day…')
    mocks.days = [days[0]]
    rerender()
    expect(screen.queryByRole('heading', { name: 'Delete Day 2?' })).toBeNull()
  })

  it("isn't offered to viewers", () => {
    mocks.canEdit = false
    renderPage()
    expect(
      screen.queryByRole('button', { name: 'Actions for Day 1' }),
    ).toBeNull()
  })
})
