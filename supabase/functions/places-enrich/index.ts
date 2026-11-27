// The enrichment worker (Discovery, requirements §9). Gives each stored place
// its ranking signals, a photo and a score (scorePlace), from Wikidata,
// English Wikipedia pageviews and Wikimedia Commons.
//
//   POST (no body needed), service role only: `apikey: <secret key>`
//   → { enriched, unfinished, deferred, paused_until }
//
// Not for users: pg_cron calls it every minute (public.invoke_places_enrich,
// in the places_enrich migration) while places are due: never enriched, or
// enriched more than 90 days ago.
//
// Wikimedia rate-limits aggressively, so each run is small and slow: up to
// LINKED_PER_RUN places with a Wikidata item (one SPARQL query, two Commons
// queries, then one throttled pageviews request each), plus up to
// PLAIN_PER_RUN places without one, which need no requests. A run stays
// under a minute so runs don't overlap. When Wikimedia answers 429 / 503 (or
// fails), the run stores what it finished, hands the rest back, and pauses
// the worker until Retry-After (or ERROR_PAUSE_MS); places without an item
// are still scored meanwhile.
import { requireServiceRole } from '../_shared/auth.ts'
import { handle, HttpError, json } from '../_shared/http.ts'
import { contactUserAgent } from '../_shared/user_agent.ts'
import { enrichPlaces, PLACE_RETRY_MS } from './enrich.ts'
import { type EnrichStore, supabaseEnrichStore } from './store.ts'
import { wikimediaClient } from './wikimedia.ts'

export const LINKED_PER_RUN = 20
export const PLAIN_PER_RUN = 1000
/** No Wikimedia request starts after this long into a run. */
export const RUN_BUDGET_MS = 50_000

export interface Deps {
  fetchFn?: typeof fetch
  store?: EnrichStore
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export function createHandler({
  fetchFn = fetch,
  store = supabaseEnrichStore(),
  now = Date.now,
  sleep,
}: Deps = {}) {
  return handle(async (req) => {
    await requireServiceRole(req)
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    await req.body?.cancel()
    const userAgent = contactUserAgent()

    const client = wikimediaClient({
      userAgent,
      fetchFn,
      now,
      sleep,
      deadline: now() + RUN_BUDGET_MS,
    })
    const places = await store.claim(LINKED_PER_RUN, PLAIN_PER_RUN)
    const result = await enrichPlaces(places, client, now)

    if (result.stopped) {
      console.error(`places-enrich: pausing: ${result.stopped.error}`)
      await store.pause(new Date(result.stopped.retryAt), result.stopped.error)
    }
    const enriched = result.enriched.length
      ? await store.store(result.enriched)
      : 0
    if (result.unfinished.length)
      await store.release(result.unfinished, new Date(now()))
    if (result.deferred.length) {
      await store.release(result.deferred, new Date(now() + PLACE_RETRY_MS))
    }
    console.log(
      `places-enrich: ${enriched} enriched, ${result.unfinished.length} unfinished, ${result.deferred.length} deferred`,
    )
    return json({
      enriched,
      unfinished: result.unfinished.length,
      deferred: result.deferred.length,
      paused_until: result.stopped
        ? new Date(result.stopped.retryAt).toISOString()
        : null,
    })
  })
}

export const handler = createHandler()

export default { fetch: handler }
