// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CAMPGROUND_FILTER,
  type CampgroundFilter,
  type NearbyCampground,
} from '../lib/campgrounds'
import type { CampgroundAmenities, Suggestion } from '../lib/suggestions'
import {
  CampgroundFilters,
  CampgroundPanel,
  CampgroundsNote,
} from './CampgroundPanel'
import type { CampgroundsState } from './useCampgrounds'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

afterEach(cleanup)

const unknown: CampgroundAmenities = {
  tents: null,
  rvs: null,
  hookups: null,
  drinking_water: null,
  dump_station: null,
  showers: null,
  toilets: null,
  fee: null,
  fee_amount: null,
  reservation: null,
  capacity: null,
  website: null,
  phone: null,
  operator: null,
  ownership: null,
}

function camp(id: number, over: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    name: `Camp ${id}`,
    kind: 'campground',
    category: 'tourism=camp_site',
    lat: 44,
    lng: -103,
    tile_key: '44.0_-103.0',
    score: 1,
    percentile: 0.5,
    image: null,
    wikipedia_url: null,
    osm_url: null,
    amenities: unknown,
    parent_name: null,
    ...over,
  }
}

const sylvan = camp(1, {
  name: 'Sylvan Lake Campground',
  parent_name: 'Custer State Park',
  osm_url: 'https://www.openstreetmap.org/way/1',
  amenities: {
    ...unknown,
    tents: true,
    showers: false,
    fee: true,
    fee_amount: '$30',
    reservation: 'required',
    website: 'https://gfp.sd.gov',
  },
})
const kOA = camp(2, { name: 'Rushmore KOA', category: 'tourism=caravan_site' })
const free = camp(3, {
  name: 'Forest Camp',
  amenities: { ...unknown, fee: false, website: 'https://fs.usda.gov' },
})

const nearby: NearbyCampground[] = [
  { place: sylvan, km: 0.05 },
  { place: kOA, km: 8 },
  { place: free, km: 12 },
]

const state = (over: Partial<CampgroundsState> = {}): CampgroundsState => ({
  places: nearby.map((c) => c.place),
  nearby,
  pending: 0,
  failed: 0,
  error: false,
  ...over,
})

function renderPanel(over: Partial<Parameters<typeof CampgroundPanel>[0]>) {
  const props = {
    dayNumber: 2,
    stopName: 'Custer',
    currentPlaceId: null,
    state: state(),
    shown: nearby,
    filter: DEFAULT_CAMPGROUND_FILTER,
    onFilterChange: vi.fn(),
    inTrip: new Set<number>(),
    onAdd: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<CampgroundPanel {...props} />)
  return props
}

describe('CampgroundPanel', () => {
  it('lists campgrounds with what they offer, nearest first', () => {
    renderPanel({})
    screen.getByRole('heading', { name: 'Campgrounds near Custer' })
    screen.getByText(/Day 2 ends here/)
    const rows = screen.getAllByRole('listitem', { name: /Camp|KOA/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Sylvan Lake Campground',
      'Rushmore KOA',
      'Forest Camp',
    ])
    const first = screen.getByRole('listitem', {
      name: 'Sylvan Lake Campground',
    })
    expect(first.textContent).toContain('Campground · Here')
    expect(first.textContent).toContain('In Custer State Park')
    expect(first.textContent).toContain('$30 · Reservations required')
    within(first).getByText('Tents')
    within(first).getByText('No showers')
    expect(
      screen.getByRole('link', { name: 'Website & reservations' }),
    ).toHaveProperty('href', 'https://gfp.sd.gov/')
    screen.getByRole('link', { name: 'OpenStreetMap' })
    expect(
      screen.getByRole('listitem', { name: 'Rushmore KOA' }).textContent,
    ).toContain('RV park · 5 mi away')
    expect(
      screen.getByRole('listitem', { name: 'Forest Camp' }).textContent,
    ).toContain('Free')
    screen.getByRole('link', { name: 'Website' })
  })

  it('adds one as the overnight stop, and goes back', () => {
    const props = renderPanel({ inTrip: new Set([2]) })
    const add = screen.getAllByRole('button', {
      name: "Add as Day 2's overnight stop",
    })
    // Not for the one already in the trip.
    expect(add).toHaveLength(2)
    screen.getByText('In your trip')
    fireEvent.click(add[1])
    expect(props.onAdd).toHaveBeenCalledWith(free)
    fireEvent.click(screen.getByRole('button', { name: 'Back to days' }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it("marks the day's current campground and looks for others", () => {
    renderPanel({ currentPlaceId: 1, inTrip: new Set([1]) })
    screen.getByRole('heading', { name: 'Other campgrounds near Custer' })
    expect(screen.getByText(/Tonight:/).textContent).toBe(
      'Tonight: Sylvan Lake Campground',
    )
    screen.getByText("Day 2's overnight stop")
  })

  it('offers no adding to viewers', () => {
    renderPanel({ onAdd: undefined })
    expect(screen.queryByRole('button', { name: /overnight/ })).toBeNull()
  })
})

describe('CampgroundsNote', () => {
  const note = (s: CampgroundsState, shown = s.nearby.length) => {
    cleanup()
    render(<CampgroundsNote state={s} shown={shown} />)
    return screen.queryByRole('status')?.textContent ?? null
  }

  it('says what is happening', () => {
    expect(note(state({ error: true }))).toBe(
      "Couldn't load campgrounds. Try again later.",
    )
    expect(note(state({ pending: 2 }))).toBe('Finding campgrounds…')
    expect(note(state({ nearby: [] }))).toBe('No campgrounds found nearby.')
    expect(note(state({ nearby: [], failed: 1 }))).toBe(
      "Couldn't look for campgrounds here yet. Try again later.",
    )
    expect(note(state(), 0)).toBe('No campgrounds match your filters.')
    expect(note(state())).toBeNull()
  })
})

describe('CampgroundFilters', () => {
  function renderFilters(filter: CampgroundFilter = DEFAULT_CAMPGROUND_FILTER) {
    const onChange = vi.fn()
    render(<CampgroundFilters filter={filter} onChange={onChange} />)
    return onChange
  }

  it('changes amenities, keeping them in order', () => {
    const onChange = renderFilters({
      ...DEFAULT_CAMPGROUND_FILTER,
      amenities: ['showers'],
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tents' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_CAMPGROUND_FILTER,
      amenities: ['tents', 'showers'],
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Showers' }))
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_CAMPGROUND_FILTER)
    // Unknowns are still shown, and it says so.
    screen.getByText(/those that don't say are still shown/)
  })

  it('changes fee, ownership and confirmed only', () => {
    const onChange = renderFilters()
    expect(screen.queryByText(/still shown/)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Free' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_CAMPGROUND_FILTER,
      free: true,
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Run by' }), {
      target: { value: 'public' },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_CAMPGROUND_FILTER,
      ownership: 'public',
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Only campgrounds that say so' }),
    )
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_CAMPGROUND_FILTER,
      confirmedOnly: true,
    })
  })
})
