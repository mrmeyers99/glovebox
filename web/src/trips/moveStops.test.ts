import { describe, expect, it, vi } from 'vitest'
import type { Day, Stop, StopKind } from '../lib/database.types'
import { comparePositions } from '../lib/tripMath'
import {
  dropPlacement,
  moveStop,
  moveToNewDay,
  reorderedPosition,
} from './moveStops'
import { tripReducer, type TripAction, type TripState } from './tripState'

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

    const error = await moveStop(
      stop,
      { position: 'a5' },
      { ...deps, isLatest: () => true },
    )

    expect(error).toBeNull()
    expect(save).toHaveBeenCalledExactlyOnceWith('a', { position: 'a5' })
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

    const error = await moveStop(
      stop,
      { position: 'a5' },
      { ...deps, isLatest: () => true },
    )

    expect(error).toBe('denied')
    expect(actions.at(-1)).toEqual({ type: 'upsertStop', stop })
  })

  it('rolls back when the save throws', async () => {
    const actions: TripAction[] = []
    const error = await moveStop(
      stop,
      { position: 'a5' },
      {
        dispatch: (a) => actions.push(a),
        save: async () => {
          throw new Error('offline')
        },
        isLatest: () => true,
      },
    )
    expect(error).toBe('offline')
    expect(actions.at(-1)).toEqual({ type: 'upsertStop', stop })
  })

  it('reports a missing row (e.g. deleted meanwhile) as an error', async () => {
    const { deps } = setup({ data: null, error: null })
    const error = await moveStop(
      stop,
      { position: 'a5' },
      { ...deps, isLatest: () => true },
    )
    expect(error).not.toBeNull()
  })

  it("doesn't roll back over a newer move of the same stop", async () => {
    const { actions, deps } = setup({
      data: null,
      error: { message: 'denied' },
    })

    await moveStop(stop, { position: 'a5' }, { ...deps, isLatest: () => false })

    expect(actions).toEqual([
      { type: 'upsertStop', stop: { ...stop, position: 'a5' } },
    ])
  })
})

describe('dropPlacement', () => {
  const byDay: Record<string, Stop[]> = {
    d1: [
      makeStop('start', 'a0', 'start', 'd1'),
      makeStop('a', 'a1', 'waypoint', 'd1'),
      makeStop('b', 'a2', 'waypoint', 'd1'),
    ],
    d2: [
      makeStop('c', 'a0', 'waypoint', 'd2'),
      makeStop('d', 'a1', 'waypoint', 'd2'),
      makeStop('end', 'a0', 'end', 'd2'),
    ],
    rest: [],
  }
  const stopsOnDay = (dayId: string) => byDay[dayId] ?? []
  const a = byDay.d1[1]

  /** Waypoint ids on `dayId` in order once `a` is placed by `placement`. */
  function orderOn(dayId: string, placement: ReturnType<typeof dropPlacement>) {
    if (placement?.type !== 'day') throw new Error('expected a day placement')
    const moved = {
      ...a,
      day_id: placement.dayId,
      position: placement.position,
    }
    return [...stopsOnDay(dayId).filter((s) => s.id !== a.id), moved]
      .filter((s) => s.day_id === dayId && s.kind === 'waypoint')
      .sort((x, y) => comparePositions(x.position, y.position))
      .map((s) => s.id)
  }

  it('reorders within the same day like the sortable list', () => {
    const placement = dropPlacement(stopsOnDay, a, {
      type: 'stop',
      dayId: 'd1',
      stopId: 'b',
      after: false,
    })
    expect(placement).toMatchObject({ type: 'day', dayId: 'd1' })
    expect(orderOn('d1', placement)).toEqual(['b', 'a'])
  })

  it('goes before or after the stop it is dropped on, on another day', () => {
    const target = { type: 'stop', dayId: 'd2', stopId: 'd' } as const
    const before = dropPlacement(stopsOnDay, a, { ...target, after: false })
    expect(orderOn('d2', before)).toEqual(['c', 'a', 'd'])
    const after = dropPlacement(stopsOnDay, a, { ...target, after: true })
    expect(orderOn('d2', after)).toEqual(['c', 'd', 'a'])
    const first = dropPlacement(stopsOnDay, a, {
      ...target,
      stopId: 'c',
      after: false,
    })
    expect(orderOn('d2', first)).toEqual(['a', 'c', 'd'])
  })

  it('goes at the end of a day dropped on outside its stops', () => {
    const placement = dropPlacement(stopsOnDay, a, { type: 'day', dayId: 'd2' })
    expect(orderOn('d2', placement)).toEqual(['c', 'd', 'a'])
  })

  it('moves onto an empty (rest) day', () => {
    expect(
      dropPlacement(stopsOnDay, a, { type: 'day', dayId: 'rest' }),
    ).toEqual({ type: 'day', dayId: 'rest', position: 'a0' })
  })

  it('passes a drop on the new-day zone through', () => {
    expect(dropPlacement(stopsOnDay, a, { type: 'newDay' })).toEqual({
      type: 'newDay',
    })
  })

  it('returns null when nothing moves', () => {
    expect(
      dropPlacement(stopsOnDay, a, { type: 'day', dayId: 'd1' }),
    ).toBeNull()
    expect(
      dropPlacement(stopsOnDay, a, {
        type: 'stop',
        dayId: 'd1',
        stopId: 'a',
        after: true,
      }),
    ).toBeNull()
    // Only waypoints move.
    expect(
      dropPlacement(stopsOnDay, byDay.d1[0], { type: 'day', dayId: 'd2' }),
    ).toBeNull()
  })
})

