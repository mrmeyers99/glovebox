import { useEffect, useState } from 'react'
import { searchPlaces, type LatLng, type Place } from '../lib/geocode'
import { placeQuery } from './addStop'

const DEBOUNCE_MS = 300

export type PlaceSearch = {
  results: Place[]
  searching: boolean
  error: string | null
}

const idle: PlaceSearch = { results: [], searching: false, error: null }

/**
 * Place search results for `text`, fetched 300ms after it stops changing.
 * Responses for superseded queries are dropped.
 */
export function usePlaceSearch(text: string, focus?: LatLng): PlaceSearch {
  const q = placeQuery(text)
  const lat = focus?.lat
  const lng = focus?.lng
  const [state, setState] = useState<PlaceSearch & { q: string | null }>({
    ...idle,
    q: null,
  })

  useEffect(() => {
    if (q === null) return
    let active = true
    const timer = setTimeout(() => {
      setState((prev) => ({ ...prev, q, searching: true, error: null }))
      const near =
        lat === undefined || lng === undefined ? undefined : { lat, lng }
      searchPlaces(q, near).then(
        (results) => {
          if (active) setState({ q, results, searching: false, error: null })
        },
        (error: unknown) => {
          if (!active) return
          setState({
            q,
            results: [],
            searching: false,
            error:
              error instanceof Error ? error.message : 'Place search failed',
          })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [q, lat, lng])

  if (q === null) return idle
  // Until the debounced search starts, keep showing the last results.
  return {
    results: state.results,
    searching: state.searching || state.q !== q,
    error: state.q === q ? state.error : null,
  }
}
