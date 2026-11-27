// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  amenityBadges,
  campgroundDistanceLabel,
  campgroundFilterKey,
  campgroundsNear,
  DEFAULT_CAMPGROUND_FILTER,
  feeLabel,
  isFilteringCampgrounds,
  loadCampgroundFilter,
  matchesCampgroundFilter,
  overnightDayOf,
  overnightStop,
  parseCampgroundFilter,
  reservationLabel,
  saveCampgroundFilter,
  type CampgroundFilter,
} from './campgrounds'
import type { CampgroundAmenities, Suggestion } from './suggestions'
import type { StopInput } from './tripMath'

const stop = (id: string, over: Partial<StopInput> = {}): StopInput => ({
  id,
  dayId: 'd',
  position: 'a0',
  kind: 'waypoint',
  skipped: false,
  lat: 0,
  lng: 0,
  costAmount: null,
  costCategory: null,
  ...over,
})

const unknown: CampgroundAmenities = {
  tents: null,
  rvs: null,
  hookups: null,
  drinking_water: null,
  dump_station: null,
  showers: null,
  toilets: null,
  fee: null,
  fee_amount: null,
  reservation: null,
  capacity: null,
  website: null,
  phone: null,
  operator: null,
  ownership: null,
}

function camp(id: number, lat: number, lng = 0): Suggestion {
  return {
    id,
    name: `Camp ${id}`,
    kind: 'campground',
    category: 'tourism=camp_site',
    lat,
    lng,
    tile_key: '0.0_0.0',
    score: 1,
    percentile: 0.5,
    image: null,
    wikipedia_url: null,
    osm_url: null,
  }
}

describe('overnightStop', () => {
  const days = [
    {
      dayId: 'd1',
      stops: [stop('a'), stop('b'), stop('c', { skipped: true })],
    },
    { dayId: 'd2', stops: [stop('x', { skipped: true })] },
    { dayId: 'd3', stops: [stop('z')] },
  ]

  it("is the day's last stop that isn't skipped", () => {
    expect(overnightStop(days, 'd1')?.id).toBe('b')
  })

  it('is null for the last day, days without stops and unknown days', () => {
    expect(overnightStop(days, 'd2')).toBeNull()
    expect(overnightStop(days, 'd3')).toBeNull()
    expect(overnightStop(days, 'nope')).toBeNull()
  })

  it('overnightDayOf finds the day a stop ends', () => {
    expect(overnightDayOf(days, 'b')).toBe('d1')
    expect(overnightDayOf(days, 'a')).toBeNull()
    expect(overnightDayOf(days, 'z')).toBeNull()
    expect(overnightDayOf(days, 'nope')).toBeNull()
  })
})

describe('campgroundsNear', () => {
  it('keeps those within the radius, nearest first', () => {
    const places = [camp(1, 0.2), camp(2, 0.1), camp(3, 1), camp(4, 0.1)]
    const near = campgroundsNear(places, [0, 0])
    expect(near.map((c) => c.place.id)).toEqual([2, 4, 1])
    expect(near[0].km).toBeCloseTo(11.1, 1)
    expect(campgroundsNear(places, [0, 0], 5)).toEqual([])
  })
})

