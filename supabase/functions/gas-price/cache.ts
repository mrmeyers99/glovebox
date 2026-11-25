// The shared gas_price_cache table, read and written with the service-role
// client. It holds no trip data: only the public national average.
import { adminClient } from '../_shared/admin.ts'
import type { GasPrice } from './eia.ts'

export interface CachedGasPrice extends GasPrice {
  fetched_at: string
}

export interface GasPriceCache {
  /** The cached price for `region`, if any. */
  get(region: string): Promise<CachedGasPrice | null>
  /** Inserts or replaces the price for `region`. */
  put(region: string, price: CachedGasPrice): Promise<void>
}

export function supabaseGasPriceCache(): GasPriceCache {
  return {
    async get(region) {
      const { data, error } = await adminClient()
        .from('gas_price_cache')
        .select('price_per_gallon, as_of, fetched_at')
        .eq('region', region)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        // numeric columns may come back as strings.
        price_per_gallon: Number(data.price_per_gallon),
        as_of: String(data.as_of),
        fetched_at: String(data.fetched_at),
      }
    },
    async put(region, price) {
      const { error } = await adminClient()
        .from('gas_price_cache')
        .upsert({ region, ...price }, { onConflict: 'region' })
      if (error) throw error
    },
  }
}
