// How notable a place is, from its Wikimedia signals (requirements §9). The
// formula and weights come from the Mitchell, SD → Waterloo, IA prototype,
// whose top results were the USS South Dakota memorial, the Corn Palace, Falls
// Park, the National Music Museum and the Great Plains Zoo. The ranking study
// (#59) tunes them; every weight lives in SCORE_WEIGHTS / CATEGORY_BONUS.
//
// Pure logic, no I/O: the enrichment worker computes the signals and stores
// the result in places.score.

/** Ranking signals for one place. Null or missing means "unknown", scored as 0. */
export interface PlaceSignals {
  /** English Wikipedia pageviews over the last 30 days (places.pageviews_month). */
  pageviewsMonth?: number | null
  /** Files in the place's Wikimedia Commons category (places.commons_files). */
  commonsFiles?: number | null
  /** Wikipedia language editions about the place (places.sitelinks). */
  sitelinks?: number | null
  /** Whether it has a photo to show (places.image_file). */
  hasPhoto?: boolean
}

export const SCORE_WEIGHTS = {
  pageviews: 1,
  commonsFiles: 0.6,
  sitelinks: 0.5,
  photo: 0.2,
} as const

/**
 * Added to the score by category (places.category, from classifyCandidate).
 * Categories not listed get 0. Destinations people plan a stop around get the
 * most; minor or very common features get little.
 */
export const CATEGORY_BONUS: Readonly<Record<string, number>> = {
  'boundary=national_park': 0.6,
  'tourism=theme_park': 0.5,
  'tourism=zoo': 0.5,
  'tourism=aquarium': 0.5,
  'natural=waterfall': 0.5,
  'natural=cave_entrance': 0.4,
  'tourism=museum': 0.3,
  'tourism=attraction': 0.3,
  'historic=castle': 0.3,
  'historic=fort': 0.3,
  'historic=battlefield': 0.3,
  'tourism=viewpoint': 0.2,
  'tourism=artwork': 0.2,
  'historic=monument': 0.2,
  'historic=memorial': 0.2,
  'man_made=windmill': 0.2,
  'leisure=park': 0.2,
  'leisure=nature_reserve': 0.2,
  'boundary=protected_area': 0.1,
  'tourism=gallery': 0.1,
  'natural=peak': 0.1,
}

/**
 * The prototype formula:
 * log10(1 + pageviews/month) + 0.6·log10(1 + commons files)
 * + 0.5·log10(1 + sitelinks) + category bonus + 0.2 if it has a photo.
 * Higher is better; a place with no signals scores just its category bonus.
 */
export function scorePlace(signals: PlaceSignals, category: string): number {
  return (
    SCORE_WEIGHTS.pageviews * logCount(signals.pageviewsMonth) +
    SCORE_WEIGHTS.commonsFiles * logCount(signals.commonsFiles) +
    SCORE_WEIGHTS.sitelinks * logCount(signals.sitelinks) +
    (CATEGORY_BONUS[category] ?? 0) +
    (signals.hasPhoto ? SCORE_WEIGHTS.photo : 0)
  )
}

/** log10(1 + n), treating unknown or invalid counts as 0. */
function logCount(n: number | null | undefined): number {
  return n != null && Number.isFinite(n) && n > 0 ? Math.log10(1 + n) : 0
}
