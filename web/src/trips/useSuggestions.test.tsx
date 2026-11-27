// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { corridorTiles, type LatLng } from '../lib/corridor'
import type { Suggestion, SuggestionsResult } from '../lib/suggestions'
import {
  SUGGESTIONS_DEBOUNCE_MS,
  SUGGESTIONS_POLL_MS,
  useSuggestions,
} from './useSuggestions'

const fetchSuggestions =
  vi.fn<(tiles: readonly string[]) => Promise<SuggestionsResult>>()

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/suggestions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/suggestions')>()),
  fetchSuggestions: (tiles: readonly string[]) => fetchSuggestions(tiles),
}))

const route: LatLng[][] = [
  [
    [41.1, -100.8],
    [41.2, -100.2],
  ],
]
const tiles = [...corridorTiles(route)].sort()
const longer: LatLng[][] = [[...route[0], [41.3, -99.2]]]
const longerTiles = [...corridorTiles(longer)].sort()

function place(id: number, tile: string, percentile = 0.5): Suggestion {
  return {
    id,
    name: `Place ${id}`,
    kind: 'attraction',
    category: 'tourism=museum',
    lat: 41,
    lng: -100,
    tile_key: tile,
    score: 1,
    percentile,
    image: null,
    wikipedia_url: null,
    osm_url: null,
  }
}

const answer = (over: Partial<SuggestionsResult> = {}) =>
  Promise.resolve({ places: [], pending: [], failed: [], ...over })

/** Runs timers and lets the fetch's promise settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchSuggestions.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const render = (lines: LatLng[][], enabled: boolean) =>
  renderHook(({ lines, enabled }) => useSuggestions(lines, enabled), {
    initialProps: { lines, enabled },
  })

describe('useSuggestions', () => {
  it('asks for nothing while off', async () => {
    const { result } = render(route, false)
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).not.toHaveBeenCalled()
    expect(result.current).toEqual({
      places: [],
      pending: 0,
      failed: 0,
      error: false,
    })
  })

  it('asks for nothing while the trip has no route', async () => {
    const { result } = render([], true)
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(0)
  })

  it('loads the corridor tiles, best first', async () => {
    fetchSuggestions.mockReturnValue(
      answer({
        places: [place(1, tiles[0], 0.2), place(2, tiles[1], 0.9)],
      }),
    )
    const { result } = render(route, true)
    // Not loaded yet: every tile is still to come.
    expect(result.current.pending).toBe(tiles.length)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(fetchSuggestions).toHaveBeenCalledWith(tiles)
    expect(result.current.places.map((p) => p.id)).toEqual([2, 1])
    expect(result.current.pending).toBe(0)
    // Nothing pending: no more requests.
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).toHaveBeenCalledTimes(1)
  })

  it('asks again for pending tiles until none are left', async () => {
    const [first, ...rest] = tiles
    fetchSuggestions
      .mockReturnValueOnce(answer({ places: [place(1, first)], pending: rest }))
      .mockReturnValueOnce(
        answer({ places: [place(2, rest[0])], pending: rest.slice(1) }),
      )
      .mockReturnValue(answer())
    const { result } = render(route, true)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(result.current.pending).toBe(rest.length)
    expect(result.current.places).toHaveLength(1)

    await advance(SUGGESTIONS_POLL_MS - 1)
    expect(fetchSuggestions).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchSuggestions).toHaveBeenLastCalledWith(rest)
    expect(result.current.places).toHaveLength(2)

    await advance(SUGGESTIONS_POLL_MS)
    expect(fetchSuggestions).toHaveBeenLastCalledWith(rest.slice(1))
    expect(result.current.pending).toBe(0)
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).toHaveBeenCalledTimes(3)
  })

  it('stops asking when only failed tiles are left', async () => {
    fetchSuggestions.mockReturnValue(answer({ failed: tiles }))
    const { result } = render(route, true)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(result.current.failed).toBe(tiles.length)
    expect(result.current.pending).toBe(0)
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).toHaveBeenCalledTimes(1)
  })

  it('turning off clears the places and stops asking', async () => {
    fetchSuggestions.mockReturnValue(
      answer({ places: [place(1, tiles[0])], pending: tiles.slice(1) }),
    )
    const { result, rerender } = render(route, true)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(result.current.places).toHaveLength(1)
    rerender({ lines: route, enabled: false })
    expect(result.current.places).toEqual([])
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).toHaveBeenCalledTimes(1)
  })

  it('drops an answer that arrives after turning off', async () => {
    let resolve: (value: SuggestionsResult) => void = () => {}
    fetchSuggestions.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result, rerender } = render(route, true)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    rerender({ lines: route, enabled: false })
    await act(async () => resolve({ places: [], pending: tiles, failed: [] }))
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).toHaveBeenCalledTimes(1)
    expect(result.current.pending).toBe(0)
  })

  it('keeps answered tiles and asks only for new ones when the route grows', async () => {
    fetchSuggestions.mockReturnValue(answer())
    const { rerender } = render(route, true)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    rerender({ lines: longer, enabled: true })
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    const added = longerTiles.filter((t) => !tiles.includes(t))
    expect(added.length).toBeGreaterThan(0)
    expect(fetchSuggestions).toHaveBeenLastCalledWith(added)
  })

  it('shows an error when the request fails, and retries on turning on again', async () => {
    fetchSuggestions.mockRejectedValueOnce(new Error('down'))
    const { result, rerender } = render(route, true)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(result.current.error).toBe(true)
    expect(result.current.pending).toBe(0)
    await advance(SUGGESTIONS_POLL_MS * 2)
    expect(fetchSuggestions).toHaveBeenCalledTimes(1)

    fetchSuggestions.mockReturnValue(answer({ places: [place(1, tiles[0])] }))
    rerender({ lines: route, enabled: false })
    rerender({ lines: route, enabled: true })
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    expect(fetchSuggestions).toHaveBeenCalledTimes(2)
    expect(fetchSuggestions).toHaveBeenLastCalledWith(tiles)
    expect(result.current.error).toBe(false)
    expect(result.current.places).toHaveLength(1)
  })

  it('drops a failure that arrives after turning off', async () => {
    let reject: (reason: unknown) => void = () => {}
    fetchSuggestions.mockReturnValue(new Promise((_, r) => (reject = r)))
    const { result, rerender } = render(route, true)
    await advance(SUGGESTIONS_DEBOUNCE_MS)
    rerender({ lines: route, enabled: false })
    await act(async () => reject(new Error('late')))
    rerender({ lines: route, enabled: true })
    expect(result.current.error).toBe(false)
  })
})