describe('matchesCampgroundFilter', () => {
  const filter = (over: Partial<CampgroundFilter>) => ({
    ...DEFAULT_CAMPGROUND_FILTER,
    ...over,
  })
  const has = (over: Partial<CampgroundAmenities>) => ({ ...unknown, ...over })

  it('passes everything by default', () => {
    expect(matchesCampgroundFilter(null, DEFAULT_CAMPGROUND_FILTER)).toBe(true)
    expect(isFilteringCampgrounds(DEFAULT_CAMPGROUND_FILTER)).toBe(false)
  })

  it('drops campgrounds that say no, and keeps those that say nothing', () => {
    const tents = filter({ amenities: ['tents', 'showers'] })
    expect(isFilteringCampgrounds(tents)).toBe(true)
    expect(matchesCampgroundFilter(has({ tents: true }), tents)).toBe(true)
    expect(
      matchesCampgroundFilter(has({ tents: true, showers: false }), tents),
    ).toBe(false)
    expect(matchesCampgroundFilter(undefined, tents)).toBe(true)
  })

  it('only those that say so, when asked', () => {
    const sure = filter({ amenities: ['hookups'], confirmedOnly: true })
    expect(matchesCampgroundFilter(has({ hookups: true }), sure)).toBe(true)
    expect(matchesCampgroundFilter(has({}), sure)).toBe(false)
    expect(matchesCampgroundFilter(null, sure)).toBe(false)
  })

  it('free means no fee', () => {
    const free = filter({ free: true })
    expect(isFilteringCampgrounds(free)).toBe(true)
    expect(matchesCampgroundFilter(has({ fee: false }), free)).toBe(true)
    expect(matchesCampgroundFilter(has({ fee: true }), free)).toBe(false)
    expect(matchesCampgroundFilter(has({}), free)).toBe(true)
  })

  it('public or private', () => {
    const pub = filter({ ownership: 'public' })
    expect(isFilteringCampgrounds(pub)).toBe(true)
    expect(matchesCampgroundFilter(has({ ownership: 'public' }), pub)).toBe(
      true,
    )
    expect(matchesCampgroundFilter(has({ ownership: 'private' }), pub)).toBe(
      false,
    )
    expect(matchesCampgroundFilter(has({}), pub)).toBe(true)
    expect(isFilteringCampgrounds(filter({ confirmedOnly: true }))).toBe(true)
  })
})

describe('labels', () => {
  it('amenityBadges lists what is known, yes or no', () => {
    expect(amenityBadges(null)).toEqual([])
    expect(amenityBadges({ ...unknown, tents: true, showers: false })).toEqual([
      { key: 'tents', icon: '⛺', label: 'Tents' },
      { key: 'showers', icon: '🚿', label: 'Showers', no: true },
    ])
  })

  it('feeLabel', () => {
    expect(feeLabel(null)).toBeNull()
    expect(feeLabel(unknown)).toBeNull()
    expect(feeLabel({ ...unknown, fee: false })).toBe('Free')
    expect(feeLabel({ ...unknown, fee: true })).toBe('Fee')
    expect(feeLabel({ ...unknown, fee: true, fee_amount: '$25' })).toBe('$25')
  })

  it('reservationLabel', () => {
    const label = (reservation: string | null) =>
      reservationLabel({ ...unknown, reservation })
    expect(label('required')).toBe('Reservations required')
    expect(label('recommended')).toBe('Reservations recommended')
    expect(label('yes')).toBe('Takes reservations')
    expect(label('no')).toBe('First come, first served')
    expect(label('members_only')).toBeNull()
    expect(reservationLabel(undefined)).toBeNull()
  })

  it('campgroundDistanceLabel', () => {
    expect(campgroundDistanceLabel(0.1)).toBe('Here')
    expect(campgroundDistanceLabel(1.6093)).toBe('1 mi away')
    expect(campgroundDistanceLabel(7)).toBe('4.3 mi away')
    expect(campgroundDistanceLabel(16.09344)).toBe('10 mi away')
  })
})

describe('saved filter', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('is kept per user', () => {
    const mine: CampgroundFilter = {
      amenities: ['rvs'],
      free: true,
      ownership: 'private',
      confirmedOnly: true,
    }
    saveCampgroundFilter('u1', mine)
    expect(loadCampgroundFilter('u1')).toEqual(mine)
    expect(loadCampgroundFilter('u2')).toEqual(DEFAULT_CAMPGROUND_FILTER)
    expect(campgroundFilterKey(undefined)).toBe('glovebox.campgroundFilter')
  })

  it('falls back to the default for anything unusable', () => {
    expect(parseCampgroundFilter('x')).toEqual(DEFAULT_CAMPGROUND_FILTER)
    expect(
      parseCampgroundFilter({
        amenities: ['showers', 'pool', 'tents'],
        free: 'yes',
        ownership: 'state',
      }),
    ).toEqual({ ...DEFAULT_CAMPGROUND_FILTER, amenities: ['tents', 'showers'] })
    expect(parseCampgroundFilter({ amenities: 'tents' }).amenities).toEqual([])
    localStorage.setItem(campgroundFilterKey('u1'), '{')
    expect(loadCampgroundFilter('u1')).toEqual(DEFAULT_CAMPGROUND_FILTER)
  })

  it('still works without storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() =>
      saveCampgroundFilter('u1', DEFAULT_CAMPGROUND_FILTER),
    ).not.toThrow()
  })
})
