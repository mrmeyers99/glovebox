// The U.S. Energy Information Administration's weekly retail gasoline price
// (API v2). Series EMM_EPMR_PTE_NUS_DPG is "U.S. Regular All Formulations
// Retail Gasoline Prices (Dollars per Gallon)", published each Monday for the
// week starting that day.

export const EIA_URL = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/'
export const US_REGULAR_SERIES = 'EMM_EPMR_PTE_NUS_DPG'
export const EIA_TIMEOUT_MS = 10_000

export interface GasPrice {
  /** Dollars per gallon, rounded to 3 decimals (numeric(6, 3) in the table). */
  price_per_gallon: number
  /** The week the price is for, YYYY-MM-DD. */
  as_of: string
}

/** The EIA request for the latest weekly U.S. regular gasoline price. */
export function eiaUrl(apiKey: string): string {
  const url = new URL(EIA_URL)
  const params = url.searchParams
  params.set('api_key', apiKey)
  params.set('frequency', 'weekly')
  params.append('data[0]', 'value')
  params.append('facets[series][]', US_REGULAR_SERIES)
  params.set('sort[0][column]', 'period')
  params.set('sort[0][direction]', 'desc')
  params.set('offset', '0')
  params.set('length', '1')
  return url.toString()
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The newest price in an EIA v2 data response, or null if it has none.
 * `value` may come back as a number or a numeric string.
 */
export function parseEiaResponse(body: unknown): GasPrice | null {
  const rows = (body as { response?: { data?: unknown } } | null)?.response
    ?.data
  if (!Array.isArray(rows)) return null
  let latest: GasPrice | null = null
  for (const row of rows as Record<string, unknown>[]) {
    if (typeof row !== 'object' || row === null) continue
    if (row.series !== undefined && row.series !== US_REGULAR_SERIES) continue
    const period = row.period
    if (typeof period !== 'string' || !DATE.test(period)) continue
    const value =
      typeof row.value === 'string' && row.value.trim() !== ''
        ? Number(row.value)
        : row.value
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      continue
    }
    if (latest === null || period > latest.as_of) {
      latest = {
        price_per_gallon: Math.round(value * 1000) / 1000,
        as_of: period,
      }
    }
  }
  return latest
}

/** Fetches the latest price from EIA. Throws on any failure. */
export async function fetchLatestPrice(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<GasPrice> {
  const res = await fetchFn(eiaUrl(apiKey), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(EIA_TIMEOUT_MS),
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`EIA answered ${res.status}`)
  }
  const price = parseEiaResponse(await res.json())
  if (!price) throw new Error('EIA response has no price')
  return price
}
