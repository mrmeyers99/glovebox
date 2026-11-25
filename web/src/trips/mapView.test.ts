import { describe, expect, it } from 'vitest'
import {
  summarizeTrip,
  type RouteLookup,
  type StopInput,
} from '../lib/tripMath'
import {
  CONTINENTAL_US_BOUNDS,
  DAY_COLOR_COUNT,
  dayColor,
  dayColorExpression,
  dayColorIndex,
  highlightedDay,
  initialBounds,
  markerLabel,
  routeBounds,
  routeLines,
  routeReady,
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
      m.stopNumber,
    ])

  it('numbers active waypoints across the whole trip, in trip order', () => {
    expect(summary(false)).toEqual([
      ['start', 1, null],
      ['b', 1, 1],
      // 'Zz' sorts before 'a0' byte-wise (uppercase first).
      ['c', 2, 2],
      ['end', 2, null],
    ])
  })

  it('shows skipped stops, unnumbered and underneath, when asked', () => {
    expect(summary(true)).toEqual([
      ['skip', 1, null],
      ['start', 1, null],
      ['b', 1, 1],
      ['c', 2, 2],
      ['end', 2, null],
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
    expect(markers.map((m) => [m.stopId, m.stopNumber])).toEqual([['ok', 2]])
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
    stopNumber: 3,
  }

  it('names the day and stop number', () => {
    expect(markerLabel(base, 'Moab')).toBe('Day 2, stop 3: Moab')
  })

  it('notes start, end and skipped', () => {
    expect(
      markerLabel({ ...base, kind: 'end', stopNumber: null }, 'Home'),
    ).toBe('Day 2: Home (end)')
    expect(
      markerLabel({ ...base, skipped: true, stopNumber: null }, 'Arches'),
    ).toBe('Day 2: Arches (skipped)')
  })
})

describe('route lines', () => {
  const days = [
    { id: 'd1', position: 'a' },
    { id: 'd2', position: 'b' },
  ]
  const s = (
    id: string,
    dayId: string,
    position: string,
    lat: number,
    lng: number,
    extra: Partial<StopInput> = {},
  ): StopInput => ({
    id,
    dayId,
    position,
    kind: 'waypoint',
    skipped: false,
    lat,
    lng,
    costAmount: null,
    costCategory: null,
    ...extra,
  })
  const stops = [
    s('start', 'd1', 'a', 1, 1, { kind: 'start' }),
    s('a', 'd1', 'b', 2, 2),
    s('skip', 'd2', 'a', 9, 9, { skipped: true }),
    s('end', 'd2', 'b', 3, 4, { kind: 'end' }),
  ]
  // Encoded [lat, lng] lines between the stops above.
  const geometry: Record<string, string> = {
    'start>a': '_ibE_ibE_ibE_ibE', // (1,1) → (2,2)
    'a>end': '_seK_seK_ibE_seK', // (2,2) → (3,4)
  }
  const routes =
    (known: Record<string, string | null | undefined>): RouteLookup =>
    (from, to) => {
      const key = `${from.id}>${to.id}`
      if (!(key in known)) return undefined
      const g = known[key]
      if (g === null) return null
      return { distanceM: 1000, durationS: 60, geometry: g }
    }
  const summarize = (route: RouteLookup) =>
    summarizeTrip(days, stops, { mpg: 25, gasPricePerGallon: 3, route })

  it('draws each leg in its arrival day, around skipped stops', () => {
    const lines = routeLines(summarize(routes(geometry)))
    expect(lines.features.map((f) => f.properties)).toEqual([
      { toStopId: 'a', dayNumber: 1, colorIndex: 0 },
      { toStopId: 'end', dayNumber: 2, colorIndex: 1 },
    ])
    expect(lines.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [1, 1],
        [2, 2],
      ],
    })
    expect(lines.features[1].geometry.coordinates).toEqual([
      [2, 2],
      [4, 3],
    ])
  })

  it('leaves out pending, failed, single-point and malformed legs', () => {
    expect(
      routeLines(summarize(routes({ 'start>a': '_ibE_ibE' }))).features,
    ).toEqual([])
    expect(
      routeLines(summarize(routes({ 'start>a': '_ibE', 'a>end': null })))
        .features,
    ).toEqual([])
  })

  it('is ready once no leg is pending and something can be drawn', () => {
    const partial = summarize(routes({ 'start>a': geometry['start>a'] }))
    expect(routeReady(partial, routeLines(partial))).toBe(false)
    const full = summarize(routes(geometry))
    expect(routeReady(full, routeLines(full))).toBe(true)
    const failed = summarize(routes({ 'start>a': null, 'a>end': null }))
    expect(routeReady(failed, routeLines(failed))).toBe(false)
  })

  it('bounds every line', () => {
    expect(routeBounds(routeLines(summarize(routes(geometry))))).toEqual([
      [1, 1],
      [4, 3],
    ])
    expect(routeBounds({ type: 'FeatureCollection', features: [] })).toBe(null)
  })

  it("highlights the selected stop's day", () => {
    const summary = summarize(routes(geometry))
    expect(highlightedDay(summary, null)).toBe(null)
    expect(highlightedDay(summary, 'a')).toBe(1)
    expect(highlightedDay(summary, 'skip')).toBe(2)
    expect(highlightedDay(summary, 'gone')).toBe(null)
  })
})

describe('dayColorExpression', () => {
  it('matches each colour index to its palette colour', () => {
    const palette = Array.from(
      { length: DAY_COLOR_COUNT },
      (_, i) => `#00000${i}`,
    )
    const expression = dayColorExpression(palette)
    expect(expression.slice(0, 4)).toEqual([
      'match',
      ['get', 'colorIndex'],
      0,
      '#000000',
    ])
    expect(expression).toHaveLength(3 + 2 * DAY_COLOR_COUNT)
  })

  it('falls back to grey for colours that did not resolve', () => {
    const expression = dayColorExpression([])
    expect(expression[3]).toBe('#888888')
    expect(expression.at(-1)).toBe('#888888')
  })
})
