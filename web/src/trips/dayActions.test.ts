import { describe, expect, it, vi } from 'vitest'
import type { Day, Stop, StopKind } from '../lib/database.types'
import { comparePositions } from '../lib/tripMath'
import {
  deleteDay,
  deleteDayError,
  deleteDayTarget,
  parseDayNotes,
  planDeleteDay,
  planInsertDay,
  type DeleteDayPlan,
} from './dayActions'

const makeDay = (id: string, position: string): Day => ({
  id,
  trip_id: 't1',
  position,
  notes: null,
  created_at: '',
  updated_at: '',
})

const makeStop = (
  id: string,
  dayId: string,
  position: string,
  kind: StopKind = 'waypoint',
): Stop => ({
  id,
  trip_id: 't1',
  day_id: dayId,
  position,
  kind,
  name: id,
  lat: 0,
  lng: 0,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  created_at: '',
  updated_at: '',
  updated_by: null,
})

// Listed out of order, to check days are sorted by key.
const days = [makeDay('d3', 'a2'), makeDay('d1', 'a0'), makeDay('d2', 'a1')]
const stops = [
  makeStop('start', 'd1', 'a0', 'start'),
  makeStop('s1', 'd1', 'a1'),
  makeStop('s2', 'd1', 'a2'),
  makeStop('m1', 'd2', 'a0'),
  makeStop('m2', 'd2', 'a1'),
  makeStop('l1', 'd3', 'a0'),
  makeStop('end', 'd3', 'a1', 'end'),
]

const lt = (a: string, b: string) => comparePositions(a, b) < 0

describe('parseDayNotes', () => {
  it('trims notes and clears blank ones', () => {
    expect(parseDayNotes('  Rest day\n')).toBe('Rest day')
    expect(parseDayNotes('   ')).toBeNull()
  })
})

describe('planInsertDay', () => {
  it('adds an empty day between a day and the next', () => {
    const plan = planInsertDay(days, stops, 'd1', 'new')!
    expect(plan.changes).toEqual([])
    expect(plan.newDay).toMatchObject({ id: 'new', trip_id: 't1', notes: null })
    expect(lt('a0', plan.newDay!.position)).toBe(true)
    expect(lt(plan.newDay!.position, 'a1')).toBe(true)
  })

  it('moves the end to a day inserted after the last', () => {
    const plan = planInsertDay(days, stops, 'd3', 'new')!
    expect(lt('a2', plan.newDay!.position)).toBe(true)
    expect(plan.changes).toEqual([
      { id: 'end', day_id: 'new', position: expect.any(String) },
    ])
  })

  it("leaves the end alone if it isn't on the last day", () => {
    const plan = planInsertDay(days, stops.slice(0, -1), 'd3', 'new')!
    expect(plan.changes).toEqual([])
  })

  it('returns null for a day that is gone', () => {
    expect(planInsertDay(days, stops, 'gone', 'new')).toBeNull()
  })
})

describe('deleteDayTarget', () => {
  it('is the day before, or the next day for Day 1', () => {
    expect(deleteDayTarget(days, 'd3')?.id).toBe('d2')
    expect(deleteDayTarget(days, 'd2')?.id).toBe('d1')
    expect(deleteDayTarget(days, 'd1')?.id).toBe('d2')
  })

  it('is null for the only day or a missing one', () => {
    expect(deleteDayTarget([makeDay('d1', 'a0')], 'd1')).toBeNull()
    expect(deleteDayTarget(days, 'gone')).toBeNull()
  })
})

/** Each day's stops in key order after `plan`. */
function after(plan: DeleteDayPlan) {
  const moved = new Map(plan.moves.map((m) => [m.id, m]))
  const result = new Map<string, string[]>()
  const rows = stops
    .filter((s) => !plan.deleteIds.includes(s.id))
    .map((s) => ({ ...s, ...moved.get(s.id) }))
    .filter((s) => s.day_id !== plan.dayId)
    .sort((a, b) => comparePositions(a.position, b.position))
  for (const s of rows)
    result.set(s.day_id, [...(result.get(s.day_id) ?? []), s.id])
  return Object.fromEntries(result)
}

