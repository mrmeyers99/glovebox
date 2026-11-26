// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY } from './theme'
import { ThemePicker } from './ThemePicker'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('ThemePicker', () => {
  it('shows the saved theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'park')
    render(<ThemePicker />)
    const select = screen.getByLabelText<HTMLSelectElement>('Theme')
    expect(select.value).toBe('park')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Classic',
      'Road atlas',
      'Highway sign',
      'Park poster',
      'Motel postcard',
    ])
  })

  it('applies and remembers a new choice', () => {
    render(<ThemePicker />)
    const select = screen.getByLabelText<HTMLSelectElement>('Theme')
    fireEvent.change(select, { target: { value: 'motel' } })
    expect(select.value).toBe('motel')
    expect(document.documentElement.dataset.theme).toBe('motel')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('motel')
  })
})
