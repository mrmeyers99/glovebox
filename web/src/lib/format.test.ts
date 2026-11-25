import { describe, expect, it } from 'vitest'
import {
  formatDayDate,
  formatDuration,
  formatMiles,
  formatMoney,
  formatTimeOfDay,
} from './format'

describe('formatMiles', () => {
  it('rounds to whole miles with separators', () => {
    expect(formatMiles(0)).toBe('0 mi')
    expect(formatMiles(12.4)).toBe('12 mi')
    expect(formatMiles(12.5)).toBe('13 mi')
    expect(formatMiles(1234.2)).toBe('1,234 mi')
  })
})

describe('formatDuration', () => {
  it('shows hours and minutes', () => {
    expect(formatDuration(5 * 3600 + 20 * 60)).toBe('5h 20m')
    expect(formatDuration(2 * 3600)).toBe('2h 0m')
  })

  it('shows minutes only under an hour', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(45 * 60)).toBe('45m')
  })

  it('rounds to the nearest minute, carrying into hours', () => {
    expect(formatDuration(89)).toBe('1m')
    expect(formatDuration(3599)).toBe('1h 0m')
  })
})

describe('formatMoney', () => {
  it('formats US dollars to cents', () => {
    expect(formatMoney(0)).toBe('$0.00')
    expect(formatMoney(12.5)).toBe('$12.50')
    expect(formatMoney(1234.567)).toBe('$1,234.57')
  })
})

describe('formatDayDate', () => {
  it('formats without shifting across time zones', () => {
    expect(formatDayDate('2026-07-04')).toBe('Sat, Jul 4')
    expect(formatDayDate('2027-01-01')).toBe('Fri, Jan 1')
  })
})

describe('formatTimeOfDay', () => {
  it('formats Postgres times as 12-hour clock', () => {
    expect(formatTimeOfDay('00:05:00')).toBe('12:05 AM')
    expect(formatTimeOfDay('09:30')).toBe('9:30 AM')
    expect(formatTimeOfDay('12:00:00')).toBe('12:00 PM')
    expect(formatTimeOfDay('14:30:00')).toBe('2:30 PM')
  })

  it('passes through unparseable values', () => {
    expect(formatTimeOfDay('soon')).toBe('soon')
  })
})
