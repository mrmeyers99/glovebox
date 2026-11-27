// Turns claimed places into ranking signals, a photo and a score. Places
// without a Wikidata item get their category bonus only. The rest are looked
// up in batches (Wikidata, then Commons), then one pageviews request each.
//
// Never throws for a Wikimedia failure: it stops instead, and returns what
// it finished so that it's stored, the places it didn't get to (retried on a
// later run), and why it stopped (the worker pauses until `retryAt`).
import { scorePlace } from '../_shared/places/mod.ts'
import {
  fetchCategoryFiles,
  fetchImageInfo,
  type ImageInfo,
} from './commons.ts'
import { fetchPageviews } from './pageviews.ts'
import type { EnrichedPlace, PlaceToEnrich } from './store.ts'
import { fetchWikidata, type WikidataItem } from './wikidata.ts'
import {
  OutOfTimeError,
  RateLimitedError,
  RequestError,
  type WikimediaClient,
} from './wikimedia.ts'

/** Pause after a failure that isn't a rate limit (outage, bad answer). */
export const ERROR_PAUSE_MS = 15 * 60_000
/** A place whose own pageviews request fails is retried this much later. */
export const PLACE_RETRY_MS = 24 * 60 * 60_000

export interface EnrichResult {
  enriched: EnrichedPlace[]
  /** Not reached this run: retry as soon as the worker may. */
  unfinished: number[]
  /** Their own request failed: retry after PLACE_RETRY_MS. */
  deferred: number[]
  /** Set when Wikimedia failed and the worker should pause. */
  stopped: { error: string; retryAt: number } | null
}

export async function enrichPlaces(
  places: readonly PlaceToEnrich[],
  client: WikimediaClient,
  now: () => number = Date.now,
): Promise<EnrichResult> {
  const result: EnrichResult = {
    enriched: [],
    unfinished: [],
    deferred: [],
    stopped: null,
  }
  const linked = places.filter((p) => p.wikidata)
  for (const place of places) {
    if (!place.wikidata) result.enriched.push(enrichment(place, undefined))
  }
  if (linked.length === 0) return result

  const stop = (error: unknown) => {
    // Out of time is not a failure: the next run carries on.
    if (error instanceof OutOfTimeError) return
    result.stopped = {
      error: (error instanceof Error ? error.message : String(error)).slice(
        0,
        1000,
      ),
      retryAt:
        error instanceof RateLimitedError
          ? error.retryAt
          : now() + ERROR_PAUSE_MS,
    }
  }

  let items: Map<string, WikidataItem>
  let counts: Map<string, number>
  let images: Map<string, ImageInfo>
  try {
    items = await fetchWikidata(
      linked.map((p) => p.wikidata!),
      client,
    )
    const found = [...items.values()]
    counts = await fetchCategoryFiles(
      found.flatMap((i) => (i.commonsCategory ? [i.commonsCategory] : [])),
      client,
    )
    images = await fetchImageInfo(
      found.flatMap((i) => (i.image ? [i.image] : [])),
      client,
    )
  } catch (error) {
    stop(error)
    result.unfinished.push(...linked.map((p) => p.id))
    return result
  }

  // One request per article, until time runs out or Wikimedia says stop.
  const views = new Map<string, number>()
  const failed = new Set<string>()
  const titles = new Set(
    linked.flatMap((p) => items.get(p.wikidata!)?.enwikiTitle ?? []),
  )
  for (const title of titles) {
    if (!client.hasTime()) break
    try {
      views.set(title, await fetchPageviews(title, client, new Date(now())))
    } catch (error) {
      if (error instanceof RequestError && error.status !== undefined) {
        // This article's own problem (e.g. HTTP 400 for an odd title).
        console.error(`places-enrich: pageviews for ${title}: ${error.message}`)
        failed.add(title)
        continue
      }
      stop(error)
      break
    }
  }

  for (const place of linked) {
    const item = items.get(place.wikidata!)
    const title = item?.enwikiTitle
    if (title && !views.has(title)) {
      ;(failed.has(title) ? result.deferred : result.unfinished).push(place.id)
    } else {
      result.enriched.push(enrichment(place, item, counts, images, views))
    }
  }
  return result
}

/** A place's stored signals and score. No item: category bonus only. */
export function enrichment(
  place: PlaceToEnrich,
  item: WikidataItem | undefined,
  counts = new Map<string, number>(),
  images = new Map<string, ImageInfo>(),
  views = new Map<string, number>(),
): EnrichedPlace {
  const image = item?.image ? images.get(item.image) : undefined
  const signals = {
    sitelinks: item ? item.sitelinks : null,
    commons_files: item?.commonsCategory
      ? (counts.get(item.commonsCategory) ?? 0)
      : null,
    pageviews_month: item?.enwikiTitle
      ? (views.get(item.enwikiTitle) ?? null)
      : null,
  }
  return {
    id: place.id,
    wikidata: place.wikidata,
    ...signals,
    image_file: image?.file ?? null,
    image_credit: image?.credit ?? null,
    image_license: image?.license ?? null,
    score: scorePlace(
      {
        sitelinks: signals.sitelinks,
        commonsFiles: signals.commons_files,
        pageviewsMonth: signals.pageviews_month,
        hasPhoto: !!image,
      },
      place.category,
    ),
  }
}
