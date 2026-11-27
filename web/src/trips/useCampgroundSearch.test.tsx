// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/useAuth'
import {
  campgroundFilterKey,
  DEFAULT_CAMPGROUND_FILTER,
} from '../lib/campgrounds'
import type { Stop } from '../lib/database.types'
import type { Suggestion, SuggestionsResult } from '../lib/suggestions'
import type { DaySummary } from '../lib/tripMath'
import { useCampgrounds } from './useCampgrounds'
import { useCampgroundPlaces, useCampgroundSearch } from './useCampgroundSearch'
import { SUGGESTIONS_DEBOUNCE_MS } from './useSuggestions'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  lookup: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: (_: string, ids: number[]) => ({
          eq: (column: string, value: string) =>
            mocks.lookup(table, ids, column, value),
        }),
      }),
    }),
  },
}))
vi.mock('../lib/suggestions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/suggestions')>()),
  fetchSuggestions: (tiles: readonly string[], kind: string) =>
    mocks.fetch(tiles, kind),
}))

function camp(id: number, lat: number, over: Partial<Suggestion> = {}) {
  return {
    id,
    name: `Camp ${id}`,
    kind: 'campground',
    category: 'tourism=camp_site',
    lat,
    lng: -103,
    tile_key: '44.0_-103.0',
    score: 1,
    percentile: 0.5,
    image: null,
    wikipedia_url: null,
    osm_url: null,
    amenities: null,
    ...over,
  } satisfies Suggestion
}

const answer = (places: Suggestion[]): Promise<SuggestionsResult> =>
  Promise.resolve({
    places,
    pending: [],
    failed: [],
    scoring: [],
  })

const stopRow = (id: string, over: Partial<Stop> = {}): Stop => ({
  id,
  trip_id: 't',
  day_id: 'd1',
  position: 'a0',
  kind: 'waypoint',
  name: `Stop ${id}`,
  lat: 44,
  lng: -103,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  place_id: null,
  created_at: '',
  updated_at: '',
  updated_by: null,
  ...over,
})

const days = (stops: Stop[]) =>
  [
    {
      dayId: 'd1',
      dayNumber: 1,
      stops: stops.map((s) => ({ id: s.id, skipped: s.skipped })),
    },
    { dayId: 'd2', dayNumber: 2, stops: [] },
  ] as unknown as DaySummary[]

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  mocks.fetch.mockReset()
  mocks.lookup.mockReset()
  mocks.lookup.mockResolvedValue({ data: [], error: null })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useCampgrounds', () => {
  it('asks for campgrounds near the point, and keeps the near ones', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockReturnValue(
      answer([camp(1, 44.3), camp(2, 44.1), camp(3, 45)]),
    )
    const { result, rerender } = renderHook(
      ({ point }) => useCampgrounds(point),
      { initialProps: { point: null as [number, number] | null } },
    )
    expect(result.current.nearby).toEqual([])
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(mocks.fetch).not.toHaveBeenCalled()
    rerender({ point: [44, -103] })
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [tiles, kind] = mocks.fetch.mock.calls[0]
    expect(kind).toBe('campground')
    expect(tiles).toContain('44.0_-103.0')
    expect(result.current.nearby.map((c) => c.place.id)).toEqual([2, 1])
  })
})

describe('useCampgroundSearch', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider
      value={{ session: { user: { id: 'u1' } } as Session, loading: false }}
    >
      {children}
    </AuthContext.Provider>
  )

  it("opens on a day's last stop, filters, and closes", async () => {
    vi.useFakeTimers()
    mocks.fetch.mockReturnValue(
      answer([
        camp(1, 44.1, {
          amenities: { showers: false } as Suggestion['amenities'],
        }),
        camp(2, 44.2),
      ]),
    )
    const stops = [stopRow('a'), stopRow('b', { place_id: 2 })]
    const { result } = renderHook(
      () => useCampgroundSearch(days(stops), stops),
      { wrapper },
    )
    expect(result.current.search).toBeNull()
    act(() => result.current.open('d2'))
    // The last day doesn't end anywhere for the night.
    expect(result.current.search).toBeNull()
    act(() => result.current.open('d1'))
    expect(result.current.search).toMatchObject({
      dayId: 'd1',
      dayNumber: 1,
      stop: { id: 'b' },
      currentPlaceId: null,
    })
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(result.current.shown.map((c) => c.place.id)).toEqual([1, 2])
    // Stop b was added from campground 2, now known.
    expect(result.current.search?.currentPlaceId).toBe(2)
    expect(result.current.campgroundPlaceIds).toEqual(new Set([1, 2]))

    const showers = { ...DEFAULT_CAMPGROUND_FILTER, amenities: ['showers'] }
    act(() => result.current.setFilter(showers as never))
    expect(result.current.shown.map((c) => c.place.id)).toEqual([2])
    expect(
      JSON.parse(localStorage.getItem(campgroundFilterKey('u1')) ?? ''),
    ).toEqual(showers)

    act(() => result.current.close())
    expect(result.current.search).toBeNull()
  })

  it('follows another user signing in', () => {
    localStorage.setItem(
      campgroundFilterKey('u2'),
      JSON.stringify({ free: true }),
    )
    let user = 'u1'
    const auth = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider
        value={{ session: { user: { id: user } } as Session, loading: false }}
      >
        {children}
      </AuthContext.Provider>
    )
    const { result, rerender } = renderHook(() => useCampgroundSearch([], []), {
      wrapper: auth,
    })
    expect(result.current.filter.free).toBe(false)
    user = 'u2'
    rerender()
    expect(result.current.filter.free).toBe(true)
  })
})

describe('useCampgroundPlaces', () => {
  it('looks up which places are campgrounds', async () => {
    mocks.lookup.mockResolvedValue({ data: [{ id: 7 }], error: null })
    const { result } = renderHook(() =>
      useCampgroundPlaces([
        { place_id: 9 },
        { place_id: 7 },
        { place_id: null },
      ]),
    )
    await waitFor(() => expect(result.current).toEqual(new Set([7])))
    expect(mocks.lookup).toHaveBeenCalledWith(
      'places',
      [7, 9],
      'kind',
      'campground',
    )
  })

  it('asks nothing without places, and survives errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const none = renderHook(() => useCampgroundPlaces([{ place_id: null }]))
    expect(none.result.current.size).toBe(0)
    expect(mocks.lookup).not.toHaveBeenCalled()
    mocks.lookup.mockResolvedValue({ data: null, error: { message: 'x' } })
    const { result } = renderHook(() => useCampgroundPlaces([{ place_id: 1 }]))
    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(result.current.size).toBe(0)
  })

  it('ignores an answer that comes after unmounting', async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.lookup.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = renderHook(() => useCampgroundPlaces([{ place_id: 1 }]))
    unmount()
    await act(async () => resolve({ data: [{ id: 1 }], error: null }))
  })
})
