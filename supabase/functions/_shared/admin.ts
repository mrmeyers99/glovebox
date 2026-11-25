import { createAdminClient } from '@supabase/server/core'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

/**
 * A client with the project's secret (service-role) key. It bypasses row-level
 * security, so use it only for server-owned data such as API caches, never to
 * read or write trip data on a user's behalf (use requireUser's client for that).
 */
export function adminClient(): SupabaseClient {
  client ??= createAdminClient()
  return client
}
