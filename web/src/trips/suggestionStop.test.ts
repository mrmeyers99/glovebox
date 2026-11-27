import { describe, expect, it } from 'vitest'
import type { Stop, StopKind } from '../lib/database.types'
import { comparePositions, type Leg, type StopInput } from '../lib/tripMath'
import {
  placesInTrip,
  positionBeforeStop,
  suggestedPlacement,
} from './suggestionStop'

const days = [
  { id: 'd2', position: 'a1' },
  { id: 'd1', position: 'a0' },
]

function stop(id: string, dayId: string, lat: number, lng: number): StopInput {
  return {
    id,
    dayId,
    position: 'a0',
    kind: 'waypoint',
    skipped: false,
    lat,
    lng,
    costAmount: null,
    costCategory: null,
  }
}

function leg(from: StopInput, to: StopInput): Leg {
  return {
    from,
    to,
    dayId: to.dayId,
    route: undefined,
    status: 'pending',
    miles: 0,
    gasCost: 0,
  }
}

// Day 1: home (0, 0) → diner (0, 1). Day 2: motel (0, 2) → park (1, 2).
const home = stop('home', 'd1', 0, 0)
const diner = stop('diner', 'd1', 0, 1)
const motel = stop('motel', 'd2', 0, 2)
const park = stop('park', 'd2', 1, 2)
const legs = [leg(home, diner), leg(diner, motel), leg(motel, park)]

describe('suggestedPlacement', () => {
  it('goes before the stop the closest leg arrives at, on its day', () => {
    expect(suggestedPlacement(days, legs, [0.1, 0.5])).toEqual({
      dayId: 'd1',
      dayNumber: 1,
      beforeStopId: 'diner',
    })
    // The overnight leg counts toward the day it arrives on.
    expect(suggestedPlacement(days, legs, [-0.1, 1.5])).toEqual({
      dayId: 'd2',
      dayNumber: 2,
      beforeStopId: 'motel',
    })
    expect(suggestedPlacement(days, legs, [0.5, 2.2])).toEqual({
      dayId: 'd2',
      dayNumber: 2,
      beforeStopId: 'park',
    })
  })

  it('follows the driving line when there is one', () => {
    // A detour north between home and diner, via (2, 0.5): a straight line
    // would put (2, 0.8) closer to the diner → park leg.
    const routed: Leg = {
      ...leg(home, diner),
      // Encoded [[0, 0], [2, 0.5], [0, 1]].
      route: { distanceM: 1, durationS: 1, geometry: '??_seK_t`B~reK_t`B' },
    }
    expect(
      suggestedPlacement(days, [routed, leg(diner, park)], [2, 0.8]),
    ).toMatchObject({ beforeStopId: 'diner' })
    expect(
      suggestedPlacement(days, [leg(home, diner), leg(diner, park)], [2, 0.8]),
    ).toMatchObject({ beforeStopId: 'park' })
  })

  it('picks the earlier leg on a tie', () => {
    expect(suggestedPlacement(days, legs, [0, 1])).toMatchObject({
      beforeStopId: 'diner',
    })
  })

  it('goes at the end of the last day without legs', () => {
    expect(suggestedPlacement(days, [], [0, 0])).toEqual({
      dayId: 'd2',
      dayNumber: 2,
      beforeStopId: null,
    })
  })

  it('ignores a leg to a day that is gone', () => {
    expect(
      suggestedPlacement([{ id: 'd1', position: 'a0' }], legs, [0.5, 2.2]),
    ).toEqual({ dayId: 'd1', dayNumber: 1, beforeStopId: null })
  })

  it('is null without days', () => {
    expect(suggestedPlacement([], [], [0, 0])).toBe(null)
  })
})

function row(id: string, position: string, kind: StopKind = 'waypoint') {
  return { id, position, kind }
}

const between = (key: string, a: string | null, b: string | null) =>
  (a === null || comparePositions(a, key) < 0) &&
  (b === null || comparePositions(key, b) < 0)

describe('positionBeforeStop', () => {
  const day = [
    row('end', 'a0', 'end'),
    row('b', 'a2'),
    row('a', 'a1'),
    row('start', 'Zz', 'start'),
  ]

  it('goes between the stop and the one before it', () => {
    const key = positionBeforeStop(day, 'b')
    expect(between(key, 'a1', 'a2')).toBe(true)
  })

  it('goes first after the start stop', () => {
    expect(between(positionBeforeStop(day, 'a'), 'Zz', 'a1')).toBe(true)
  })

  it('goes first on a day without a start', () => {
    const key = positionBeforeStop([row('a', 'a1')], 'a')
    expect(comparePositions(key, 'a1')).toBeLessThan(0)
  })

  it('goes at the end of the day if the stop is gone or is the start', () => {
    const plain = [row('a', 'a1'), row('b', 'a2')]
    expect(comparePositions(positionBeforeStop(plain, 'x'), 'a2')).toBe(1)
    expect(comparePositions(positionBeforeStop(plain, null), 'a2')).toBe(1)
    expect(
      comparePositions(
        positionBeforeStop([row('s', 'a0', 'start'), row('a', 'a1')], 's'),
        'a1',
      ),
    ).toBe(1)
  })

  it('goes before an end stop whose key sorts early, at the end', () => {
    // The end stop is listed last whatever its key; fall back to the end of
    // the day (before the end stop) as a new stop would.
    const key = positionBeforeStop(day, 'end')
    expect(comparePositions(key, 'a2')).toBe(1)
  })
})

describe('placesInTrip', () => {
  it('collects the places stops came from', () => {
    const stops = [
      { place_id: 3 },
      { place_id: null },
      { place_id: 3 },
      { place_id: 7 },
    ] satisfies Pick<Stop, 'place_id'>[]
    expect([...placesInTrip(stops)].sort()).toEqual([3, 7])
  })
})
