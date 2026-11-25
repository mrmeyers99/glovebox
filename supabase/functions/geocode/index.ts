// Place search for signed-in users, proxied to OpenRouteService so the ORS key
// stays server-side.
//   { q, focus?: { lat, lng } } → { results: Place[] } (up to 8, US only)
//   { reverse: { lat, lng } }   → { results: Place[] } (at most 1)
import { requireUser } from '../_shared/auth.ts'
import { handle, HttpError, json } from '../_shared/http.ts'
import { geocode, parseGeocodeRequest } from './ors.ts'

export function createHandler(fetchFn: typeof fetch = fetch) {
  return handle(async (req) => {
    await requireUser(req)
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Use POST')
    }
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'Body must be JSON')
    }
    const request = parseGeocodeRequest(body)
    const apiKey = Deno.env.get('ORS_API_KEY')
    if (!apiKey) {
      console.error('ORS_API_KEY is not set')
      throw new HttpError(503, 'Place search is not configured')
    }
    const results = await geocode(request, apiKey, fetchFn)
    return json({ results })
  })
}

export const handler = createHandler()

export default { fetch: handler }
