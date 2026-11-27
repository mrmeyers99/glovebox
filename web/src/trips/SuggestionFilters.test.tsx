// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTER, type SuggestionFilter } from '../lib/suggestionFilters'
import { SuggestionFilters } from './SuggestionFilters'

afterEach(cleanup)

const renderPanel = (filter: SuggestionFilter = DEFAULT_FILTER) => {
  const onChange = vi.fn()
  render(
    <SuggestionFilters
      filter={filter}
      onChange={onChange}
      shown={3}
      total={10}
    />,
  )
  return onChange
}

describe('SuggestionFilters', () => {
  it('shows the default filter without a count', () => {
    renderPanel()
    expect(screen.getByText('Filter suggestions').textContent).toBe(
      'Filter suggestions',
    )
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Museums' })
        .checked,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Distance from route',
      }).value,
    ).toBe('null')
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Top picks only' })
        .checked,
    ).toBe(false)
  })

  it('shows how many places pass while filtering', () => {
    renderPanel({ ...DEFAULT_FILTER, topPicksOnly: true })
    expect(screen.getByText('(3 of 10)')).toBeTruthy()
  })

  it('turns a category off and on, keeping panel order', () => {
    const onChange = renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Parks & nature' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTER,
      categories: [
        'museums',
        'roadside',
        'historic',
        'entertainment',
        'viewpoints',
      ],
    })
    cleanup()
    const again = renderPanel({
      ...DEFAULT_FILTER,
      categories: ['viewpoints'],
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Museums' }))
    expect(again).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTER,
      categories: ['museums', 'viewpoints'],
    })
  })

  it('sets the maximum distance', () => {
    const onChange = renderPanel()
    const select = screen.getByRole('combobox', { name: 'Distance from route' })
    fireEvent.change(select, { target: { value: '15' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTER,
      maxDistanceKm: 15,
    })
    fireEvent.change(select, { target: { value: 'null' } })
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_FILTER)
  })

  it('toggles top picks only', () => {
    const onChange = renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Top picks only' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTER,
      topPicksOnly: true,
    })
  })
})
