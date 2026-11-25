import { describe, expect, it, vi } from 'vitest'
import type { Day, Stop, StopKind } from '../lib/database.types'
import { comparePositions } from '../lib/tripMath'
import {
  applyMove,
  dropPlacement,
  planMove,
  type MovePlan,
  type Placement,
  type StopChange,
} from './moveStops'
import { tripReducer, type TripState } from './tripState'

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

const makeDay = (id: string, position: string): Day => ({
  id,
  trip_id: 't1',
  position,
  notes: null,
  created_at: '',
  updated_at: '2026-11-25T00:00:00Z',
})

const rank = (s: Stop) => (s.kind === 'start' ? 0 : s.kind === 'end' ? 2 : 1)

/** Each day's stops in display order, as `id` or `id:kind` for start/end. */
function layout(days: Day[], stops: Stop[]) {
  return Object.fromEntries(
    [...days]
      .sort((a, b) => comparePositions(a.position, b.position))
      .map((d) => [
        d.id,
        stops
          .filter((s) => s.day_id === d.id)
          .sort(
            (a, b) =>
              rank(a) - rank(b) || comparePositions(a.position, b.position),
          )
          .map((s) => (s.kind === 'waypoint' ? s.id : `${s.id}:${s.kind}`)),
      ]),
  )
}

/** The stops with `changes` applied. */
function withChanges(stops: Stop[], changes: StopChange[]) {
  return stops.map((s) => {
    const change = changes.find((c) => c.id === s.id)
    return change ? { ...s, ...change } : s
  })
}

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
      makeStop('end', 'a2', 'end', 'd2'),
    ],
    rest: [],
  }
  const stopsOnDay = (dayId: string) => byDay[dayId] ?? []
  const [start, a] = byDay.d1

  it('takes the place of the stop it is dropped on within its day', () => {
    const target = { type: 'stop', dayId: 'd1', after: false } as const
    expect(dropPlacement(stopsOnDay, a, { ...target, stopId: 'b' })).toEqual({
      type: 'day',
      dayId: 'd1',
      index: 2,
    })
    // Above the start, to become the start.
    expect(
      dropPlacement(stopsOnDay, a, { ...target, stopId: 'start' }),
    ).toEqual({ type: 'day', dayId: 'd1', index: 0 })
  })

  it('moves the start and end like any other stop', () => {
    expect(
      dropPlacement(stopsOnDay, start, {
        type: 'stop',
        dayId: 'd1',
        stopId: 'a',
        after: false,
      }),
    ).toEqual({ type: 'day', dayId: 'd1', index: 1 })
    expect(
      dropPlacement(stopsOnDay, byDay.d2[2], { type: 'day', dayId: 'd1' }),
    ).toEqual({ type: 'day', dayId: 'd1', index: 3 })
  })

  it('goes before or after the stop it is dropped on, on another day', () => {
    const target = { type: 'stop', dayId: 'd2', stopId: 'd' } as const
    expect(dropPlacement(stopsOnDay, a, { ...target, after: false })).toEqual({
      type: 'day',
      dayId: 'd2',
      index: 1,
    })
    expect(dropPlacement(stopsOnDay, a, { ...target, after: true })).toEqual({
      type: 'day',
      dayId: 'd2',
      index: 2,
    })
    // After the end, to become the end.
    expect(
      dropPlacement(stopsOnDay, a, { ...target, stopId: 'end', after: true }),
    ).toEqual({ type: 'day', dayId: 'd2', index: 3 })
  })

  it('goes at the end of a day dropped on outside its stops, before the end', () => {
    expect(dropPlacement(stopsOnDay, a, { type: 'day', dayId: 'd2' })).toEqual({
      type: 'day',
      dayId: 'd2',
      index: 2,
    })
    expect(
      dropPlacement(stopsOnDay, a, { type: 'day', dayId: 'rest' }),
    ).toEqual({ type: 'day', dayId: 'rest', index: 0 })
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
  })
})

