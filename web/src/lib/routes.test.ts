import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteEntry } from './routes'
import type { StopInput } from './tripMath'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }))

const {
  batchPairs,
  fetchRouteBatch,
  legsToFetch,
  makeRouteLookup,
  parseRouteResponse,
  routeKey,
  toRouteEntry,
} = await import('./routes')

const a = { lat: 38.573331, lng: -109.549843 }
const b = { lat: 39.0, lng: -110.0 }
const c = { lat: 40.0, lng: -111.0 }

beforeEach(() => invoke.mockReset())

describe('routeKey', () => {
  it('rounds coordinates to 5 decimals, like the server', () => {
    expect(routeKey(a, b)).toBe('38.57333,-109.54984>39,-110')
    expect(routeKey({ lat: 39.000001, lng: -110 }, a)).toBe(routeKey(b, a))
  })
  it('is directional', () => {
    expect(routeKey(a, b)).not.toBe(routeKey(b, a))
  })
})

describe('legsToFetch', () => {
  const ok: RouteEntry = {
    status: 'ok',
    route: { distanceM: 1, durationS: 1 },
  }

  it('returns unknown legs once each, in order', () => {
    const pairs = legsToFetch(
      [
        { from: a, to: b },
        { from: b, to: c },
        { from: a, to: b },
      ],
      new Map(),
    )
    expect(pairs.map((p) => p.key)).toEqual([routeKey(a, b), routeKey(b, c)])
    expect(pairs[0]).toMatchObject({ from: a, to: b })
  })

  it('skips known, finally failed, in-flight and zero-length legs', () => {
    const known = new Map<string, RouteEntry>([
      [routeKey(a, b), ok],
      [routeKey(b, c), { status: 'failed', final: true }],
    ])
    const pairs = legsToFetch(
      [
        { from: a, to: b },
        { from: b, to: c },
        { from: c, to: a },
        { from: a, to: { ...a } },
      ],
      known,
      new Set([routeKey(c, a)]),
    )
    expect(pairs).toEqual([])
  })

  it('retries legs that failed for a temporary reason', () => {
    const known = new Map<string, RouteEntry>([
      [routeKey(a, b), { status: 'failed', final: false }],
    ])
    expect(legsToFetch([{ from: a, to: b }], known)).toHaveLength(1)
  })

  it('copies only coordinates from stops', () => {
    const stop = { ...a, id: 'x', name: 'Moab' }
    const [pair] = legsToFetch([{ from: stop, to: b }], new Map())
    expect(pair.from).toEqual(a)
  })
})

describe('batchPairs', () => {
  it('splits into batches of at most 50', () => {
    const pairs = Array.from({ length: 120 }, (_, i) => ({
      key: String(i),
      from: a,
      to: b,
    }))
    expect(batchPairs(pairs).map((batch) => batch.length)).toEqual([50, 50, 20])
    expect(batchPairs([])).toEqual([])
  })
})

describe('toRouteEntry', () => {
  it('reads a route', () => {
    expect(
      toRouteEntry({ distance_m: 1000, duration_s: 60, geometry: 'x' }),
    ).toEqual({ status: 'ok', route: { distanceM: 1000, durationS: 60 } })
  })
  it('treats no_route and too_long as final', () => {
    expect(toRouteEntry({ error: 'no_route', message: '' })).toEqual({
      status: 'failed',
      final: true,
    })
    expect(toRouteEntry({ error: 'too_long', message: '' })).toEqual({
      status: 'failed',
      final: true,
    })
  })
  it('treats other errors and junk as retryable', () => {
    for (const result of [{ error: 'rate_limited' }, null, 'x', {}]) {
      expect(toRouteEntry(result)).toEqual({ status: 'failed', final: false })
    }
  })
})

describe('parseRouteResponse', () => {
  it('matches results to pairs by position', () => {
    const pairs = legsToFetch(
      [
        { from: a, to: b },
        { from: b, to: c },
      ],
      new Map(),
    )
    const entries = parseRouteResponse(pairs, {
      results: [{ distance_m: 5, duration_s: 6 }, { error: 'no_route' }],
    })
    expect(entries.get(routeKey(a, b))).toEqual({
      status: 'ok',
      route: { distanceM: 5, durationS: 6 },
    })
    expect(entries.get(routeKey(b, c))).toEqual({
      status: 'failed',
      final: true,
    })
  })
  it('fails pairs missing from the response', () => {
    const pairs = legsToFetch([{ from: a, to: b }], new Map())
    expect(parseRouteResponse(pairs, {}).get(routeKey(a, b))).toEqual({
      status: 'failed',
      final: false,
    })
  })
})

describe('fetchRouteBatch', () => {
  const pairs = legsToFetch([{ from: a, to: b }], new Map())

  it('posts the pairs to the route function', async () => {
    invoke.mockResolvedValue({
      data: { results: [{ distance_m: 5, duration_s: 6 }] },
      error: null,
    })
    const entries = await fetchRouteBatch(pairs)
    expect(invoke).toHaveBeenCalledWith('route', {
      body: { pairs: [{ from: a, to: b }] },
    })
    expect(entries.get(routeKey(a, b))?.status).toBe('ok')
  })

  it('fails every pair, retryably, when the request fails', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response('', { status: 500 })),
    })
    expect((await fetchRouteBatch(pairs)).get(routeKey(a, b))).toEqual({
      status: 'failed',
      final: false,
    })
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new Error('offline')),
    })
    expect((await fetchRouteBatch(pairs)).get(routeKey(a, b))).toEqual({
      status: 'failed',
      final: false,
    })
  })
})

describe('makeRouteLookup', () => {
  const stop = (point: { lat: number; lng: number }) =>
    ({ ...point, id: 'x' }) as StopInput

  it('returns routes, null for failures and undefined while pending', () => {
    const route = { distanceM: 5, durationS: 6 }
    const lookup = makeRouteLookup(
      new Map<string, RouteEntry>([
        [routeKey(a, b), { status: 'ok', route }],
        [routeKey(b, c), { status: 'failed', final: true }],
      ]),
    )
    expect(lookup(stop(a), stop(b))).toEqual(route)
    expect(lookup(stop(b), stop(c))).toBeNull()
    expect(lookup(stop(c), stop(a))).toBeUndefined()
  })

  it('gives zero-length legs a zero route without fetching', () => {
    expect(makeRouteLookup(new Map())(stop(a), stop(a))).toEqual({
      distanceM: 0,
      durationS: 0,
    })
  })
})
