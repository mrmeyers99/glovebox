// Proves the functions pipeline works: returns { ok: true } for signed-in users, 401 otherwise.
import { requireUser } from '../_shared/auth.ts'
import { handle, json } from '../_shared/http.ts'

export const handler = handle(async (req) => {
  await requireUser(req)
  return json({ ok: true })
})

export default { fetch: handler }
