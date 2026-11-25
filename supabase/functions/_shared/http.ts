import { corsHeaders } from './cors.ts'

/** Throw from a handler to send `{ error: message }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** A JSON response with CORS headers. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value)
  }
  return Response.json(body, { ...init, headers })
}

/**
 * Wraps a function's handler: answers CORS preflight, and turns thrown
 * errors into JSON responses (HttpError keeps its status; anything else is a 500).
 */
export function handle(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }
    try {
      return await handler(req)
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, { status: error.status })
      }
      console.error(error)
      return json({ error: 'Internal error' }, { status: 500 })
    }
  }
}