describe('moveToNewDay', () => {
  const makeDay = (id: string, position: string): Day => ({
    id,
    trip_id: 't1',
    position,
    notes: null,
    created_at: '',
    updated_at: '2026-11-25T00:00:00Z',
  })
  const days = [makeDay('d1', 'a0'), makeDay('d2', 'a1')]
  const stops = [
    makeStop('start', 'a0', 'start', 'd1'),
    makeStop('a', 'a1', 'waypoint', 'd1'),
    makeStop('end', 'a0', 'end', 'd2'),
  ]
  const ready = {
    status: 'ready',
    trip: { id: 't1' },
    days,
    stops,
    role: 'owner',
    removedIds: new Set<string>(),
    refreshing: null,
  } as unknown as TripState

  function setup({
    insertFails = false,
    saveFails = () => false,
    deleteFails = false,
  }: {
    insertFails?: boolean
    saveFails?: (stopId: string) => boolean
    deleteFails?: boolean
  } = {}) {
    let state = ready
    const insertDay = vi.fn(
      async (day: Pick<Day, 'id' | 'trip_id' | 'position'>) =>
        insertFails
          ? { data: null, error: { message: 'insert denied' } }
          : { data: { ...makeDay(day.id, day.position) }, error: null },
    )
    const save = vi.fn(
      async (id: string, move: { day_id?: string; position: string }) => {
        if (saveFails(id))
          return { data: null, error: { message: 'save denied' } }
        const stop = stops.find((s) => s.id === id)!
        return { data: { ...stop, ...move }, error: null }
      },
    )
    const deleteDay = vi.fn(async () =>
      deleteFails ? { error: { message: 'delete denied' } } : { error: null },
    )
    const run = () =>
      moveToNewDay(stops[1], {
        days,
        stops,
        newDayId: 'd3',
        dispatch: (action) => {
          state = tripReducer(state, action)
        },
        insertDay,
        deleteDay,
        save,
        isLatest: () => true,
      })
    const current = () => state as Extract<TripState, { status: 'ready' }>
    const dayOf = (id: string) =>
      current().stops.find((s) => s.id === id)?.day_id
    return { run, current, dayOf, insertDay, save, deleteDay }
  }

  it('creates exactly one day after the last and moves the stop and end stop into it', async () => {
    const { run, current, dayOf, insertDay, save } = setup()

    expect(await run()).toBeNull()

    expect(insertDay).toHaveBeenCalledOnce()
    const day = insertDay.mock.calls[0][0]
    expect(day.id).toBe('d3')
    expect(comparePositions(day.position, 'a1')).toBeGreaterThan(0)
    expect(current().days.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(dayOf('a')).toBe('d3')
    expect(dayOf('end')).toBe('d3')
    expect(dayOf('start')).toBe('d1')
    expect(save).toHaveBeenCalledWith('a', { day_id: 'd3', position: 'a0' })
    expect(save).toHaveBeenCalledWith('end', { day_id: 'd3', position: 'a1' })
  })

  it('shows the move before anything is saved', () => {
    const { run, current, dayOf } = setup()
    void run()
    expect(current().days).toHaveLength(3)
    expect(dayOf('a')).toBe('d3')
    expect(dayOf('end')).toBe('d3')
  })

  it('rolls everything back if the day cannot be created', async () => {
    const { run, current, save } = setup({ insertFails: true })

    expect(await run()).toBe('insert denied')

    expect(current().days).toEqual(days)
    expect(current().stops).toEqual(stops)
    expect(save).not.toHaveBeenCalled()
  })

  it('deletes the new day again if the stop cannot move into it', async () => {
    const { run, current, deleteDay } = setup({ saveFails: (id) => id === 'a' })

    expect(await run()).toBe('save denied')

    expect(deleteDay).toHaveBeenCalledExactlyOnceWith('d3')
    expect(current().days).toEqual(days)
    expect(current().stops).toEqual(stops)
  })

  it('keeps the new day if it cannot be deleted', async () => {
    const { run, current, dayOf } = setup({
      saveFails: (id) => id === 'a',
      deleteFails: true,
    })

    expect(await run()).toBe('save denied')

    expect(current().days.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(dayOf('a')).toBe('d1')
    expect(dayOf('end')).toBe('d2')
  })

  it('reports an end stop that could not follow', async () => {
    const { run, dayOf } = setup({ saveFails: (id) => id === 'end' })

    expect(await run()).toMatch(/end stop/)

    expect(dayOf('a')).toBe('d3')
    expect(dayOf('end')).toBe('d2')
  })

  it('leaves a trip without an end stop alone', async () => {
    const { save } = setup()
    const result = await moveToNewDay(stops[1], {
      days,
      stops: stops.filter((s) => s.kind !== 'end'),
      newDayId: 'd3',
      dispatch: () => {},
      insertDay: async (day) => ({
        data: makeDay(day.id, day.position),
        error: null,
      }),
      deleteDay: async () => ({ error: null }),
      save,
      isLatest: () => true,
    })
    expect(result).toBeNull()
    expect(save).toHaveBeenCalledOnce()
  })
})
