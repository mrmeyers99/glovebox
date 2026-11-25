// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Stop } from '../lib/database.types'
import type { TripAction } from './tripState'
import { useStopUpdates } from './useStopUpdates'

type Saved = { data: Stop | null; error: { message: string } | null }

const mocks = vi.hoisted(() => ({
  saved: undefined as unknown as Promise<Saved>,
  update: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => {
        mocks.update(patch)
        return {
          eq: (column: string, value: string) => {
            mocks.eq(column, value)
            return { select: () => ({ maybeSingle: () => mocks.saved }) }
          },
        }
      },
    }),
  },
}))

afterEach(cleanup)
beforeEach(() => {
  mocks.update.mockReset()
  mocks.eq.mockReset()
})

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
  updated_by: null,
  created_at: '',
  updated_at: '2026-11-25T00:00:00Z',
}

function setup() {
  const actions: TripAction[] = []
  const { result } = renderHook(() =>
    useStopUpdates((a) => actions.push(a), [], [stop]),
  )
  return { actions, result }
}

describe('useStopUpdates.setSkipped', () => {
  it('skips the stop at once and saves only `skipped`', async () => {
    const saved = { ...stop, skipped: true, updated_at: 'later' }
    mocks.saved = Promise.resolve({ data: saved, error: null })
    const { actions, result } = setup()

    await act(() => result.current.setSkipped(stop, true))

    expect(mocks.update).toHaveBeenCalledWith({ skipped: true })
    expect(mocks.eq).toHaveBeenCalledWith('id', 's1')
    expect(actions).toEqual([
      { type: 'upsertStop', stop: { ...stop, skipped: true } },
      { type: 'upsertStop', stop: saved },
    ])
    expect(result.current.error).toBeNull()
  })

  it('rolls back and reports a failed skip or unskip', async () => {
    mocks.saved = Promise.resolve({ data: null, error: { message: 'denied' } })
    const { actions, result } = setup()

    await act(() => result.current.setSkipped(stop, true))
    expect(actions.at(-1)).toEqual({ type: 'upsertStop', stop })
    expect(result.current.error).toBe("Couldn't skip Diner: denied")

    await act(() => result.current.setSkipped(stop, false))
    expect(result.current.error).toBe("Couldn't unskip Diner: denied")

    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })

  it("doesn't roll back over a newer change of the same stop", async () => {
    let fail: (value: Saved) => void = () => {}
    mocks.saved = new Promise((resolve) => (fail = resolve))
    const { actions, result } = setup()

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.setSkipped(stop, true)
    })
    const saved = { ...stop, updated_at: 'later' }
    mocks.saved = Promise.resolve({ data: saved, error: null })
    await act(() => result.current.setSkipped(stop, false))
    fail({ data: null, error: { message: 'denied' } })
    await act(() => first)

    expect(actions.at(-1)).toEqual({ type: 'upsertStop', stop: saved })
  })
})