describe('planMove', () => {
  const days = [makeDay('d1', 'a0'), makeDay('d2', 'a1')]
  const stops = [
    makeStop('start', 'a0', 'start', 'd1'),
    makeStop('a', 'a1', 'waypoint', 'd1'),
    makeStop('b', 'a2', 'waypoint', 'd1'),
    makeStop('c', 'a0', 'waypoint', 'd2'),
    makeStop('end', 'a1', 'end', 'd2'),
  ]
  const byId = (id: string) => stops.find((s) => s.id === id)!

  function plan(
    id: string,
    placement: Placement,
    trip: { days?: Day[]; stops?: Stop[] } = {},
  ) {
    const all = trip.stops ?? stops
    return planMove(
      trip.days ?? days,
      all,
      all.find((s) => s.id === id)!,
      placement,
      'd3',
    )
  }

  /** The layout after moving `id`, or the error. */
  function after(
    id: string,
    placement: Placement,
    trip: { days?: Day[]; stops?: Stop[] } = {},
  ) {
    const result = plan(id, placement, trip)
    if (!result || 'error' in result) return result
    const allDays = [
      ...(trip.days ?? days),
      ...(result.newDay ? [result.newDay] : []),
    ]
    return layout(allDays, withChanges(trip.stops ?? stops, result.changes))
  }

  it('reorders waypoints, changing only the moved stop', () => {
    const result = plan('b', { type: 'day', dayId: 'd1', index: 1 })
    expect(result).toMatchObject({ newDay: null })
    expect((result as MovePlan).changes.map((c) => c.id)).toEqual(['b'])
    expect(after('b', { type: 'day', dayId: 'd1', index: 1 })).toEqual({
      d1: ['start:start', 'b', 'a'],
      d2: ['c', 'end:end'],
    })
  })

  it('makes a waypoint dropped above the start the new start', () => {
    expect(after('a', { type: 'day', dayId: 'd1', index: 0 })).toEqual({
      d1: ['a:start', 'start', 'b'],
      d2: ['c', 'end:end'],
    })
    expect(after('c', { type: 'day', dayId: 'd1', index: 0 })).toEqual({
      d1: ['c:start', 'start', 'a', 'b'],
      d2: ['end:end'],
    })
  })

  it('hands the start to the next stop when the start is dragged down', () => {
    expect(after('start', { type: 'day', dayId: 'd1', index: 2 })).toEqual({
      d1: ['a:start', 'b', 'start'],
      d2: ['c', 'end:end'],
    })
    expect(after('start', { type: 'day', dayId: 'd2', index: 0 })).toEqual({
      d1: ['a:start', 'b'],
      d2: ['start', 'c', 'end:end'],
    })
  })

  it('makes a stop dropped after the end the new end', () => {
    expect(after('a', { type: 'day', dayId: 'd2', index: 2 })).toEqual({
      d1: ['start:start', 'b'],
      d2: ['c', 'end', 'a:end'],
    })
  })

  it('hands the end to the stop before it when the end is dragged away', () => {
    expect(after('end', { type: 'day', dayId: 'd1', index: 1 })).toEqual({
      d1: ['start:start', 'end', 'a', 'b'],
      d2: ['c:end'],
    })
  })

  it('moves both roles when the start becomes the end', () => {
    expect(after('start', { type: 'day', dayId: 'd2', index: 2 })).toEqual({
      d1: ['a:start', 'b'],
      d2: ['c', 'end', 'start:end'],
    })
  })

  it('swaps the start and end of a one-day trip', () => {
    const oneDay = [
      makeStop('start', 'a0', 'start'),
      makeStop('end', 'a1', 'end'),
    ]
    expect(
      after(
        'end',
        { type: 'day', dayId: 'd1', index: 0 },
        { days: [days[0]], stops: oneDay },
      ),
    ).toEqual({ d1: ['end:start', 'start:end'] })
  })

  it('refuses a move that leaves the first or last day with nothing to hold the role', () => {
    const sparse = [
      makeStop('start', 'a0', 'start', 'd1'),
      makeStop('c', 'a0', 'waypoint', 'd2'),
      makeStop('end', 'a1', 'end', 'd2'),
    ]
    expect(
      plan('start', { type: 'day', dayId: 'd2', index: 1 }, { stops: sparse }),
    ).toEqual({ error: expect.stringMatching(/Day 1/) })
    expect(plan('start', { type: 'newDay' }, { stops: sparse })).toEqual({
      error: expect.stringMatching(/Day 1/),
    })

    const lonelyEnd = [
      makeStop('start', 'a0', 'start', 'd1'),
      makeStop('end', 'a0', 'end', 'd2'),
    ]
    expect(
      plan('end', { type: 'day', dayId: 'd1', index: 0 }, { stops: lonelyEnd }),
    ).toEqual({ error: expect.stringMatching(/last day/) })
  })

  it("doesn't give the trip a start or end it doesn't have", () => {
    const noEnd = stops.filter((s) => s.kind !== 'end')
    expect(
      after('a', { type: 'day', dayId: 'd2', index: 1 }, { stops: noEnd }),
    ).toEqual({ d1: ['start:start', 'b'], d2: ['c', 'a'] })
  })

  it('brings the end along to a new day after the last', () => {
    const result = plan('a', { type: 'newDay' }) as MovePlan
    expect(result.newDay).toMatchObject({ id: 'd3', trip_id: 't1' })
    expect(comparePositions(result.newDay!.position, 'a1')).toBeGreaterThan(0)
    expect(after('a', { type: 'newDay' })).toEqual({
      d1: ['start:start', 'b'],
      d2: ['c'],
      d3: ['a', 'end:end'],
    })
    expect(after('end', { type: 'newDay' })).toEqual({
      d1: ['start:start', 'a', 'b'],
      d2: ['c'],
      d3: ['end:end'],
    })
    expect(after('start', { type: 'newDay' })).toEqual({
      d1: ['a:start', 'b'],
      d2: ['c'],
      d3: ['start', 'end:end'],
    })
  })

  it('keeps display order when start and end keys are out of order', () => {
    // Start and end are listed first and last whatever their keys.
    const messy = [
      makeStop('start', 'Zz', 'start'),
      makeStop('a', 'a0'),
      makeStop('b', 'a1'),
      makeStop('end', 'a0', 'end'),
    ]
    const trip = { days: [days[0]], stops: messy }
    expect(after('a', { type: 'day', dayId: 'd1', index: 0 }, trip)).toEqual({
      d1: ['a:start', 'start', 'b', 'end:end'],
    })
    expect(after('end', { type: 'day', dayId: 'd1', index: 1 }, trip)).toEqual({
      d1: ['start:start', 'end', 'a', 'b:end'],
    })
    // Positions must also sort that way once kinds no longer force it.
    const result = plan('b', { type: 'day', dayId: 'd1', index: 0 }, trip)
    const moved = withChanges(messy, (result as MovePlan).changes)
    const order = (ids: string[]) =>
      ids.map((id) => moved.find((s) => s.id === id)!.position)
    const keys = order(['b', 'start', 'a'])
    expect([...keys].sort(comparePositions)).toEqual(keys)
  })

  it("doesn't bound a waypoint's key by an out-of-order start or end", () => {
    // Saved by older versions: the start's key sorts after the waypoints'
    // and the end's before them.
    const messy = [
      makeStop('start', 'Zz', 'start'),
      makeStop('a', 'a0'),
      makeStop('b', 'a1'),
      makeStop('c', 'a2'),
      makeStop('end', 'Zy', 'end'),
    ]
    const trip = { days: [days[0]], stops: messy }
    expect(after('c', { type: 'day', dayId: 'd1', index: 1 }, trip)).toEqual({
      d1: ['start:start', 'c', 'a', 'b', 'end:end'],
    })
    expect(after('a', { type: 'day', dayId: 'd1', index: 3 }, trip)).toEqual({
      d1: ['start:start', 'b', 'c', 'a', 'end:end'],
    })
    // The keys alone sort the waypoints right, whatever the roles.
    const result = plan('c', { type: 'day', dayId: 'd1', index: 1 }, trip)
    const c = withChanges(messy, (result as MovePlan).changes)[3]
    expect(comparePositions(c.position, 'a0')).toBeLessThan(0)
  })

  it('returns null when nothing changes', () => {
    expect(plan('a', { type: 'day', dayId: 'd1', index: 1 })).toBeNull()
    expect(plan('a', { type: 'day', dayId: 'nope', index: 0 })).toBeNull()
  })

  it('only writes the fields that change, keeping keys that still fit', () => {
    const result = plan('a', { type: 'day', dayId: 'd1', index: 0 }) as MovePlan
    // The new start gets a key before everything else on Day 1; the old
    // start's key already fits before the next waypoint, so only its kind
    // changes.
    expect(result.changes).toEqual([
      { id: 'a', kind: 'start', position: expect.any(String) },
      { id: 'start', kind: 'waypoint' },
    ])
    const start = result.changes[0].position!
    expect(comparePositions(start, byId('start').position)).toBeLessThan(0)
  })
})