describe('planDeleteDay', () => {
  it('moves a middle day’s stops to the end of the day before', () => {
    const plan = planDeleteDay(days, stops, 'd2', 'move') as DeleteDayPlan
    expect(plan.deleteIds).toEqual([])
    expect(after(plan)).toEqual({
      d1: ['start', 's1', 's2', 'm1', 'm2'],
      d3: ['l1', 'end'],
    })
  })

  it('moves the last day’s stops and end to the day before', () => {
    const plan = planDeleteDay(days, stops, 'd3', 'move') as DeleteDayPlan
    expect(after(plan)).toEqual({
      d1: ['start', 's1', 's2'],
      d2: ['m1', 'm2', 'l1', 'end'],
    })
  })

  it('moves Day 1’s stops to the start of the next day', () => {
    const plan = planDeleteDay(days, stops, 'd1', 'move') as DeleteDayPlan
    expect(after(plan)).toEqual({
      d2: ['start', 's1', 's2', 'm1', 'm2'],
      d3: ['l1', 'end'],
    })
  })

  it('deletes the stops but moves the start or end to the new first or last day', () => {
    const first = planDeleteDay(days, stops, 'd1', 'delete') as DeleteDayPlan
    expect(first.deleteIds).toEqual(['s1', 's2'])
    expect(after(first)).toEqual({
      d2: ['start', 'm1', 'm2'],
      d3: ['l1', 'end'],
    })

    const last = planDeleteDay(days, stops, 'd3', 'delete') as DeleteDayPlan
    expect(last.deleteIds).toEqual(['l1'])
    expect(after(last)).toEqual({
      d1: ['start', 's1', 's2'],
      d2: ['m1', 'm2', 'end'],
    })

    const middle = planDeleteDay(days, stops, 'd2', 'delete') as DeleteDayPlan
    expect(middle).toEqual({ dayId: 'd2', moves: [], deleteIds: ['m1', 'm2'] })
  })

  it('fits moved stops before an end whose key is in order', () => {
    const twoDays = [
      makeDay('d1', 'a0'),
      makeDay('d2', 'a1'),
      makeDay('d3', 'a2'),
    ]
    const rows = [
      makeStop('x', 'd2', 'a0'),
      makeStop('end', 'd2', 'a5', 'end'),
      makeStop('y', 'd3', 'a0'),
    ]
    // Not realistic (the end is on the last day), but the keys stay in order.
    const plan = planDeleteDay(twoDays, rows, 'd3', 'move') as DeleteDayPlan
    const y = plan.moves.find((m) => m.id === 'y')!
    expect(lt('a0', y.position!)).toBe(true)
    expect(lt(y.position!, 'a5')).toBe(true)
  })

  it('moves stops onto an empty day', () => {
    const rows = [makeStop('x', 'd2', 'a0')]
    const plan = planDeleteDay(days, rows, 'd2', 'move') as DeleteDayPlan
    expect(plan.moves).toEqual([
      { id: 'x', day_id: 'd1', position: expect.any(String) },
    ])
  })

  it('refuses to delete the only day or a missing one', () => {
    expect(planDeleteDay([makeDay('d1', 'a0')], [], 'd1', 'move')).toEqual({
      error: 'A trip needs at least one day.',
    })
    expect(planDeleteDay(days, stops, 'gone', 'move')).toEqual({
      error: 'This day no longer exists.',
    })
  })
})

describe('deleteDayError', () => {
  it('explains the database errors', () => {
    expect(deleteDayError({ code: '23503', message: 'fk' })).toMatch(
      /added a stop/,
    )
    expect(deleteDayError({ code: '23514', message: 'check' })).toBe(
      'A trip needs at least one day.',
    )
    expect(deleteDayError({ code: 'P0002', message: 'x' })).toMatch(
      /no longer exists/,
    )
    expect(deleteDayError({ message: 'offline' })).toBe('offline')
  })
})

describe('deleteDay', () => {
  const plan: DeleteDayPlan = {
    dayId: 'd2',
    moves: [{ id: 'm1', day_id: 'd1', position: 'b0' }],
    deleteIds: ['m2'],
  }

  it('updates local state once the delete is saved', async () => {
    const dispatch = vi.fn()
    const saved = { ...stops[3], day_id: 'd1', position: 'b0' }
    const save = vi.fn().mockResolvedValue({ data: [saved], error: null })
    expect(await deleteDay(plan, { dispatch, save })).toBeNull()
    expect(save).toHaveBeenCalledWith(plan)
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      { type: 'upsertStop', stop: saved },
      { type: 'removeStop', id: 'm2', ifPresent: true },
      { type: 'removeDay', id: 'd2', ifPresent: true },
    ])
  })

  it('changes nothing and explains a failure', async () => {
    const dispatch = vi.fn()
    const failed = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23503', message: '' } })
    expect(await deleteDay(plan, { dispatch, save: failed })).toMatch(
      /added a stop/,
    )
    const empty = vi.fn().mockResolvedValue({ data: null, error: null })
    expect(await deleteDay(plan, { dispatch, save: empty })).toBe(
      'The day could not be deleted.',
    )
    const thrown = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await deleteDay(plan, { dispatch, save: thrown })).toBe('offline')
    const thrownValue = vi.fn().mockRejectedValue('boom')
    expect(await deleteDay(plan, { dispatch, save: thrownValue })).toBe('boom')
    expect(dispatch).not.toHaveBeenCalled()
  })
})
