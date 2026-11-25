import { describe, expect, it, vi } from 'vitest'
import type { Stop, StopKind } from '../lib/database.types'
import { comparePositions } from '../lib/tripMath'
import { moveStop, reorderedPosition } from './reorderStops'
import type { TripAction } from './tripState'

const makeStop = (
  id: string,
  position: string,
  kind: StopKind = 'waypoint',
): Stop => ({
  id,
  trip_id: 't1',
  day_id: 'd1',
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
  updated_by: null,
  created_at: '',
  updated_at: '2026-11-25T00:00:00Z',
})

/** Ids in display order after giving `id` the key `position`. */
function orderAfter(stops: Stop[], id: string, position: string) {
  return stops
    .map((s) => (s.id === id ? { ...s, position } : s))
    .filter((s) => s.kind === 'waypoint')
    .sort((a, b) => comparePositions(a.position, b.position))
    .map((s) => s.id)
}

describe('reorderedPosition', () => {
  const day = [
    makeStop('start', 'Zz', 'start'),
    makeStop('a', 'a0'),
    makeStop('b', 'a1'),
    makeStop('c', 'a2'),
    makeStop('end', 'a0', 'end'),
  ]

  it('moves a stop down past its neighbour', () => {
    const position = reorderedPosition(day, 'a', 'b')!
    expect(orderAfter(day, 'a', position)).toEqual(['b', 'a', 'c'])
  })

  it('moves a stop up past its neighbour', () => {
    const position = reorderedPosition(day, 'c', 'b')!
    expect(orderAfter(day, 'c', position)).toEqual(['a', 'c', 'b'])
  })

  it('moves a stop to the first and last places among waypoints', () => {
    const first = reorderedPosition(day, 'c', 'a')!
    expect(orderAfter(day, 'c', first)).toEqual(['c', 'a', 'b'])
    const last = reorderedPosition(day, 'a', 'c')!
    expect(orderAfter(day, 'a', last)).toEqual(['b', 'c', 'a'])
  })

  it("ignores start and end stops' keys", () => {
    // Start's key sorts after every waypoint and end's before; neither
    // matters since start and end are always shown first and last.
    const last = reorderedPosition(day, 'a', 'c')!
    expect(comparePositions(last, 'a2')).toBeGreaterThan(0)
    const first = reorderedPosition(day, 'c', 'a')!
    expect(comparePositions(first, 'a0')).toBeLessThan(0)
  })

  it('returns null when nothing moves', () => {
    expect(reorderedPosition(day, 'a', 'a')).toBeNull()
    expect(reorderedPosition(day, 'a', 'missing')).toBeNull()
    expect(reorderedPosition(day, 'start', 'b')).toBeNull()
    expect(reorderedPosition(day, 'a', 'end')).toBeNull()
  })

  it('finds room when neighbours share a key', () => {
    const tied = [makeStop('a', 'a0'), makeStop('b', 'a1'), makeStop('c', 'a1')]
    // Moving a below b: neighbours b and c both have a1.
    const position = reorderedPosition(tied, 'a', 'b')!
    expect(comparePositions(position, 'a1')).toBeGreaterThan(0)
    expect(orderAfter(tied, 'a', position).at(-1)).toBe('a')
  })
})

describe('moveStop', () => {
  const stop = makeStop('a', 'a0')

  function setup(
    result: Awaited<ReturnType<Parameters<typeof moveStop>[2]['save']>>,
  ) {
    const actions: TripAction[] = []
    const save = vi.fn(async () => result)
    return {
      actions,
      save,
      deps: { dispatch: (a: TripAction) => actions.push(a), save },
    }
  }

  it('updates local state, saves only the moved stop, then applies the saved row', async () => {
    const saved = {
      ...stop,
      position: 'a5',
      updated_at: '2026-11-25T00:01:00Z',
    }
    const { actions, save, deps } = setup({ data: saved, error: null })

    const error = await moveStop(stop, 'a5', { ...deps, isLatest: () => true })

    expect(error).toBeNull()
    expect(save).toHaveBeenCalledExactlyOnceWith('a', 'a5')
    expect(actions).toEqual([
      { type: 'upsertStop', stop: { ...stop, position: 'a5' } },
      { type: 'upsertStop', stop: saved },
    ])
  })

  it('rolls back and reports the error when the save fails', async () => {
    const { actions, deps } = setup({
      data: null,
      error: { message: 'denied' },
    })

    const error = await moveStop(stop, 'a5', { ...deps, isLatest: () => true })

    expect(error).toBe('denied')
    expect(actions.at(-1)).toEqual({ type: 'upsertStop', stop })
  })

  it('rolls back when the save throws', async () => {
    const actions: TripAction[] = []
    const error = await moveStop(stop, 'a5', {
      dispatch: (a) => actions.push(a),
      save: async () => {
        throw new Error('offline')
      },
      isLatest: () => true,
    })
    expect(error).toBe('offline')
    expect(actions.at(-1)).toEqual({ type: 'upsertStop', stop })
  })

  it('reports a missing row (e.g. deleted meanwhile) as an error', async () => {
    const { deps } = setup({ data: null, error: null })
    const error = await moveStop(stop, 'a5', { ...deps, isLatest: () => true })
    expect(error).not.toBeNull()
  })

  it("doesn't roll back over a newer move of the same stop", async () => {
    const { actions, deps } = setup({
      data: null,
      error: { message: 'denied' },
    })

    await moveStop(stop, 'a5', { ...deps, isLatest: () => false })

    expect(actions).toEqual([
      { type: 'upsertStop', stop: { ...stop, position: 'a5' } },
    ])
  })
})
