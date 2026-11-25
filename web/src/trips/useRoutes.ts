// Fetches driving routes for a trip's legs from the `route` Edge Function and
// returns a RouteLookup for summarizeTrip. Only legs not already known are
// requested, in one batched call per burst of edits (debounced).

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  batchPairs,
  fetchRouteBatch,
  legsToFetch,
  makeRouteLookup,
  routeKey,
  type LatLng,
  type RouteEntry,
} from '../lib/routes'
import type { RouteLookup } from '../lib/tripMath'

/** How long to wait after the last change before requesting routes. */
export const ROUTE_DEBOUNCE_MS = 400

export function useRoutes(legs: { from: LatLng; to: LatLng }[]): RouteLookup {
  const [known, setKnown] = useState<ReadonlyMap<string, RouteEntry>>(
    () => new Map(),
  )
  const knownRef = useRef(known)
  const legsRef = useRef(legs)
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    knownRef.current = known
    legsRef.current = legs
  })

  // Changes only when the set of legs changes, not on every render.
  const legsKey = legs.map((leg) => routeKey(leg.from, leg.to)).join('|')

  useEffect(() => {
    const timer = setTimeout(() => {
      const pairs = legsToFetch(
        legsRef.current,
        knownRef.current,
        inFlight.current,
      )
      if (pairs.length === 0) return
      for (const pair of pairs) inFlight.current.add(pair.key)
      // Legs being retried show as pending again, not as failed.
      setKnown((prev) => {
        const next = new Map(prev)
        for (const pair of pairs) next.delete(pair.key)
        return next
      })
      for (const batch of batchPairs(pairs)) {
        void fetchRouteBatch(batch).then((entries) => {
          for (const pair of batch) inFlight.current.delete(pair.key)
          setKnown((prev) => new Map([...prev, ...entries]))
        })
      }
    }, ROUTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [legsKey])

  return useMemo(() => makeRouteLookup(known), [known])
}
