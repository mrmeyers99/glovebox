import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Suggestion } from './suggestions'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }))

const {
  MAX_TILES_PER_REQUEST,
  MAX_VISIBLE,
  categoryInfo,
  fetchSuggestions,
  markerTier,
  parseSuggestion,
  parseSuggestionsResponse,
  perTileLimit,
  routeDistanceLabel,
  visibleSuggestions,
} = await import('./suggestions')

beforeEach(() => invoke.mockReset())

const raw = {
  id: 7,
  name: 'Corn Palace',
  kind: 'attraction',
  category: 'tourism=attraction',
  lat: 43.7,
  lng: -98.03,
  tile_key: '43.5_-98.5',
  score: '2.5',
  percentile: 0.95,
  image: {
    thumbnail_url: 'https://commons.wikimedia.org/thumb.jpg',
    marker_url: 'https://commons.wikimedia.org/marker.jpg',
    page_url: 'https://commons.wikimedia.org/wiki/File:Corn.jpg',
    credit: 'Jane Doe',
    license: 'CC BY-SA 4.0',
  },
  wikipedia_url: 'https://en.wikipedia.org/wiki/Corn_Palace',
  osm_url: 'https://www.openstreetmap.org/way/1',
  amenities: null,
}

function place(over: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 1,
    name: 'Place',
    kind: 'attraction',
    category: 'tourism=museum',
    lat: 40.2,
    lng: -100.2,
    tile_key: '40.0_-100.5',
    score: 1,
    percentile: 0.5,
    image: null,
    wikipedia_url: null,
    osm_url: null,
    ...over,
  }
}

describe('parseSuggestion', () => {
  it('reads a place', () => {
    expect(parseSuggestion(raw)).toEqual({
      id: 7,
      name: 'Corn Palace',
      kind: 'attraction',
      category: 'tourism=attraction',
      lat: 43.7,
      lng: -98.03,
      tile_key: '43.5_-98.5',
      score: 2.5,
      percentile: 0.95,
      image: raw.image,
      wikipedia_url: raw.wikipedia_url,
      osm_url: raw.osm_url,
    })
  })

  it('fills in missing optional fields', () => {
    expect(
      parseSuggestion({
        ...raw,
        score: 'x',
        percentile: 3,
        image: { thumbnail_url: 'https://t', page_url: 'https://p' },
        wikipedia_url: '',
        osm_url: undefined,
      }),
    ).toMatchObject({
      score: 0,
      percentile: 1,
      image: {
        thumbnail_url: 'https://t',
        marker_url: null,
        page_url: 'https://p',
        credit: null,
        license: null,
      },
      wikipedia_url: null,
      osm_url: null,
    })
    expect(parseSuggestion({ ...raw, percentile: null })?.percentile).toBe(0)
    expect(parseSuggestion({ ...raw, image: { page_url: 'x' } })?.image).toBe(
      null,
    )
    expect(parseSuggestion({ ...raw, image: 'x' })?.image).toBe(null)
  })

  it('rejects places it cannot show', () => {
    for (const bad of [
      null,
      'x',
      { ...raw, id: '7' },
      { ...raw, name: '' },
      { ...raw, kind: 'shop' },
      { ...raw, category: 1 },
      { ...raw, tile_key: null },
      { ...raw, lat: Number.NaN },
      { ...raw, lng: '1' },
    ]) {
      expect(parseSuggestion(bad)).toBe(null)
    }
  })
})

describe('parseSuggestionsResponse', () => {
  it('reads places and tile lists, dropping bad entries', () => {
    expect(
      parseSuggestionsResponse({
        places: [raw, { id: 'x' }],
        pending: ['1.0_1.0', 2],
        failed: 'nope',
        scoring: ['2.0_2.0', null],
      }),
    ).toEqual({
      places: [parseSuggestion(raw)],
      pending: ['1.0_1.0'],
      failed: [],
      scoring: ['2.0_2.0'],
    })
  })

  it('throws on anything else', () => {
    expect(() => parseSuggestionsResponse(null)).toThrow()
    expect(() => parseSuggestionsResponse({ places: 1 })).toThrow()
  })
})

