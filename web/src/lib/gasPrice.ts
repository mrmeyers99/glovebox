// The U.S. national average gas price from the `gas-price` Edge Function
// (EIA weekly average, cached server-side). Trips without their own gas
// price use it.

import { formatMoney } from './format'
import { supabase } from './supabase'

export interface NationalAverage {
  pricePerGallon: number
  /** The week (YYYY-MM-DD) the price is for. */
  asOf: string
}

/** The function's response as a NationalAverage, or null if it isn't one. */
export function parseNationalAverage(data: unknown): NationalAverage | null {
  if (typeof data !== 'object' || data === null) return null
  const { price_per_gallon: price, as_of: asOf } = data as Record<
    string,
    unknown
  >
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null
  }
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return null
  }
  return { pricePerGallon: price, asOf }
}

/** Fetches the national average. Throws if it isn't available. */
export async function fetchNationalAverage(): Promise<NationalAverage> {
  const { data, error } = await supabase.functions.invoke('gas-price', {
    method: 'GET',
  })
  if (error) throw error
  const average = parseNationalAverage(data)
  if (!average) throw new Error('Unexpected gas-price response')
  return average
}

let loading: Promise<NationalAverage> | undefined

/**
 * The national average, fetched once per session and shared by every caller.
 * A failed fetch is forgotten so a later call can try again.
 */
export function loadNationalAverage(): Promise<NationalAverage> {
  loading ??= fetchNationalAverage().catch((error: unknown) => {
    loading = undefined
    throw error
  })
  return loading
}

/** Test-only: forget the session's national average. */
export function resetNationalAverageForTests() {
  loading = undefined
}

/** E.g. `National average: $3.06 (as of Nov 23, 2026)`. */
export function formatNationalAverage(average: NationalAverage) {
  const asOf = new Date(`${average.asOf}T00:00:00Z`).toLocaleDateString(
    'en-US',
    { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' },
  )
  return `National average: ${formatMoney(average.pricePerGallon)} (as of ${asOf})`
}

/**
 * The price a trip's gas costs use: its own if set, else the national
 * average, else null (not known yet).
 */
export function effectiveGasPrice(
  tripPrice: number | null,
  nationalAverage: NationalAverage | null,
): number | null {
  if (tripPrice !== null) return Number(tripPrice)
  return nationalAverage?.pricePerGallon ?? null
}
