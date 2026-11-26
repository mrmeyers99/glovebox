// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme } from '../theme/theme'
import { useDayPalette } from './useDayPalette'

// jsdom doesn't resolve var() or light-dark(), so stand in for the browser:
// each day token resolves to a colour that depends on the current theme.
let resolved: Record<string, string>

beforeEach(() => {
  resolved = { 'var(--day-color-1)': 'rgb(1, 1, 1)' }
  window.matchMedia = vi.fn().mockReturnValue({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (el) =>
      ({
        color: resolved[(el as HTMLElement).style.color] ?? '',
      }) as CSSStyleDeclaration,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
})

describe('useDayPalette', () => {
  it('resolves each day colour through a probe element, then removes it', () => {
    const { result } = renderHook(() => useDayPalette())
    expect(result.current).toHaveLength(8)
    expect(result.current[0]).toBe('rgb(1, 1, 1)')
    expect(document.querySelector('html > span')).toBeNull()
  })

  it('re-reads the colours when the theme changes, until unmounted', () => {
    const { result, unmount } = renderHook(() => useDayPalette())

    resolved['var(--day-color-1)'] = 'rgb(2, 2, 2)'
    act(() => applyTheme('atlas'))
    expect(result.current[0]).toBe('rgb(2, 2, 2)')

    unmount()
    resolved['var(--day-color-1)'] = 'rgb(3, 3, 3)'
    applyTheme('park')
    expect(result.current[0]).toBe('rgb(2, 2, 2)')
  })
})
