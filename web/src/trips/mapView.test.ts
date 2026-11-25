import { describe, expect, it } from 'vitest'
import type { StopInput } from '../lib/tripMath'
import {
  CONTINENTAL_US_BOUNDS,
  DAY_COLOR_COUNT,
  dayColor,
  dayColorIndex,
  initialBounds,
  markerLabel,
  stopMarkers,
} from './mapView'

const stop = (lat: number, lng: number, skipped = false) => ({
  lat,
  lng,
  skipped,
})

describe('initialBounds', () => {
  it('shows the continental US when there are no stops', () => {
    expect(initialBounds([])).toEqual(CONTINENTAL_US_BOUNDS)
  })

  it('shows the continental US when every stop is skipped', () => {
    expect(initialBounds([stop(40, -100, true)])).toEqual(CONTINENTAL_US_BOUNDS)
  })

  it('contains all active stops', () => {
    expect(
      initialBounds([
        stop(37.77, -122.42),
        stop(36.17, -115.14),
        stop(39.74, -104.99),
      ]),
    ).toEqual([
      [-122.42, 36.17],
      [-104.99, 39.74],
    ])
  })

  it('leaves out skipped stops', () => {
    expect(
      initialBounds([stop(37.77, -122.42), stop(25.76, -80.19, true)]),
    ).toEqual([
      [-122.42, 37.77],
      [-122.42, 37.77],
    ])
  })

  it('ignores stops without finite coordinates', () => {
    expect(initialBounds([stop(Number.NaN, 0), stop(10, 20)])).toEqual([
      [20, 10],
      [20, 10],
    ])
  })
})

describe('dayColorIndex', () => {
  it('gives each day its own colour, then cycles', () => {
    expect(dayColorIndex(1)).toBe(0)
    expect(dayColorIndex(DAY_COLOR_COUNT)).toBe(DAY_COLOR_COUNT - 1)
    expect(dayColorIndex(DAY_COLOR_COUNT + 1)).toBe(0)
    expect(dayColorIndex(2 * DAY_COLOR_COUNT + 3)).toBe(2)
  })

  it('maps to a CSS variable', () => {
    expect(dayColor(1)).toBe('var(--day-color-1)')
    expect(dayColor(DAY_COLOR_COUNT + 2)).toBe('var(--day-color-2)')
  })
})

describe('stopMarkers', () => {
  const s = (
    id: string,
    dayId: string,
    position: string,
    extra: Partial<StopInput> = {},
  ): StopInput => ({
    id,
    dayId,
    position,
    kind: 'waypoint',
    skipped: false,
    lat: 40,
    lng: -100,
    costAmount: null,
    costCategory: null,
    ...extra,
  })
  // Listed out of order: days and stops are sorted by position key.
  const days = [
    { id: 'd2', position: 'a1' },
    { id: 'd1', position: 'a0' },
  ]
  const stops = [
    s('end', 'd2', 'a0', { kind: 'end' }),
    s('b', 'd1', 'a2'),
    s('start', 'd1', 'a5', { kind: 'start' }),
    s('skip', 'd1', 'a1', { skipped: true }),
    s('c', 'd2', 'Zz'),
  ]
  const summary = (showSkipped: boolean) =>
    stopMarkers(days, stops, { showSkipped }).map((m) => [
      m.stopId,
      m.dayNumber,
      m.numberInDay,
    ])

  it('numbers active stops within each day, in trip order', () => {
    expect(summary(false)).toEqual([
      ['start', 1, 1],
      ['b', 1, 2],
      // 'Zz' sorts before 'a0' byte-wise (uppercase first).
      ['c', 2, 1],
      ['end', 2, 2],
    ])
  })

  it('shows skipped stops, unnumbered and underneath, when asked', () => {
    expect(summary(true)).toEqual([
      ['skip', 1, null],
      ['start', 1, 1],
      ['b', 1, 2],
      ['c', 2, 1],
      ['end', 2, 2],
    ])
  })

  it('colours markers by day', () => {
    const markers = stopMarkers(days, stops, { showSkipped: false })
    expect(markers.map((m) => m.colorIndex)).toEqual([0, 0, 1, 1])
  })

  it('drops stops on unknown days or without coordinates', () => {
    const markers = stopMarkers(
      days,
      [s('lost', 'nope', 'a0'), s('nan', 'd1', 'a0', { lat: Number.NaN })],
      { showSkipped: true },
    )
    expect(markers).toEqual([])
  })

  it('keeps numbering past a stop with bad coordinates', () => {
    const markers = stopMarkers(
      days,
      [s('nan', 'd1', 'a0', { lng: Number.NaN }), s('ok', 'd1', 'a1')],
      { showSkipped: false },
    )
    expect(markers.map((m) => [m.stopId, m.numberInDay])).toEqual([['ok', 2]])
  })
})

describe('markerLabel', () => {
  const base = {
    stopId: 'x',
    lat: 0,
    lng: 0,
    kind: 'waypoint' as const,
    skipped: false,
    dayNumber: 2,
    colorIndex: 1,
    numberInDay: 3,
  }

  it('names the day and stop number', () => {
    expect(markerLabel(base, 'Moab')).toBe('Day 2, stop 3: Moab')
  })

  it('notes start, end and skipped', () => {
    expect(markerLabel({ ...base, kind: 'end' }, 'Home')).toBe(
      'Day 2, stop 3: Home (end)',
    )
    expect(
      markerLabel({ ...base, skipped: true, numberInDay: null }, 'Arches'),
    ).toBe('Day 2: Arches (skipped)')
  })
})
