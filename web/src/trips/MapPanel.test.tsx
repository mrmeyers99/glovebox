// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../auth/useAuth'
import type { LatLng } from '../lib/corridor'
import { DEFAULT_FILTER, filterStorageKey } from '../lib/suggestionFilters'
import type { TripSummary } from '../lib/tripMath'
import { MapPanel, SuggestionsNote } from './MapPanel'
import type { SuggestionsState } from './useSuggestions'

const mocks = vi.hoisted(() => ({
  state: {
    places: [],
    pending: 0,
    failed: 0,
    error: false,
  } as SuggestionsState,
  calls: [] as [LatLng[][], boolean][],
  mapProps: [] as Record<string, unknown>[],
}))

vi.mock('./useSuggestions', () => ({
  useSuggestions: (lines: LatLng[][], enabled: boolean) => {
    mocks.calls.push([lines, enabled])
    return mocks.state
  },
}))

vi.mock('./TripMap', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.mapProps.push(props)
    return <div data-testid="trip-map" />
  },
}))

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const summary = {
  legs: [
    {
      from: { lat: 40, lng: -100 },
      to: { lat: 41, lng: -101 },
      route: null,
    },
  ],
} as unknown as TripSummary

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  // jsdom lays nothing out; give the panel a size so the map renders.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300)
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterEach(() => {
  cleanup()
  mocks.calls = []
  mocks.mapProps = []
  mocks.state = { places: [], pending: 0, failed: 0, error: false }
})

const renderPanel = () =>
  render(
    <MapPanel
      days={[]}
      stops={[]}
      summary={summary}
      selection={null}
      onSelectStop={() => {}}
    />,
  )

describe('MapPanel suggestions', () => {
  it('turns suggestions on and off with the toggle', async () => {
    renderPanel()
    const toggle = await screen.findByRole('checkbox', { name: 'Suggestions' })
    expect(mocks.calls.at(-1)).toEqual([
      [
        [
          [40, -100],
          [41, -101],
        ],
      ],
      false,
    ])
    fireEvent.click(toggle)
    expect(mocks.calls.at(-1)?.[1]).toBe(true)
    fireEvent.click(toggle)
    expect(mocks.calls.at(-1)?.[1]).toBe(false)
  })

  it('passes the places and route lines to the map', async () => {
    const places = [{ id: 1 }] as unknown as SuggestionsState['places']
    mocks.state = { ...mocks.state, places }
    renderPanel()
    await screen.findByTestId('trip-map')
    await waitFor(() =>
      expect(mocks.mapProps.at(-1)).toMatchObject({
        suggestions: places,
        corridor: mocks.calls.at(-1)?.[0],
      }),
    )
  })

  it('passes adding a suggestion through to the map', async () => {
    const onAddSuggestion = vi.fn()
    render(
      <MapPanel
        days={[]}
        stops={[]}
        summary={summary}
        selection={null}
        onSelectStop={() => {}}
        onAddSuggestion={onAddSuggestion}
      />,
    )
    await screen.findByTestId('trip-map')
    expect(mocks.mapProps.at(-1)?.onAddSuggestion).toBe(onAddSuggestion)
  })

  it('still toggles skipped stops', async () => {
    renderPanel()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Show skipped' }),
    )
    expect(mocks.mapProps.at(-1)?.showSkipped).toBe(true)
  })

  it('says when places are on the way', async () => {
    mocks.state = { ...mocks.state, pending: 3 }
    renderPanel()
    expect((await screen.findByRole('status')).textContent).toBe(
      'Finding places along your route…',
    )
  })
})

describe('SuggestionsNote', () => {
  const state = (over: Partial<SuggestionsState>): SuggestionsState => ({
    places: [],
    pending: 0,
    failed: 0,
    error: false,
    ...over,
  })
  const text = (s: SuggestionsState) => {
    const { container } = render(<SuggestionsNote state={s} />)
    const out = container.textContent
    cleanup()
    return out
  }

  it('says what is happening', () => {
    expect(text(state({}))).toBe('')
    expect(text(state({ pending: 1, failed: 1 }))).toBe(
      'Finding places along your route…',
    )
    expect(text(state({ error: true, pending: 1 }))).toBe(
      "Couldn't load suggestions. Try again later.",
    )
    expect(text(state({ failed: 2 }))).toBe(
      "Couldn't find places along your route yet.",
    )
    expect(
      text(
        state({
          failed: 2,
          places: [{}] as unknown as SuggestionsState['places'],
        }),
      ),
    ).toBe('')
  })
})

