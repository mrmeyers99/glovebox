import { describe, expect, it } from 'vitest'
import type { Day, Stop } from './database.types'
import { summarizeTrip } from './tripMath'
import { toDayInput, toStopInput } from './tripRows'

const day: Day = {
  id: 'd1',
  trip_id: 't1',
  position: 'a0',
  notes: 'Leave early',
  created_at: '2026-11-25T00:00:00Z',
  updated_at: '2026-11-25T00:00:00Z',
}

const stop: Stop = {
  id: 's1',
  trip_id: 't1',
  day_id: 'd1',
  position: 'a1',
  kind: 'waypoint',
  name: 'Diner',
  lat: 40.1,
  lng: -105.2,
  address: null,
  notes: null,
  cost_amount: 12.5,
  cost_category: 'food',
  arrival_time: null,
  stay_minutes: 30,
  skipped: false,
  created_at: '2026-11-25T00:00:00Z',
  updated_at: '2026-11-25T00:00:00Z',
  updated_by: null,
}

describe('toDayInput', () => {
  it('keeps id and position', () => {
    expect(toDayInput(day)).toEqual({ id: 'd1', position: 'a0' })
  })
})

describe('toStopInput', () => {
  it('maps snake_case columns to tripMath fields', () => {
    expect(toStopInput(stop)).toEqual({
      id: 's1',
      dayId: 'd1',
      position: 'a1',
      kind: 'waypoint',
      skipped: false,
      lat: 40.1,
      lng: -105.2,
      costAmount: 12.5,
      costCategory: 'food',
    })
  })

  it('keeps a missing cost as null', () => {
    const input = toStopInput({
      ...stop,
      cost_amount: null,
      cost_category: null,
    })
    expect(input.costAmount).toBeNull()
    expect(input.costCategory).toBeNull()
  })

  it('converts numeric values that arrive as strings', () => {
    const input = toStopInput({
      ...stop,
      lat: '40.1' as unknown as number,
      cost_amount: '12.50' as unknown as number,
    })
    expect(input.lat).toBe(40.1)
    expect(input.costAmount).toBe(12.5)
  })

  it('feeds summarizeTrip', () => {
    const summary = summarizeTrip([toDayInput(day)], [toStopInput(stop)], {
      mpg: 25,
      gasPricePerGallon: 3,
      route: () => undefined,
    })
    expect(summary.totals.costsByCategory.food).toBe(12.5)
  })
})