describe('applyMove', () => {
  const days = [makeDay('d1', 'a0'), makeDay('d2', 'a1')]
  const stops = [
    makeStop('start', 'a0', 'start', 'd1'),
    { ...makeStop('a', 'a1', 'waypoint', 'd1'), skipped: true },
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
    plan,
    insertFails = false,
    saveFails = false,
    deleteFails = false,
    isLatest = () => true,
  }: {
    plan: MovePlan
    insertFails?: boolean
    saveFails?: boolean
    deleteFails?: boolean
    isLatest?: (stopId: string) => boolean
  }) {
    let state = ready
    const insertDay = vi.fn(
      async (day: Pick<Day, 'id' | 'trip_id' | 'position'>) =>
        insertFails
          ? { data: null, error: { message: 'insert denied' } }
          : { data: makeDay(day.id, day.position), error: null },
    )
    const save = vi.fn(async (changes: StopChange[]) =>
      saveFails
        ? { data: null, error: { message: 'save denied' } }
        : {
            data: withChanges(stops, changes)
              .filter((s) => changes.some((c) => c.id === s.id))
              .map((s) => ({
                ...s,
                skipped: s.skipped && s.kind === 'waypoint',
                updated_at: '2026-11-25T00:01:00Z',
              })),
            error: null,
          },
    )
    const deleteDay = vi.fn(async () =>
      deleteFails ? { error: { message: 'delete denied' } } : { error: null },
    )
    const run = () =>
      applyMove(plan, {
        stops,
        dispatch: (action) => {
          state = tripReducer(state, action)
        },
        insertDay,
        deleteDay,
        save,
        isLatest,
      })
    const current = () => state as Extract<TripState, { status: 'ready' }>
    const stop = (id: string) => current().stops.find((s) => s.id === id)
    return { run, current, stop, insertDay, save, deleteDay }
  }

  const promote: MovePlan = {
    newDay: null,
    changes: [
      { id: 'a', position: 'Zz', kind: 'start' },
      { id: 'start', kind: 'waypoint' },
    ],
  }
  const toNewDay: MovePlan = {
    newDay: makeDay('d3', 'a2'),
    changes: [
      { id: 'a', day_id: 'd3', position: 'a0' },
      { id: 'end', day_id: 'd3', position: 'a1' },
    ],
  }

  it('shows the move at once, saves every change in one request, then applies the saved rows', async () => {
    const { run, stop, save } = setup({ plan: promote })
    const done = run()
    // A new start can't be skipped.
    expect(stop('a')).toMatchObject({ kind: 'start', skipped: false })
    expect(stop('start')?.kind).toBe('waypoint')

    expect(await done).toBeNull()
    expect(save).toHaveBeenCalledExactlyOnceWith(promote.changes)
    expect(stop('a')?.updated_at).toBe('2026-11-25T00:01:00Z')
  })

  it('rolls every stop back when the save fails', async () => {
    const { run, current, save } = setup({ plan: promote, saveFails: true })
    expect(await run()).toBe('save denied')
    expect(save).toHaveBeenCalledOnce()
    expect(current().stops).toEqual(stops)
  })

  it('rolls back when the save throws', async () => {
    let state = ready
    const error = await applyMove(promote, {
      stops,
      dispatch: (action) => {
        state = tripReducer(state, action)
      },
      insertDay: vi.fn(),
      deleteDay: vi.fn(),
      save: async () => {
        throw new Error('offline')
      },
      isLatest: () => true,
    })
    expect(error).toBe('offline')
    expect((state as Extract<TripState, { status: 'ready' }>).stops).toEqual(
      stops,
    )
  })

  it("doesn't roll back over a newer move of the same stop", async () => {
    const { run, stop } = setup({
      plan: promote,
      saveFails: true,
      isLatest: (id) => id !== 'a',
    })
    await run()
    expect(stop('a')?.kind).toBe('start')
    expect(stop('start')?.kind).toBe('start')
  })

  it('creates the new day, then moves the stops into it', async () => {
    const { run, current, stop, insertDay, save } = setup({ plan: toNewDay })
    const done = run()
    expect(current().days).toHaveLength(3)
    expect(stop('a')?.day_id).toBe('d3')

    expect(await done).toBeNull()
    expect(insertDay).toHaveBeenCalledExactlyOnceWith({
      id: 'd3',
      trip_id: 't1',
      position: 'a2',
    })
    expect(save).toHaveBeenCalledExactlyOnceWith(toNewDay.changes)
    expect(current().days.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(stop('end')?.day_id).toBe('d3')
  })

  it('rolls everything back if the day cannot be created', async () => {
    const { run, current, save } = setup({ plan: toNewDay, insertFails: true })
    expect(await run()).toBe('insert denied')
    expect(current().days).toEqual(days)
    expect(current().stops).toEqual(stops)
    expect(save).not.toHaveBeenCalled()
  })

  it('deletes the new day again if the stops cannot move into it', async () => {
    const { run, current, deleteDay } = setup({
      plan: toNewDay,
      saveFails: true,
    })
    expect(await run()).toBe('save denied')
    expect(deleteDay).toHaveBeenCalledExactlyOnceWith('d3')
    expect(current().days).toEqual(days)
    expect(current().stops).toEqual(stops)
  })

  it('keeps the new day if it cannot be deleted', async () => {
    const { run, current, stop } = setup({
      plan: toNewDay,
      saveFails: true,
      deleteFails: true,
    })
    expect(await run()).toBe('save denied')
    expect(current().days.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(stop('a')?.day_id).toBe('d1')
    expect(stop('end')?.day_id).toBe('d2')
  })
})
