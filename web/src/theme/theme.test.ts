// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  DEFAULT_THEME,
  isThemeId,
  loadTheme,
  setTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from './theme'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
})

describe('isThemeId', () => {
  it('accepts known themes only', () => {
    expect(isThemeId('atlas')).toBe(true)
    expect(isThemeId('neon')).toBe(false)
    expect(isThemeId(null)).toBe(false)
  })
})

describe('loadTheme', () => {
  it('defaults when nothing is saved', () => {
    expect(loadTheme()).toBe(DEFAULT_THEME)
  })

  it('returns the saved theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'motel')
    expect(loadTheme()).toBe('motel')
  })

  it('ignores an unknown saved value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(loadTheme()).toBe(DEFAULT_THEME)
  })

  it('defaults when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadTheme()).toBe(DEFAULT_THEME)
  })
})

describe('applyTheme', () => {
  it('sets data-theme and announces the change', () => {
    const listener = vi.fn()
    window.addEventListener(THEME_CHANGE_EVENT, listener)
    applyTheme('park')
    window.removeEventListener(THEME_CHANGE_EVENT, listener)
    expect(document.documentElement.dataset.theme).toBe('park')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('setTheme', () => {
  it('applies and saves the theme', () => {
    setTheme('sign')
    expect(document.documentElement.dataset.theme).toBe('sign')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('sign')
  })

  it('still applies when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    setTheme('atlas')
    expect(document.documentElement.dataset.theme).toBe('atlas')
  })
})
