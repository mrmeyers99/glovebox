// Suggested places along the trip's route while the map's Suggestions toggle
// is on. Asks the `suggestions` function for the corridor's tiles, then asks
// again every SUGGESTIONS_POLL_MS for tiles that are still being filled, until
// none are left. Tiles that failed (on the server, or our request) aren't
// asked for again until the toggle is turned off and on; the fill worker
// retries failed tiles itself. Tiles already answered aren't asked for again,
// so editing the route only fetches the tiles it newly passes through.

import { useEffect, useMemo, useRef, useState } from 'react'
import { corridorTiles, type LatLng } from '../lib/corridor'
import {
  bestFirst,
  fetchSuggestions,
  type Suggestion,
} from '../lib/suggestions'

/** How often to ask again for tiles that are still being filled. */
export const SUGGESTIONS_POLL_MS = 20_000

/** Wait this long after the route changes (e.g. routes arriving) before asking. */
export const SUGGESTIONS_DEBOUNCE_MS = 500

export interface SuggestionsState {
  /** Places along the route, best first. Empty while off. */
  places: Suggestion[]
  /** Tiles not answered yet or still being filled: more places may come. */
  pending: number
  /** Tiles the server couldn't fill for now. */
  failed: number
  /** Our request for some tiles failed. */
  error: boolean
}

type TileState =
  | { status: 'done'; places: Suggestion[] }
  /** 'error': our request failed, rather than the server's fill. */
  | { status: 'pending' | 'failed' | 'error' }

const OFF: SuggestionsState = {
  places: [],
  pending: 0,
  failed: 0,
  error: false,
}

export function useSuggestions(
  lines: LatLng[][],
  enabled: boolean,
): SuggestionsState {
  // Changes only when the set of tiles does, not on every route update.
  const tilesKey = useMemo(
    () => [...corridorTiles(lines)].sort().join(' '),
    [lines],
  )
  const [tiles, setTiles] = useState<ReadonlyMap<string, TileState>>(
    () => new Map(),
  )
  // The latest tiles, read when asking without re-running the effect.
  const tilesRef = useRef(tiles)
  // Whether the toggle was on the last time the effect ran.
  const wasEnabled = useRef(false)

  useEffect(() => {
    const justEnabled = enabled && !wasEnabled.current
    wasEnabled.current = enabled
    if (!enabled || tilesKey === '') return
    const wanted = tilesKey.split(' ')
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const update = (next: ReadonlyMap<string, TileState>) => {
      tilesRef.current = next
      setTiles(next)
    }

    const ask = (delay: number, retryFailed: boolean) => {
      const toAsk = wanted.filter((key) => {
        const status = tilesRef.current.get(key)?.status
        if (status === undefined || status === 'pending') return true
        return retryFailed && status !== 'done'
      })
      if (toAsk.length === 0) return
      timer = setTimeout(() => {
        fetchSuggestions(toAsk).then(
          (result) => {
            if (cancelled) return
            const pending = new Set(result.pending)
            const failed = new Set(result.failed)
            const next = new Map(tilesRef.current)
            for (const key of toAsk) {
              if (pending.has(key)) next.set(key, { status: 'pending' })
              else if (failed.has(key)) next.set(key, { status: 'failed' })
              else next.set(key, { status: 'done', places: [] })
            }
            for (const place of result.places) {
              const tile = next.get(place.tile_key)
              if (tile?.status === 'done') tile.places.push(place)
            }
            update(next)
            ask(SUGGESTIONS_POLL_MS, false)
          },
          (reason: unknown) => {
            if (cancelled) return
            console.error('Could not load suggestions', reason)
            const next = new Map(tilesRef.current)
            for (const key of toAsk) next.set(key, { status: 'error' })
            update(next)
          },
        )
      }, delay)
    }

    ask(SUGGESTIONS_DEBOUNCE_MS, justEnabled)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, tilesKey])

  return useMemo(() => {
    if (!enabled || tilesKey === '') return OFF
    let pending = 0
    let failed = 0
    let error = false
    const places: Suggestion[] = []
    for (const key of tilesKey.split(' ')) {
      const tile = tiles.get(key)
      if (tile?.status === 'done') places.push(...tile.places)
      else if (tile?.status === 'failed') failed++
      else if (tile?.status === 'error') error = true
      else pending++
    }
    places.sort(bestFirst)
    return { places, pending, failed, error }
  }, [enabled, tilesKey, tiles])
}
