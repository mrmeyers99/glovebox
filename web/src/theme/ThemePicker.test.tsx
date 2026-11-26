// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SCHEME_STORAGE_KEY, THEME_STORAGE_KEY } from './theme'
import { ThemePicker } from './ThemePicker'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.scheme
})

const select = (label: string) =>
  screen.getByLabelText<HTMLSelectElement>(label)

describe('ThemePicker', () => {
  it('shows the saved choices', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'park')
    localStorage.setItem(SCHEME_STORAGE_KEY, 'dark')
    render(<ThemePicker />)
    expect(select('Theme').value).toBe('park')
    expect(select('Mode').value).toBe('dark')
    expect(Array.from(select('Theme').options, (o) => o.textContent)).toEqual([
      'Classic',
      'Road atlas',
      'Highway sign',
      'Park poster',
      'Motel postcard',
    ])
    expect(Array.from(select('Mode').options, (o) => o.textContent)).toEqual([
      'Auto',
      'Light',
      'Dark',
    ])
  })

  it('applies and remembers a new theme', () => {
    render(<ThemePicker />)
    fireEvent.change(select('Theme'), { target: { value: 'motel' } })
    expect(select('Theme').value).toBe('motel')
    expect(document.documentElement.dataset.theme).toBe('motel')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('motel')
  })

  it('applies and remembers a new mode', () => {
    render(<ThemePicker />)
    expect(select('Mode').value).toBe('auto')
    fireEvent.change(select('Mode'), { target: { value: 'light' } })
    expect(select('Mode').value).toBe('light')
    expect(document.documentElement.dataset.scheme).toBe('light')
    expect(localStorage.getItem(SCHEME_STORAGE_KEY)).toBe('light')
  })
})
