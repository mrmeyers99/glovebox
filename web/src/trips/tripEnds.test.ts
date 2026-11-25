import { describe, expect, it } from 'vitest'
import { endStopPlacement, lastDay } from './tripEnds'

const days = [
  { id: 'd2', position: 'a1' },
  { id: 'd1', position: 'a0' },
  { id: 'd3', position: 'a2' },
]
const stop = (
  id: string,
  kind: 'start' | 'waypoint' | 'end',
  dayId: string,
  position: string,
) => ({
  id,
  kind,
  day_id: dayId,
  position,
})

describe('lastDay', () => {
  it('is the day with the greatest position, whatever the input order', () => {
    expect(lastDay(days)?.id).toBe('d3')
    expect(lastDay([])).toBeUndefined()
  })

  it('compares keys byte-wise', () => {
    // 'Zz' < 'a0' byte-wise, though localeCompare says otherwise.
    expect(
      lastDay([
        { id: 'lower', position: 'a0' },
        { id: 'upper', position: 'Zz' },
      ])?.id,
    ).toBe('lower')
  })
})

describe('endStopPlacement', () => {
  it('moves the end stop to the last day, after its stops', () => {
    const stops = [
      stop('start', 'start', 'd1', 'a0'),
      stop('end', 'end', 'd2', 'a0'),
      stop('a', 'waypoint', 'd3', 'a5'),
    ]
    const placement = endStopPlacement(days, stops)
    expect(placement?.stop.id).toBe('end')
    expect(placement?.dayId).toBe('d3')
    expect(placement!.position > 'a5').toBe(true)
  })

  it('moves the end stop to an empty last day', () => {
    const stops = [stop('end', 'end', 'd2', 'a3')]
    expect(endStopPlacement(days, stops)).toMatchObject({
      dayId: 'd3',
      position: 'a0',
    })
  })

  it('is null when the end stop is already on the last day', () => {
    expect(endStopPlacement(days, [stop('end', 'end', 'd3', 'a0')])).toBeNull()
  })

  it('is null without an end stop or days', () => {
    expect(
      endStopPlacement(days, [stop('a', 'waypoint', 'd1', 'a0')]),
    ).toBeNull()
    expect(endStopPlacement([], [stop('end', 'end', 'd1', 'a0')])).toBeNull()
  })
})