describe('MapPanel suggestion filters', () => {
  const suggestion = (
    id: number,
    category: string,
    percentile: number,
    lat = 40,
  ) => ({
    id,
    name: `Place ${id}`,
    kind: 'attraction' as const,
    category,
    lat,
    lng: -100,
    tile_key: '40_-100',
    score: 1,
    percentile,
    image: null,
    wikipedia_url: null,
    osm_url: null,
  })
  const places = [
    suggestion(1, 'tourism=museum', 0.9),
    suggestion(2, 'leisure=park', 0.3),
    // About 55 km north of the route's start, beyond every distance limit.
    suggestion(3, 'tourism=viewpoint', 0.85, 39.5),
  ]
  const shownIds = () =>
    (mocks.mapProps.at(-1)!.suggestions as { id: number }[]).map((p) => p.id)

  const renderAs = (userId: string | null) =>
    render(
      <AuthContext.Provider
        value={{
          session: userId ? ({ user: { id: userId } } as Session) : null,
          loading: false,
        }}
      >
        <MapPanel
          days={[]}
          stops={[]}
          summary={summary}
          selection={null}
          onSelectStop={() => {}}
        />
      </AuthContext.Provider>,
    )

  afterEach(() => localStorage.clear())

  it('shows the panel only while suggestions are on', async () => {
    mocks.state = { ...mocks.state, places }
    renderAs('u1')
    const toggle = await screen.findByRole('checkbox', { name: 'Suggestions' })
    expect(screen.queryByText('Filter suggestions')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('Filter suggestions')).toBeTruthy()
  })

  it('filters the places on the map without fetching again', async () => {
    mocks.state = { ...mocks.state, places }
    renderAs('u1')
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Suggestions' }),
    )
    expect(shownIds()).toEqual([1, 2, 3])
    const calls = mocks.calls.length
    const lines = mocks.calls.at(-1)?.[0]

    fireEvent.click(screen.getByRole('checkbox', { name: 'Top picks only' }))
    expect(shownIds()).toEqual([1, 3])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Museums' }))
    expect(shownIds()).toEqual([3])
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Distance from route' }),
      { target: { value: '40' } },
    )
    expect(shownIds()).toEqual([])
    expect(screen.getByRole('status').textContent).toBe(
      'No places match your filters.',
    )

    // The hook only re-rendered: same lines, still on, so nothing to fetch.
    expect(mocks.calls.length).toBeGreaterThan(calls)
    for (const call of mocks.calls.slice(calls)) {
      expect(call[0]).toBe(lines)
      expect(call[1]).toBe(true)
    }
  })

  it('remembers the filter per user', async () => {
    mocks.state = { ...mocks.state, places }
    renderAs('u1')
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Suggestions' }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Top picks only' }))
    cleanup()

    renderAs('u1')
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Suggestions' }),
    )
    expect(shownIds()).toEqual([1, 3])
    cleanup()

    renderAs('u2')
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Suggestions' }),
    )
    expect(shownIds()).toEqual([1, 2, 3])
  })

  it("switches to another user's filter when they sign in", async () => {
    mocks.state = { ...mocks.state, places }
    localStorage.setItem(
      filterStorageKey('u2'),
      JSON.stringify({ ...DEFAULT_FILTER, categories: ['nature'] }),
    )
    const { rerender } = renderAs('u1')
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Suggestions' }),
    )
    expect(shownIds()).toEqual([1, 2, 3])
    rerender(
      <AuthContext.Provider
        value={{ session: { user: { id: 'u2' } } as Session, loading: false }}
      >
        <MapPanel
          days={[]}
          stops={[]}
          summary={summary}
          selection={null}
          onSelectStop={() => {}}
        />
      </AuthContext.Provider>,
    )
    expect(shownIds()).toEqual([2])
  })
})
