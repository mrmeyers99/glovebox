// A small HTTP client for the Wikimedia APIs (Wikidata SPARQL, pageviews,
// Commons). Wikimedia rate-limits aggressively, so every request
//   - sends a User-Agent with a contact address (Wikimedia's policy),
//   - waits for its host's minimum interval since the previous request, and
//   - on 429 / 503, waits and retries once if Retry-After is short and there's
//     time left, and otherwise throws RateLimitedError, which pauses the
//     worker until then.

/** Minimum time between two requests to one host, in ms. */
export const HOST_INTERVAL_MS: Readonly<Record<string, number>> = {
  // Pageviews returned 429 after about 25 requests a minute in prototyping.
  'wikimedia.org': 2_500,
  'query.wikidata.org': 1_000,
  'commons.wikimedia.org': 1_000,
}
export const DEFAULT_INTERVAL_MS = 1_000

/** A Retry-After up to this long is waited out within the run, once. */
export const MAX_INLINE_WAIT_MS = 10_000
/** Used when a 429 / 503 has no (valid) Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 5 * 60_000
/** Retry-After is capped so a bad header can't stop the worker for days. */
export const MAX_RETRY_AFTER_MS = 60 * 60_000

/** Wikimedia asked us to slow down: nothing more until `retryAt`. */
export class RateLimitedError extends Error {
  constructor(
    readonly host: string,
    readonly status: number,
    /** ms since epoch */
    readonly retryAt: number,
  ) {
    super(
      `${host}: HTTP ${status}, retry after ${new Date(retryAt).toISOString()}`,
    )
  }
}

/** Any other failed request (HTTP error, network error, timeout, bad JSON). */
export class RequestError extends Error {
  constructor(
    message: string,
    /** The HTTP status, if there was an answer. */
    readonly status?: number,
  ) {
    super(message)
  }
}

/** The run's deadline came before the request could start. */
export class OutOfTimeError extends RequestError {
  constructor(host: string) {
    super(`${host}: out of time`)
  }
}

export interface ClientOptions {
  /** Sent as User-Agent; must include a contact address. */
  userAgent: string
  fetchFn?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** No request is started after this time (ms since epoch). */
  deadline: number
  /** Per-request time limit. */
  timeoutMs?: number
}

export interface WikimediaClient {
  /**
   * Fetches JSON. Returns null for a 404 when `allow404` is set.
   * Throws RateLimitedError or RequestError.
   */
  getJson(
    url: string,
    init?: {
      method?: 'GET' | 'POST'
      body?: URLSearchParams
      accept?: string
      allow404?: boolean
    },
  ): Promise<unknown>
  /** Whether there is time for another request. */
  hasTime(): boolean
}

export function wikimediaClient({
  userAgent,
  fetchFn = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  deadline,
  timeoutMs = 30_000,
}: ClientOptions): WikimediaClient {
  const lastRequest = new Map<string, number>()

  async function throttle(host: string) {
    const interval = HOST_INTERVAL_MS[host] ?? DEFAULT_INTERVAL_MS
    const last = lastRequest.get(host)
    if (last !== undefined) {
      const wait = last + interval - now()
      if (wait > 0) await sleep(wait)
    }
    lastRequest.set(host, now())
  }

  async function once(
    url: URL,
    init: Parameters<WikimediaClient['getJson']>[1] = {},
  ) {
    await throttle(url.host)
    if (now() >= deadline) throw new OutOfTimeError(url.host)
    try {
      return await fetchFn(url, {
        method: init.method ?? 'GET',
        headers: {
          'user-agent': userAgent,
          accept: init.accept ?? 'application/json',
          ...(init.body
            ? { 'content-type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(timeoutMs, deadline - now())),
        ),
      })
    } catch (error) {
      throw new RequestError(`${url.host}: ${messageOf(error)}`)
    }
  }

  return {
    hasTime: () => now() < deadline,
    async getJson(href, init = {}) {
      const url = new URL(href)
      let response = await once(url, init)
      for (let retried = false; ; retried = true) {
        if (response.status !== 429 && response.status !== 503) break
        await response.body?.cancel()
        const retryAt =
          now() + retryAfterMs(response.headers.get('retry-after'), now())
        if (
          retried ||
          retryAt - now() > MAX_INLINE_WAIT_MS ||
          retryAt >= deadline
        ) {
          throw new RateLimitedError(url.host, response.status, retryAt)
        }
        await sleep(retryAt - now())
        response = await once(url, init)
      }
      if (response.status === 404 && init.allow404) {
        await response.body?.cancel()
        return null
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new RequestError(
          `${url.host}: HTTP ${response.status}`,
          response.status,
        )
      }
      try {
        return await response.json()
      } catch (error) {
        throw new RequestError(
          `${url.host}: ${messageOf(error)}`,
          response.status,
        )
      }
    },
  }
}

/**
 * How long Retry-After asks us to wait: seconds or an HTTP date. Missing or
 * invalid means DEFAULT_RETRY_AFTER_MS; at most MAX_RETRY_AFTER_MS.
 */
export function retryAfterMs(header: string | null, now: number): number {
  let ms = DEFAULT_RETRY_AFTER_MS
  const value = header?.trim() ?? ''
  if (/^\d+$/.test(value)) ms = Number(value) * 1000
  else if (value && !Number.isNaN(Date.parse(value))) {
    ms = Math.max(0, Date.parse(value) - now)
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS)
}

function messageOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return 'timed out'
  return error instanceof Error ? error.message : String(error)
}
