// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import type { Suggestion } from '../lib/suggestions'
import { summarizeTrip } from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { TripPage } from './TripPage'
import type { CampgroundsState } from './useCampgrounds'

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
  place_id: null,
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
  mapPanel: {} as Record<string, unknown>,
  campgrounds: null as CampgroundsState | null,
  campgroundPoints: [] as unknown[],
  campgroundRows: [] as { id: number }[],
}))

const noCampgrounds: CampgroundsState = {
  places: [],
  nearby: [],
  pending: 0,
  failed: 0,
  error: false,
}
vi.mock('./useCampgrounds', () => ({
  useCampgrounds: (point: unknown) => {
    mocks.campgroundPoints.push(point)
    return point ? (mocks.campgrounds ?? noCampgrounds) : noCampgrounds
  },
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
vi.mock('./MapPanel', () => ({
  MapPanel: (props: Record<string, unknown>) => {
    mocks.mapPanel = props
    return null
  },
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    // The places lookup for stops added from a campground.
    from: () => ({
      select: () => ({
        in: () => ({
          eq: () =>
            Promise.resolve({ data: mocks.campgroundRows, error: null }),
        }),
      }),
    }),
  },
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
  mocks.campgrounds = null
  mocks.campgroundPoints = []
  mocks.campgroundRows = []
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

describe('TripPage, adding a suggested place', () => {
  const corn = {
    id: 42,
    name: 'Corn Palace',
    lat: 0.1,
    lng: 0.1,
  } as Suggestion

  it('opens the stop form for it on its default day', () => {
    renderPage()
    const add = mocks.mapPanel.onAddSuggestion as (p: Suggestion) => void
    act(() => add(corn))
    screen.getByRole('heading', { name: 'Add to trip' })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Corn Palace',
    )
    expect(screen.getByRole('combobox', { name: 'Day' })).toHaveProperty(
      'value',
      'd1',
    )
  })

  it('also adds a stop at a spot on the map', () => {
    renderPage()
    const addAt = mocks.mapPanel.onAddStopAt as (at: {
      lat: number
      lng: number
    }) => void
    act(() => addAt({ lat: 1, lng: 2 }))
    screen.getByRole('heading', { name: 'Add a stop here' })
    cleanup()
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: /Add stop/ })[0])
    screen.getByRole('heading', { name: 'Add a stop to Day 1' })
  })

  it("isn't offered to viewers or trips without days", () => {
    mocks.canEdit = false
    renderPage()
    expect(mocks.mapPanel.onAddSuggestion).toBeUndefined()
    cleanup()
    mocks.canEdit = true
    mocks.days = []
    mocks.stops = []
    renderPage()
    expect(mocks.mapPanel.onAddSuggestion).toBeUndefined()
  })
})

describe('TripPage, campgrounds near the end of a day', () => {
  const camp = (id: number, name: string) =>
    ({
      id,
      name,
      kind: 'campground',
      category: 'tourism=camp_site',
      lat: 0.01,
      lng: 0,
      tile_key: '0.0_0.0',
      score: 1,
      percentile: 0.5,
      image: null,
      wikipedia_url: null,
      osm_url: null,
      amenities: null,
      parent_name: null,
    }) satisfies Suggestion
  const pines = camp(7, 'Pines Campground')
  const lakeside = camp(8, 'Lakeside RV Park')
  const found = (): CampgroundsState => ({
    places: [pines, lakeside],
    nearby: [
      { place: pines, km: 1 },
      { place: lakeside, km: 2 },
    ],
    pending: 0,
    failed: 0,
    error: false,
  })

  it("lists campgrounds near a day's last stop, and adds one as its last stop", () => {
    mocks.campgrounds = found()
    renderPage()
    // Not on the last day.
    const find = screen.getAllByRole('button', { name: /Find campgrounds/ })
    expect(find).toHaveLength(1)
    fireEvent.click(find[0])
    screen.getByRole('heading', { name: 'Campgrounds near Museum' })
    expect(mocks.campgroundPoints.at(-1)).toEqual([0, 0])
    const layer = mocks.mapPanel.campgrounds as {
      places: Suggestion[]
      dayNumber: number
      onAdd?: unknown
    }
    expect(layer.places.map((p) => p.name)).toEqual([
      'Pines Campground',
      'Lakeside RV Park',
    ])
    expect(layer.dayNumber).toBe(1)
    expect(layer.onAdd).toBeTypeOf('function')
    fireEvent.click(
      screen.getAllByRole('button', {
        name: "Add as Day 1's overnight stop",
      })[1],
    )
    screen.getByRole('heading', { name: 'Add to trip' })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty(
      'value',
      'Lakeside RV Park',
    )
    expect(screen.getByRole('combobox', { name: 'Day' })).toHaveProperty(
      'value',
      'd1',
    )
  })

  it('goes back to the days', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Find campgrounds/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to days' }))
    screen.getByRole('heading', { name: 'Day 1' })
    expect(mocks.mapPanel.campgrounds).toBeNull()
  })

  it("is offered on the map while a day's last stop is selected", () => {
    // The list scrolls to a stop selected on the map.
    Element.prototype.scrollIntoView ??= () => {}
    renderPage()
    const select = mocks.mapPanel.onSelectStop as (id: string) => void
    act(() => select('s1'))
    expect(mocks.mapPanel.findCampgrounds).toBeNull()
    act(() => select('s2'))
    const offer = mocks.mapPanel.findCampgrounds as {
      stopName: string
      onFind: () => void
    }
    expect(offer.stopName).toBe('Museum')
    act(() => offer.onFind())
    screen.getByRole('heading', { name: 'Campgrounds near Museum' })
    expect(screen.getByRole('tab', { name: 'List' })).toHaveProperty(
      'ariaSelected',
      'true',
    )
    // Already open for that day.
    expect(mocks.mapPanel.findCampgrounds).toBeNull()
  })

  it('lets viewers look but not add', () => {
    mocks.canEdit = false
    mocks.campgrounds = found()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Find campgrounds/ }))
    screen.getByRole('heading', { name: 'Campgrounds near Museum' })
    expect(screen.queryByRole('button', { name: /overnight stop/ })).toBeNull()
    expect(
      (mocks.mapPanel.campgrounds as { onAdd?: unknown }).onAdd,
    ).toBeUndefined()
  })

  it('shows a day that already ends at a campground, and finds others', async () => {
    mocks.stops = [diner, { ...museum, name: 'Pines', place_id: 7 }]
    mocks.campgroundRows = [{ id: 7 }]
    mocks.campgrounds = found()
    renderPage()
    await screen.findByText('Overnight at')
    fireEvent.click(
      screen.getByRole('button', { name: 'Find other campgrounds' }),
    )
    screen.getByRole('heading', { name: 'Other campgrounds near Pines' })
    screen.getByText("Day 1's overnight stop")
  })
})
