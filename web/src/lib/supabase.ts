import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !publishableKey) {
  throw new Error(
    'Missing Supabase settings. Copy web/.env.example to web/.env.local and fill it in.',
  )
}

export const supabase = createClient<Database>(url, publishableKey)
