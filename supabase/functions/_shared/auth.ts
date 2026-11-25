import { createContextClient, verifyAuth } from '@supabase/server/core'
import type { UserClaims } from '@supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError } from './http.ts'

export interface SignedInUser {
  /** The caller's identity from their verified access token. */
  user: UserClaims
  /** A client that acts as the caller, so row-level security applies. */
  supabase: SupabaseClient
}

/**
 * Verifies the request's `Authorization: Bearer <access token>` and returns the
 * signed-in user. Throws HttpError(401) when there is no valid user token
 * (signed out, expired, or only the publishable key).
 *
 * Functions deploy with the gateway's JWT check off (`verify_jwt: false` in
 * supabase/config.jsonc), so every function that isn't deliberately public
 * must call this first.
 */
export async function requireUser(req: Request): Promise<SignedInUser> {
  const { data: auth, error } = await verifyAuth(req, { auth: 'user' })
  if (error || !auth.userClaims) {
    throw new HttpError(401, 'Sign in required')
  }
  const supabase = createContextClient({
    auth: { token: auth.token, keyName: auth.keyName },
  })
  return { user: auth.userClaims, supabase }
}
