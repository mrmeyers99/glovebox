// English Wikipedia pageviews (Wikimedia REST API): the average monthly views
// by people (not bots) over the last 12 full months. One request per article,
// so the client throttles them (see wikimedia.ts).
import type { WikimediaClient } from './wikimedia.ts'

export const PAGEVIEWS_API =
  'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user'
export const PAGEVIEW_MONTHS = 12

/** The request for one article's last PAGEVIEW_MONTHS full months. */
export function pageviewsUrl(title: string, now: Date): string {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - PAGEVIEW_MONTHS, 1),
  )
  return `${PAGEVIEWS_API}/${encodeURIComponent(title.replaceAll(' ', '_'))}/monthly/${stamp(start)}/${stamp(end)}`
}

function stamp(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '') + '00'
}

/**
 * Average monthly views. Months with no data (no views, or before the article
 * existed) count as 0, so a new article isn't ranked on one busy month.
 */
export function averageMonthlyViews(body: unknown): number {
  const items = (body as { items?: { views?: unknown }[] })?.items
  if (!Array.isArray(items)) throw new Error('pageviews: no items in answer')
  let total = 0
  for (const item of items.slice(-PAGEVIEW_MONTHS)) {
    const views = Number(item.views)
    if (Number.isFinite(views) && views > 0) total += views
  }
  return Math.round(total / PAGEVIEW_MONTHS)
}

/** Average monthly views, or 0 when the API has no data for the article. */
export async function fetchPageviews(
  title: string,
  client: WikimediaClient,
  now: Date,
): Promise<number> {
  const body = await client.getJson(pageviewsUrl(title, now), {
    allow404: true,
  })
  return body === null ? 0 : averageMonthlyViews(body)
}