describe('fetchSuggestions', () => {
  it('asks for the tiles and kind', async () => {
    invoke.mockResolvedValue({
      data: { places: [raw], pending: ['a'], failed: ['b'], scoring: ['c'] },
      error: null,
    })
    const result = await fetchSuggestions(['a', 'b', 'c'])
    expect(invoke).toHaveBeenCalledWith('suggestions', {
      body: { tiles: ['a', 'b', 'c'], kind: 'attraction' },
    })
    expect(result).toEqual({
      places: [parseSuggestion(raw)],
      pending: ['a'],
      failed: ['b'],
      scoring: ['c'],
    })
  })

  it('splits large requests and merges the answers best first', async () => {
    const tiles = Array.from(
      { length: MAX_TILES_PER_REQUEST + 1 },
      (_, i) => `t${i}`,
    )
    invoke
      .mockResolvedValueOnce({
        data: { places: [{ ...raw, id: 1, percentile: 0.2 }], pending: ['x'] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          places: [{ ...raw, id: 2, percentile: 0.9 }],
          failed: ['y'],
          scoring: ['z'],
        },
        error: null,
      })
    const result = await fetchSuggestions(tiles, 'campground')
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0][1].body.tiles).toHaveLength(
      MAX_TILES_PER_REQUEST,
    )
    expect(invoke.mock.calls[1][1].body).toEqual({
      tiles: [`t${MAX_TILES_PER_REQUEST}`],
      kind: 'campground',
    })
    expect(result.places.map((p) => p.id)).toEqual([2, 1])
    expect(result.pending).toEqual(['x'])
    expect(result.failed).toEqual(['y'])
    expect(result.scoring).toEqual(['z'])
  })

  it('throws when the function fails', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('down') })
    await expect(fetchSuggestions(['a'])).rejects.toThrow('down')
  })
})

describe('visibleSuggestions', () => {
  const tileA = [
    place({ id: 1, percentile: 1 }),
    place({ id: 2, percentile: 0.8 }),
    place({ id: 3, percentile: 0.5 }),
  ]
  const tileB = [place({ id: 4, tile_key: 'b', lat: 50, lng: 10 })]
  const all = [...tileA, ...tileB]

  it('shows only the best per tile when zoomed out', () => {
    expect(visibleSuggestions(all, 5, null).map((p) => p.id)).toEqual([1, 4])
    expect(visibleSuggestions(all, 7.5, null).map((p) => p.id)).toEqual([
      1, 2, 4,
    ])
    expect(visibleSuggestions(all, 12, null)).toHaveLength(4)
  })

  it('leaves out places out of view', () => {
    const bounds: [[number, number], [number, number]] = [
      [-101, 40],
      [-100, 41],
    ]
    expect(visibleSuggestions(all, 12, bounds).map((p) => p.id)).toEqual([
      1, 2, 3,
    ])
    // A view across the antimeridian.
    const across: [[number, number], [number, number]] = [
      [170, 45],
      [15, 55],
    ]
    expect(visibleSuggestions(all, 12, across).map((p) => p.id)).toEqual([4])
    const south: [[number, number], [number, number]] = [
      [-180, -10],
      [180, 0],
    ]
    expect(visibleSuggestions(all, 12, south)).toEqual([])
  })

  it(`draws at most ${MAX_VISIBLE}`, () => {
    const many = Array.from({ length: MAX_VISIBLE + 5 }, (_, i) =>
      place({ id: i }),
    )
    expect(visibleSuggestions(many, 15, null)).toHaveLength(MAX_VISIBLE)
  })
})

describe('perTileLimit', () => {
  it('grows with zoom', () => {
    expect([4, 7, 8, 9, 10].map(perTileLimit)).toEqual([1, 2, 3, 6, Infinity])
  })
})

describe('markerTier', () => {
  it('stands out the best in an area', () => {
    expect(markerTier(0.95)).toBe('top')
    expect(markerTier(0.7)).toBe('good')
    expect(markerTier(0.1)).toBe('other')
  })
})

describe('categoryInfo', () => {
  it('names known categories', () => {
    expect(categoryInfo('tourism=museum')).toEqual({
      label: 'Museum',
      icon: '🏛️',
    })
    expect(categoryInfo('natural=waterfall').label).toBe('Waterfall')
  })

  it('falls back for others', () => {
    expect(categoryInfo('amenity=toString').label).toBe('Point of interest')
    expect(categoryInfo('weird').label).toBe('Point of interest')
  })
})

describe('routeDistanceLabel', () => {
  it('says how far off the route a place is', () => {
    expect(routeDistanceLabel(0.5)).toBe('On the route')
    expect(routeDistanceLabel(32.2)).toBe('20 mi from the route')
    expect(routeDistanceLabel(Infinity)).toBe(null)
  })
})
