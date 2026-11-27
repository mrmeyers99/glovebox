import { HttpError } from './http.ts'

/**
 * The User-Agent for calls to public data services (Overpass, Wikimedia),
 * whose policies ask for a contact address: CONTACT_EMAIL, a function secret.
 * Throws HttpError(503) when it isn't set.
 */
export function contactUserAgent(): string {
  const contact = Deno.env.get('CONTACT_EMAIL')?.trim()
  if (!contact) {
    console.error('CONTACT_EMAIL is not set')
    throw new HttpError(503, 'CONTACT_EMAIL is not set')
  }
  return `Glovebox/1.0 (road-trip planner; ${contact})`
}
