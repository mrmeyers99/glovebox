import { describe, expect, it } from 'vitest'
import type { Place } from '../lib/geocode'
import {
  DROPPED_PIN_NAME,
  defaultDropDay,
  droppedPin,
  formatCoordinates,
  mapPoint,
  numberedDays,
  placeAtPoint,
} from './mapAdd'

const point = { lat: 38.6, lng: -109.6 }

describe('mapPoint', () => {
  it('rounds to 6 decimals', () => {
    expect(mapPoint(38.123456789, -109.987654321)).toEqual({
      lat: 38.123457,
      lng: -109.987654,
    })
  })

  it('wraps longitude from a world copy into -180..180', () => {
    expect(mapPoint(40, 250)).toEqual({ lat: 40, lng: -110 })
    expect(mapPoint(40, -470)).toEqual({ lat: 40, lng: -110 })
    expect(mapPoint(40, 180)).toEqual({ lat: 40, lng: 180 })
    expect(mapPoint(40, -180)).toEqual({ lat: 40, lng: -180 })
  })

  it('clamps latitude to -90..90', () => {
    expect(mapPoint(91, 0).lat).toBe(90)
    expect(mapPoint(-95, 0).lat).toBe(-90)
  })
})

describe('droppedPin', () => {
  it('is named "Dropped pin" with the coordinates as its address', () => {
    expect(formatCoordinates(point)).toBe('38.60000, -109.60000')
    expect(droppedPin(point)).toEqual({
      name: DROPPED_PIN_NAME,
      address: '38.60000, -109.60000',
      ...point,
    })
  })
})

describe('placeAtPoint', () => {
  const found: Place = {
    name: 'Delicate Arch Viewpoint',
    address: 'Grand County, UT, USA',
    lat: 38.61,
    lng: -109.58,
  }

  it("takes the found place's name and address but keeps the dropped point", () => {
    expect(placeAtPoint(point, found)).toEqual({
      name: 'Delicate Arch Viewpoint',
      address: 'Grand County, UT, USA',
      ...point,
    })
  })

  it('is a dropped pin when nothing was found', () => {
    expect(placeAtPoint(point, null)).toEqual(droppedPin(point))
    expect(placeAtPoint(point, { ...found, name: ' ' })).toEqual(
      droppedPin(point),
    )
  })

  it('falls back to the coordinates when the place has no address', () => {
    expect(placeAtPoint(point, { ...found, address: '' }).address).toBe(
      '38.60000, -109.60000',
    )
  })
})

describe('numberedDays / defaultDropDay', () => {
  // Out of order, and with keys that localeCompare would sort differently.
  const days = [
    { id: 'd3', position: 'a2' },
    { id: 'd1', position: 'a0' },
    { id: 'd2', position: 'a1' },
    { id: 'd4', position: 'aZ' },
  ]
  const stops = [
    { id: 's1', day_id: 'd1' },
    { id: 's2', day_id: 'd2' },
  ]

  it('numbers days by position, byte-wise', () => {
    expect(numberedDays(days)).toEqual([
      { dayId: 'd1', dayNumber: 1 },
      { dayId: 'd2', dayNumber: 2 },
      { dayId: 'd3', dayNumber: 3 },
      { dayId: 'd4', dayNumber: 4 },
    ])
  })

  it("defaults to the selected stop's day", () => {
    expect(defaultDropDay(days, stops, 's2')).toEqual({
      dayId: 'd2',
      dayNumber: 2,
    })
  })

  it('defaults to the last day with no selection, or a stale one', () => {
    const last = { dayId: 'd4', dayNumber: 4 }
    expect(defaultDropDay(days, stops, null)).toEqual(last)
    expect(defaultDropDay(days, stops, 'gone')).toEqual(last)
  })

  it('is null for a trip without days', () => {
    expect(defaultDropDay([], [], null)).toBeNull()
  })
})
