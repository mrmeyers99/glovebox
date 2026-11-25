// Test-only: fakes the environment the Edge Functions runtime provides, with a
// local signing key so tests can mint access tokens without a Supabase project.
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const url = 'http://127.0.0.1:54321'
const { privateKey, publicKey } = await generateKeyPair('ES256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }

Deno.env.set('SUPABASE_URL', url)
Deno.env.set('SUPABASE_JWKS', JSON.stringify({ keys: [jwk] }))
Deno.env.set(
  'SUPABASE_PUBLISHABLE_KEYS',
  JSON.stringify({ default: 'sb_publishable_test' }),
)
Deno.env.set(
  'SUPABASE_SECRET_KEYS',
  JSON.stringify({ default: 'sb_secret_test' }),
)

/** An access token like the one Supabase Auth issues to a signed-in user. */
export function userToken(
  userId: string,
  { expiresIn = '1h' }: { expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: 'traveler@example.com' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test', typ: 'JWT' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuer(`${url}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey)
}

/** A request shaped like supabase.functions.invoke() sends (JSON body if given). */
export function invokeRequest(
  token?: string,
  method = 'POST',
  body?: unknown,
  name = 'health',
): Request {
  const headers = new Headers({ apikey: 'sb_publishable_test' })
  // Signed out, supabase-js sends the publishable key as the bearer token.
  headers.set('authorization', `Bearer ${token ?? 'sb_publishable_test'}`)
  if (body === undefined) {
    return new Request(`${url}/functions/v1/${name}`, { method, headers })
  }
  headers.set('content-type', 'application/json')
  return new Request(`${url}/functions/v1/${name}`, {
    method,
    headers,
    body: JSON.stringify(body),
  })
}
