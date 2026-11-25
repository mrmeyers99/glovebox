import { assertEquals } from '@std/assert'
import { invokeRequest, userToken } from '../_shared/test_env.ts'
import { handler } from './index.ts'

Deno.test('returns ok for a signed-in user', async () => {
  const res = await handler(invokeRequest(await userToken(crypto.randomUUID())))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { ok: true })
  assertEquals(res.headers.get('access-control-allow-origin'), '*')
})

Deno.test('returns 401 when signed out', async () => {
  const res = await handler(invokeRequest())
  assertEquals(res.status, 401)
  assertEquals(await res.json(), { error: 'Sign in required' })
  assertEquals(res.headers.get('access-control-allow-origin'), '*')
})

Deno.test('returns 401 for an expired token', async () => {
  const token = await userToken(crypto.randomUUID(), { expiresIn: '-1m' })
  const res = await handler(invokeRequest(token))
  assertEquals(res.status, 401)
  await res.body?.cancel()
})

Deno.test('returns 401 for a tampered token', async () => {
  const [header, payload] = (await userToken(crypto.randomUUID())).split('.')
  const res = await handler(invokeRequest(`${header}.${payload}.bad-signature`))
  assertEquals(res.status, 401)
  await res.body?.cancel()
})

Deno.test('answers CORS preflight without auth', async () => {
  const res = await handler(invokeRequest(undefined, 'OPTIONS'))
  assertEquals(res.status, 204)
  assertEquals(res.headers.get('access-control-allow-origin'), '*')
})
