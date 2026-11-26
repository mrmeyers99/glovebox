// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme } from '../theme/theme'
import { useDayPalette } from './useDayPalette'

const root = document.documentElement.style

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  root.setProperty('--day-color-1', '#111111')
})

afterEach(() => {
  cleanup()
  root.removeProperty('--day-color-1')
  delete document.documentElement.dataset.theme
})

describe('useDayPalette', () => {
  it('re-reads the day colours when the theme changes', () => {
    const { result, unmount } = renderHook(() => useDayPalette())
    expect(result.current[0]).toBe('#111111')

    root.setProperty('--day-color-1', '#222222')
    act(() => applyTheme('atlas'))
    expect(result.current[0]).toBe('#222222')

    unmount()
    root.setProperty('--day-color-1', '#333333')
    applyTheme('park')
    expect(result.current[0]).toBe('#222222')
  })
})
