import { describe, expect, it, vi } from 'vitest'
import type { Stop } from '../lib/database.types'
import { setStopSkipped, type SaveSkipped } from './skipStop'
import type { TripAction } from './tripState'

const stop: Stop = {
  id: 's1',
  trip_id: 't1',
  day_id: 'd1',
  position: 'a0',
  kind: 'waypoint',
  name: 'Diner',
  lat: 0,
  lng: 0,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  place_id: null,
  updated_by: null,
  created_at: '',
  updated_at: '2026-11-25T00:00:00Z',
}

function setup(save: SaveSkipped, isLatest = true) {
  const actions: TripAction[] = []
  const deps = {
    dispatch: (a: TripAction) => actions.push(a),
    save: vi.fn(save),
    isLatest: () => isLatest,
  }
  return { actions, deps }
}

describe('setStopSkipped', () => {
  it('skips the stop at once, saves only `skipped`, then applies the saved row', async () => {
    const saved = { ...stop, skipped: true, updated_at: 'later' }
    const { actions, deps } = setup(async () => ({ data: saved, error: null }))

    expect(await setStopSkipped(stop, true, deps)).toBeNull()
    expect(deps.save).toHaveBeenCalledExactlyOnceWith('s1', true)
    expect(actions).toEqual([
      { type: 'upsertStop', stop: { ...stop, skipped: true } },
      { type: 'upsertStop', stop: saved },
    ])
  })

  it('rolls back and reports a failed save', async () => {
    const { actions, deps } = setup(async () => ({
      data: null,
      error: { message: 'denied' },
    }))
    expect(await setStopSkipped(stop, true, deps)).toBe('denied')
    expect(actions.at(-1)).toEqual({ type: 'upsertStop', stop })
  })

  it('rolls back when the save throws, or the row is gone', async () => {
    const thrown = setup(async () => {
      throw new Error('offline')
    })
    expect(await setStopSkipped(stop, true, thrown.deps)).toBe('offline')
    expect(thrown.actions.at(-1)).toEqual({ type: 'upsertStop', stop })

    const missing = setup(async () => ({ data: null, error: null }))
    expect(await setStopSkipped(stop, true, missing.deps)).toBe(
      'The stop could not be found.',
    )
  })

  it("doesn't roll back over a newer change of the same stop", async () => {
    const { actions, deps } = setup(
      async () => ({ data: null, error: { message: 'denied' } }),
      false,
    )
    await setStopSkipped(stop, true, deps)
    expect(actions).toEqual([
      { type: 'upsertStop', stop: { ...stop, skipped: true } },
    ])
  })
})
