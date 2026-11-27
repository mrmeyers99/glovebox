// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CATEGORY_GROUPS,
  DEFAULT_FILTER,
  categoryGroup,
  filterStorageKey,
  filterSuggestions,
  isFiltering,
  loadFilter,
  parseFilter,
  saveFilter,
  type SuggestionFilter,
} from './suggestionFilters'
import type { Suggestion } from './suggestions'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const place = (id: number, category: string, percentile = 0.5): Suggestion => ({
  id,
  name: `Place ${id}`,
  kind: 'attraction',
  category,
  lat: 43,
  lng: -98,
  tile_key: '43_-98',
  score: 1,
  percentile,
  image: null,
  wikipedia_url: null,
  osm_url: null,
})

describe('categoryGroup', () => {
  it('groups the candidate categories', () => {
    expect(categoryGroup('tourism=museum')).toBe('museums')
    expect(categoryGroup('tourism=gallery')).toBe('museums')
    expect(categoryGroup('leisure=park')).toBe('nature')
    expect(categoryGroup('natural=waterfall')).toBe('nature')
    expect(categoryGroup('tourism=artwork')).toBe('roadside')
    expect(categoryGroup('historic=memorial')).toBe('roadside')
    expect(categoryGroup('tourism=attraction')).toBe('roadside')
    expect(categoryGroup('historic=fort')).toBe('historic')
    expect(categoryGroup('historic=monument')).toBe('historic')
    expect(categoryGroup('tourism=zoo')).toBe('entertainment')
    expect(categoryGroup('tourism=viewpoint')).toBe('viewpoints')
  })

  it('puts unknown categories with roadside', () => {
    expect(categoryGroup('amenity=fountain')).toBe('roadside')
    expect(categoryGroup('constructor')).toBe('roadside')
  })
})

describe('filterSuggestions', () => {
  const places = [
    place(1, 'tourism=museum', 0.95),
    place(2, 'leisure=park', 0.5),
    place(3, 'tourism=viewpoint', 0.8),
    place(4, 'historic=fort', 0.2),
  ]
  const distances = new Map([
    [1, 3],
    [2, 20],
    [3, 4.9],
    [4, 50],
  ])
  const ids = (filter: Partial<SuggestionFilter>) =>
    filterSuggestions(places, distances, { ...DEFAULT_FILTER, ...filter }).map(
      (p) => p.id,
    )

  it('keeps everything by default, in order', () => {
    expect(ids({})).toEqual([1, 2, 3, 4])
  })

  it('filters by category', () => {
    expect(ids({ categories: ['museums', 'historic'] })).toEqual([1, 4])
    expect(ids({ categories: [] })).toEqual([])
  })

  it('filters by distance from the route', () => {
    expect(ids({ maxDistanceKm: 5 })).toEqual([1, 3])
    expect(ids({ maxDistanceKm: 25 })).toEqual([1, 2, 3])
  })

  it('treats a place without a distance as on the route', () => {
    expect(
      filterSuggestions(places, new Map(), {
        ...DEFAULT_FILTER,
        maxDistanceKm: 5,
      }),
    ).toHaveLength(4)
  })

  it('keeps only top picks (percentile 0.8 and up)', () => {
    expect(ids({ topPicksOnly: true })).toEqual([1, 3])
  })

  it('combines filters', () => {
    expect(
      ids({ topPicksOnly: true, maxDistanceKm: 5, categories: ['viewpoints'] }),
    ).toEqual([3])
  })
})

describe('isFiltering', () => {
  it('is false only for the default', () => {
    expect(isFiltering(DEFAULT_FILTER)).toBe(false)
    expect(isFiltering({ ...DEFAULT_FILTER, categories: ['museums'] })).toBe(
      true,
    )
    expect(isFiltering({ ...DEFAULT_FILTER, maxDistanceKm: 15 })).toBe(true)
    expect(isFiltering({ ...DEFAULT_FILTER, topPicksOnly: true })).toBe(true)
  })
})

describe('parseFilter', () => {
  it('reads a saved filter', () => {
    expect(
      parseFilter({
        categories: ['viewpoints', 'museums'],
        maxDistanceKm: 40,
        topPicksOnly: true,
      }),
    ).toEqual({
      categories: ['museums', 'viewpoints'],
      maxDistanceKm: 40,
      topPicksOnly: true,
    })
  })

  it('falls back to the default for unusable parts', () => {
    expect(parseFilter(null)).toEqual(DEFAULT_FILTER)
    expect(parseFilter('x')).toEqual(DEFAULT_FILTER)
    expect(
      parseFilter({
        categories: 'museums',
        maxDistanceKm: 7,
        topPicksOnly: 'yes',
      }),
    ).toEqual(DEFAULT_FILTER)
    expect(parseFilter({ categories: ['bogus'] }).categories).toEqual([])
  })
})

describe('loadFilter and saveFilter', () => {
  const filter: SuggestionFilter = {
    categories: ['nature'],
    maxDistanceKm: 15,
    topPicksOnly: false,
  }

  it('keys storage by user', () => {
    expect(filterStorageKey('u1')).toBe('glovebox.suggestionFilter.u1')
    expect(filterStorageKey(undefined)).toBe('glovebox.suggestionFilter')
  })

  it('remembers a filter per user', () => {
    expect(loadFilter('u1')).toEqual(DEFAULT_FILTER)
    saveFilter('u1', filter)
    expect(loadFilter('u1')).toEqual(filter)
    expect(loadFilter('u2')).toEqual(DEFAULT_FILTER)
  })

  it('ignores a corrupt saved value', () => {
    localStorage.setItem(filterStorageKey('u1'), '{not json')
    expect(loadFilter('u1')).toEqual(DEFAULT_FILTER)
  })

  it('copes with storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveFilter('u1', filter)).not.toThrow()
    expect(loadFilter('u1')).toEqual(DEFAULT_FILTER)
  })

  it('defaults to every category', () => {
    expect(DEFAULT_FILTER.categories).toHaveLength(CATEGORY_GROUPS.length)
  })
})
