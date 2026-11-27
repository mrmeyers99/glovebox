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
import type { LatLng } from '../lib/corridor'
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
