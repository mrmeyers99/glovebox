import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }))

const { GeocodeError, reverseGeocode, searchPlaces, toGeocodeError } =
  await import('./geocode')

const moab = { name: 'Moab', address: 'UT, USA', lat: 38.57, lng: -109.55 }

beforeEach(() => invoke.mockReset())

describe('searchPlaces', () => {
  it('sends the query and focus and returns results', async () => {
    invoke.mockResolvedValue({ data: { results: [moab] }, error: null })
    const focus = { lat: 38, lng: -109 }
    expect(await searchPlaces('Moab', focus)).toEqual([moab])
    expect(invoke).toHaveBeenCalledWith('geocode', {
      body: { q: 'Moab', focus },
    })
  })

  it('leaves focus out when not given', async () => {
    invoke.mockResolvedValue({ data: { results: [] }, error: null })
    await searchPlaces('Moab')
    expect(invoke).toHaveBeenCalledWith('geocode', { body: { q: 'Moab' } })
  })

  it("throws the function's error message and status", async () => {
    const res = Response.json(
      { error: 'Place search is busy (rate limit reached).' },
      { status: 429 },
    )
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(res) })
    const error = await searchPlaces('Moab').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GeocodeError)
    expect(error).toMatchObject({
      message: 'Place search is busy (rate limit reached).',
      status: 429,
    })
  })
})

describe('reverseGeocode', () => {
  it('sends the point and returns the first result', async () => {
    invoke.mockResolvedValue({ data: { results: [moab] }, error: null })
    expect(await reverseGeocode({ lat: 38.57, lng: -109.55 })).toEqual(moab)
    expect(invoke).toHaveBeenCalledWith('geocode', {
      body: { reverse: { lat: 38.57, lng: -109.55 } },
    })
  })

  it('returns null when nothing is found', async () => {
    invoke.mockResolvedValue({ data: { results: [] }, error: null })
    expect(await reverseGeocode({ lat: 0, lng: 0 })).toBeNull()
  })
})

describe('toGeocodeError', () => {
  it('uses a generic message for a non-JSON error response', async () => {
    const res = new Response('Bad gateway', { status: 502 })
    expect(await toGeocodeError(new FunctionsHttpError(res))).toMatchObject({
      message: 'Place search failed',
      status: 502,
    })
  })

  it('reports network failures as unavailable', async () => {
    const error = await toGeocodeError(new FunctionsFetchError(new Error('x')))
    expect(error.message).toBe('Place search is unavailable right now')
    expect(error.status).toBeUndefined()
  })
})
