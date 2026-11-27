// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Day, Stop, StopKind } from '../lib/database.types'
import { useMoveStop } from './useMoveStop'

const rpc = vi.fn()
const from = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}))

afterEach(cleanup)

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
  position: string,
  kind: StopKind = 'waypoint',
  dayId = 'd1',
): Stop => ({
  id,
  trip_id: 't1',
  day_id: dayId,
  position,
  kind,
  name: `Stop ${id}`,
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
  place_id: null,
  updated_by: null,
})

const days = [makeDay('d1', 'a0'), makeDay('d2', 'a1')]
const stops = [
  makeStop('start', 'a0', 'start', 'd1'),
  makeStop('a', 'a1', 'waypoint', 'd1'),
  makeStop('end', 'a0', 'end', 'd2'),
]

function setup(stopList = stops) {
  const dispatch = vi.fn()
  const hook = renderHook(() => useMoveStop(dispatch, days, stopList))
  return { dispatch, hook }
}

beforeEach(() => {
  rpc.mockReset()
  from.mockReset()
})

describe('useMoveStop', () => {
  it('saves a role hand-off in one move_stops call', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const { hook } = setup()

    await act(() =>
      hook.result.current.move(stops[1], {
        type: 'day',
        dayId: 'd1',
        index: 0,
      }),
    )

    expect(rpc).toHaveBeenCalledOnce()
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('move_stops')
    expect(args.p_moves.map((c: { id: string }) => c.id).sort()).toEqual([
      'a',
      'start',
    ])
    expect(hook.result.current.error).toBeNull()
  })

  it('reports a failed save', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'denied' } })
    const { hook } = setup()

    await act(() =>
      hook.result.current.move(stops[1], {
        type: 'day',
        dayId: 'd1',
        index: 0,
      }),
    )

    expect(hook.result.current.error).toBe("Couldn't move Stop a: denied")
    act(() => hook.result.current.clearError())
    expect(hook.result.current.error).toBeNull()
  })

  it('refuses a move that leaves a role without a stop, without saving', async () => {
    const lonely = [
      makeStop('start', 'a0', 'start', 'd1'),
      makeStop('end', 'a0', 'end', 'd2'),
    ]
    const { hook, dispatch } = setup(lonely)

    await act(() =>
      hook.result.current.move(lonely[0], {
        type: 'day',
        dayId: 'd2',
        index: 0,
      }),
    )

    expect(hook.result.current.error).toMatch(/Day 1 needs a stop/)
    expect(rpc).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does nothing when the stop stays put', async () => {
    const { hook, dispatch } = setup()
    await act(() =>
      hook.result.current.move(stops[1], {
        type: 'day',
        dayId: 'd1',
        index: 1,
      }),
    )
    expect(rpc).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('creates the new day before moving stops into it', async () => {
    const single = vi.fn()
    from.mockReturnValue({
      insert: (day: Day) => ({
        select: () => ({
          single: () => {
            single(day)
            return Promise.resolve({ data: { ...day }, error: null })
          },
        }),
      }),
    })
    rpc.mockResolvedValue({ data: [], error: null })
    const { hook } = setup()

    await act(() => hook.result.current.move(stops[1], { type: 'newDay' }))

    expect(from).toHaveBeenCalledWith('days')
    expect(single).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledOnce()
    expect(hook.result.current.error).toBeNull()
  })

  it('deletes the new day again if the stops cannot move', async () => {
    const deleted = vi.fn()
    from.mockReturnValue({
      insert: (day: Day) => ({
        select: () => ({
          single: () => Promise.resolve({ data: { ...day }, error: null }),
        }),
      }),
      delete: () => ({
        eq: (_column: string, id: string) => {
          deleted(id)
          return Promise.resolve({ error: null })
        },
      }),
    })
    rpc.mockResolvedValue({ data: null, error: { message: 'denied' } })
    const { hook } = setup()

    await act(() => hook.result.current.move(stops[1], { type: 'newDay' }))

    expect(deleted).toHaveBeenCalledOnce()
    expect(hook.result.current.error).toBe("Couldn't move Stop a: denied")
  })

  it('inserts a day after another, bringing the end along after the last', async () => {
    const inserted = vi.fn()
    from.mockReturnValue({
      insert: (day: Day) => ({
        select: () => ({
          single: () => {
            inserted(day)
            return Promise.resolve({ data: { ...day }, error: null })
          },
        }),
      }),
    })
    rpc.mockResolvedValue({ data: [], error: null })
    const { hook } = setup()

    await act(() => hook.result.current.insertDayAfter('d1'))
    expect(inserted).toHaveBeenCalledOnce()
    expect(rpc).not.toHaveBeenCalled()

    await act(() => hook.result.current.insertDayAfter('d2'))
    expect(inserted).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledOnce()
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('move_stops')
    expect(args.p_moves).toEqual([
      expect.objectContaining({
        id: 'end',
        day_id: inserted.mock.calls[1][0].id,
      }),
    ])
    expect(hook.result.current.error).toBeNull()
  })

  it('reports a day that could not be inserted', async () => {
    from.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { message: 'denied' } }),
        }),
      }),
    })
    const { hook, dispatch } = setup()

    await act(() => hook.result.current.insertDayAfter('d1'))
    expect(hook.result.current.error).toBe("Couldn't insert a day: denied")
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'removeDay' }),
    )

    dispatch.mockReset()
    await act(() => hook.result.current.insertDayAfter('gone'))
    expect(dispatch).not.toHaveBeenCalled()
  })
})
