// The current U.S. national average gas price, for signed-in users. Trips
// without their own gas price use it. The EIA key stays server-side.
//
//   GET or POST (no body needed)
//   → { region: 'US', price_per_gallon, as_of, fetched_at, stale }
//       as_of: the week (YYYY-MM-DD) the price is for
//       stale: true when EIA couldn't be reached and an older price is returned
//
// The price is kept in gas_price_cache (region 'US') and shared by everyone.
// EIA publishes a week's price on that week's Monday afternoon (Eastern), so a
// cached price is due for replacement NEW_PRICE_AFTER_DAYS after its as_of.
// While it is due, EIA is asked at most once every RETRY_AFTER_HOURS (in case
// the release is late), so EIA sees about one request a week however many
// people load trips.
import { requireUser } from '../_shared/auth.ts'
import { handle, HttpError, json } from '../_shared/http.ts'
import {
  type CachedGasPrice,
  type GasPriceCache,
  supabaseGasPriceCache,
} from './cache.ts'
import { fetchLatestPrice } from './eia.ts'

export const REGION = 'US'
export const NEW_PRICE_AFTER_DAYS = 8
export const RETRY_AFTER_HOURS = 24

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Whether the cached price should be refreshed from EIA at `now`. */
export function isDue(cached: CachedGasPrice | null, now: Date): boolean {
  if (!cached) return true
  const asOf = Date.parse(`${cached.as_of}T00:00:00Z`)
  const fetchedAt = Date.parse(cached.fetched_at)
  if (Number.isNaN(asOf) || Number.isNaN(fetchedAt)) return true
  const newPriceExpected = now.getTime() - asOf >= NEW_PRICE_AFTER_DAYS * DAY
  const retryAllowed = now.getTime() - fetchedAt >= RETRY_AFTER_HOURS * HOUR
  return newPriceExpected && retryAllowed
}

export interface Deps {
  fetchFn?: typeof fetch
  cache?: GasPriceCache
  now?: () => Date
}

export function createHandler({
  fetchFn = fetch,
  cache = supabaseGasPriceCache(),
  now = () => new Date(),
}: Deps = {}) {
  return handle(async (req) => {
    await requireUser(req)
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new HttpError(405, 'Use GET or POST')
    }
    await req.body?.cancel()

    let cached: CachedGasPrice | null = null
    try {
      cached = await cache.get(REGION)
    } catch (error) {
      // Still answer (from EIA) if the cache can't be read.
      console.error('gas_price_cache lookup failed', error)
    }
    const at = now()
    if (cached && !isDue(cached, at)) {
      return respond(cached, false)
    }

    const apiKey = Deno.env.get('EIA_API_KEY')
    if (!apiKey) {
      console.error('EIA_API_KEY is not set')
      if (cached) return respond(cached, true)
      throw new HttpError(503, 'Gas prices are not configured')
    }

    let fresh: CachedGasPrice
    try {
      const price = await fetchLatestPrice(apiKey, fetchFn)
      fresh = { ...price, fetched_at: at.toISOString() }
    } catch (error) {
      console.error('EIA request failed', error)
      if (cached) {
        // Wait RETRY_AFTER_HOURS before asking EIA again.
        await store(cache, { ...cached, fetched_at: at.toISOString() })
        return respond(cached, true)
      }
      throw new HttpError(503, 'Gas prices are unavailable right now')
    }
    // Never replace a newer price with an older one.
    if (cached && cached.as_of > fresh.as_of) {
      fresh = { ...cached, fetched_at: fresh.fetched_at }
    }
    await store(cache, fresh)
    console.log(
      `gas-price: fetched ${fresh.price_per_gallon} as of ${fresh.as_of}`,
    )
    return respond(fresh, false)
  })
}

async function store(cache: GasPriceCache, price: CachedGasPrice) {
  try {
    await cache.put(REGION, price)
  } catch (error) {
    console.error('gas_price_cache store failed', error)
  }
}

function respond(price: CachedGasPrice, stale: boolean): Response {
  return json({
    region: REGION,
    price_per_gallon: price.price_per_gallon,
    as_of: price.as_of,
    fetched_at: price.fetched_at,
    stale,
  })
}

export const handler = createHandler()

export default { fetch: handler }
