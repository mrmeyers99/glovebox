import { describe, expect, it } from 'vitest'
import {
  indexPresence,
  initials,
  listNames,
  parsePayload,
  peersFromState,
  presenceColor,
  PRESENCE_COLOR_COUNT,
} from './presence'

describe('presenceColor', () => {
  it('is stable and within the palette', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `user-${i}`)
    for (const id of ids) {
      const color = presenceColor(id)
      expect(color).toBe(presenceColor(id))
      expect(color).toBeGreaterThanOrEqual(1)
      expect(color).toBeLessThanOrEqual(PRESENCE_COLOR_COUNT)
    }
    // Spreads across the palette rather than collapsing on one colour.
    expect(new Set(ids.map(presenceColor)).size).toBeGreaterThan(1)
  })
})

describe('initials', () => {
  it('takes the first and last words', () => {
    expect(initials('Pat Lee')).toBe('PL')
    expect(initials('  ann  marie  smith ')).toBe('AS')
    expect(initials('Zoe')).toBe('Z')
    expect(initials('')).toBe('?')
  })
})

describe('parsePayload', () => {
  it('accepts a well-formed payload', () => {
    expect(
      parsePayload({
        user_id: 'u1',
        name: 'Pat',
        color: 2,
        focus: { stopId: 's1' },
        presence_ref: 'x',
      }),
    ).toEqual({ user_id: 'u1', name: 'Pat', color: 2, focus: { stopId: 's1' } })
  })

  it('rejects payloads without a user', () => {
    expect(parsePayload(null)).toBeNull()
    expect(parsePayload({ name: 'Pat' })).toBeNull()
    expect(parsePayload({ user_id: 7 })).toBeNull()
  })

  it('fills in a bad name, colour or focus', () => {
    expect(
      parsePayload({ user_id: 'u1', name: ' ', color: 99, focus: { x: 1 } }),
    ).toEqual({
      user_id: 'u1',
      name: 'Unnamed',
      color: presenceColor('u1'),
      focus: null,
    })
  })
})

describe('peersFromState', () => {
  const state = {
    tabA: [{ user_id: 'u2', name: 'Zoe', color: 1, focus: { stopId: 's1' } }],
    tabB: [{ user_id: 'u2', name: 'Zoe', color: 1, focus: { dayId: 'd1' } }],
    tabC: [{ user_id: 'u3', name: 'Ann', color: 3, focus: null }],
    tabD: [{ user_id: 'u1', name: 'Me', color: 4, focus: { stopId: 's2' } }],
    tabE: [{ user_id: 'u2', name: 'Zoe', color: 1, focus: { stopId: 's1' } }],
    junk: [{ hello: 'world' }],
  }

  it('merges tabs, skips yourself and malformed entries, sorts by name', () => {
    expect(peersFromState(state, 'u1')).toEqual([
      { userId: 'u3', name: 'Ann', color: 3, focus: [] },
      {
        userId: 'u2',
        name: 'Zoe',
        color: 1,
        focus: [{ stopId: 's1' }, { dayId: 'd1' }],
      },
    ])
  })

  it('indexes peers by what they are editing', () => {
    const index = indexPresence(peersFromState(state, 'u1'))
    expect([...index.stops.keys()]).toEqual(['s1'])
    expect(index.stops.get('s1')?.map((p) => p.name)).toEqual(['Zoe'])
    expect(index.days.get('d1')?.map((p) => p.name)).toEqual(['Zoe'])
    expect(index.stops.has('s2')).toBe(false)
  })
})

describe('listNames', () => {
  it('joins names', () => {
    expect(listNames([])).toBe('')
    expect(listNames([{ name: 'Pat' }])).toBe('Pat')
    expect(listNames([{ name: 'Pat' }, { name: 'Zoe' }])).toBe('Pat and Zoe')
    expect(listNames([{ name: 'Ann' }, { name: 'Pat' }, { name: 'Zoe' }])).toBe(
      'Ann, Pat and Zoe',
    )
  })
})
