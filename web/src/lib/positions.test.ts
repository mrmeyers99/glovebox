import { describe, expect, it } from 'vitest'
import {
  positionAtEnd,
  positionAtStart,
  positionBetween,
  positionsBetween,
} from './positions'
import { comparePositions } from './tripMath'

const sorted = (keys: string[]) => [...keys].sort(comparePositions)

describe('position keys', () => {
  it("treats Day 1's 'a0' as a valid starting key", () => {
    expect(positionAtEnd([])).toBe('a0')
    expect(positionBetween(null, null)).toBe('a0')
    const after = positionBetween('a0', null)
    const before = positionBetween(null, 'a0')
    expect(sorted([after, 'a0', before])).toEqual([before, 'a0', after])
  })

  it('sorts byte-wise, with upper case before lower case', () => {
    // Keys before 'a0' start with upper-case letters ('Zz'); a locale-aware
    // sort would put them after 'a0'.
    const keys = ['a0']
    for (let i = 0; i < 30; i++) keys.unshift(positionAtStart(keys))
    for (let i = 0; i < 30; i++) keys.push(positionAtEnd(keys))
    expect(keys.some((k) => /^[A-Z]/.test(k))).toBe(true)
    expect(keys.some((k) => /^[a-z]/.test(k))).toBe(true)
    expect(sorted([...keys].reverse())).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps working when inserting repeatedly between the same two keys', () => {
    // Always insert right after 'a0', then always right before 'a1'.
    for (const side of ['after-low', 'before-high'] as const) {
      let low = 'a0'
      let high = 'a1'
      for (let i = 0; i < 500; i++) {
        const key = positionBetween(low, high)
        expect(comparePositions(low, key)).toBeLessThan(0)
        expect(comparePositions(key, high)).toBeLessThan(0)
        if (side === 'after-low') high = key
        else low = key
      }
    }
  })

  it('generates n ascending keys between two keys', () => {
    const keys = positionsBetween('a0', 'a1', 5)
    expect(keys).toHaveLength(5)
    expect(sorted(['a1', ...keys, 'a0'])).toEqual(['a0', ...keys, 'a1'])
    expect(positionsBetween(null, null, 3)).toEqual(['a0', 'a1', 'a2'])
  })

  it('finds the ends of an unsorted list', () => {
    const existing = ['a1', 'Zz', 'a0', 'a2']
    expect(comparePositions(positionAtEnd(existing), 'a2')).toBeGreaterThan(0)
    expect(comparePositions(positionAtStart(existing), 'Zz')).toBeLessThan(0)
  })

  it('rejects bounds that are equal or out of order', () => {
    expect(() => positionBetween('a1', 'a1')).toThrow()
    expect(() => positionBetween('a1', 'a0')).toThrow()
    expect(() => positionsBetween('a1', 'a0', 2)).toThrow()
  })
})
