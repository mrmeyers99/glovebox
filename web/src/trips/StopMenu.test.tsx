// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Stop } from '../lib/database.types'
import { StopMenu } from './StopMenu'

afterEach(cleanup)

const makeStop = (overrides: Partial<Stop> = {}): Stop => ({
  id: 's1',
  trip_id: 't1',
  day_id: 'd1',
  position: 'a0',
  kind: 'waypoint',
  name: 'Diner',
  lat: 0,
  lng: 0,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  updated_by: null,
  created_at: '',
  updated_at: '',
  ...overrides,
})

const days = [
  { dayId: 'd1', dayNumber: 1 },
  { dayId: 'd2', dayNumber: 2 },
]

function renderMenu({
  stop = makeStop(),
  canEdit = true,
}: { stop?: Stop; canEdit?: boolean } = {}) {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  const props = {
    onMoveToDay: vi.fn(),
    onSetSkipped: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  }
  render(
    <StopMenu
      stop={stop}
      anchor={{ x: 10, y: 20, returnFocus: trigger }}
      canEdit={canEdit}
      days={days}
      {...props}
    />,
  )
  const menu = screen.getByRole('menu')
  const items = () =>
    screen.getAllByRole('menuitem').map((item) => item.textContent)
  const focused = () => document.activeElement?.textContent
  return { ...props, menu, items, focused, trigger }
}

describe('StopMenu', () => {
  it('lists the actions for a waypoint and focuses the first', () => {
    const { menu, items, focused } = renderMenu()
    expect(menu.getAttribute('aria-label')).toBe('Diner actions')
    expect(items()).toEqual(['Move to day…', 'Skip', 'Edit', 'Delete…'])
    expect(focused()).toBe('Move to day…')
  })

  it('offers only View details to viewers', () => {
    const { items, onOpen, onClose } = renderMenu({ canEdit: false })
    expect(items()).toEqual(['View details'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'View details' }))
    expect(onClose).toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalled()
  })

  it('skips, unskips, edits and deletes, closing first', () => {
    const first = renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Skip' }))
    expect(first.onClose).toHaveBeenCalled()
    expect(first.onSetSkipped).toHaveBeenCalledWith(true)
    expect(document.activeElement).toBe(first.trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(first.onOpen).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
    expect(first.onDelete).toHaveBeenCalled()
    cleanup()

    const skipped = renderMenu({ stop: makeStop({ skipped: true }) })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unskip' }))
    expect(skipped.onSetSkipped).toHaveBeenCalledWith(false)
  })

  it('moves focus with the arrow, Home and End keys', () => {
    const { menu, focused } = renderMenu()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('Skip')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(focused()).toBe('Delete…')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('Move to day…')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(focused()).toBe('Delete…')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(focused()).toBe('Move to day…')
    // Other keys do nothing.
    fireEvent.keyDown(menu, { key: 'a' })
    fireEvent.keyDown(menu, { key: 'ArrowLeft' })
    expect(focused()).toBe('Move to day…')
  })

  it('lists the days to move to, with the current one disabled', () => {
    const { menu, items, focused, onMoveToDay } = renderMenu()
    fireEvent.keyDown(menu, { key: 'ArrowRight' })
    expect(menu.getAttribute('aria-label')).toBe('Move Diner to day')
    expect(items()).toEqual([
      '‹ Back',
      'Day 1 (current)',
      'Day 2',
      'New day at end (Day 3)',
    ])
    // Focus starts on the first day it can move to.
    expect(focused()).toBe('Day 2')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Day 1 (current)' }))
    expect(onMoveToDay).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Day 2' }))
    expect(onMoveToDay).toHaveBeenCalledWith('d2')
    fireEvent.click(screen.getByRole('menuitem', { name: /New day/ }))
    expect(onMoveToDay).toHaveBeenCalledWith(null)
  })

  it('goes back from the days with Back, Left or Escape', () => {
    const { menu, items, focused, onClose } = renderMenu()
    const openDays = () =>
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move to day…' }))

    openDays()
    fireEvent.click(screen.getByRole('menuitem', { name: '‹ Back' }))
    expect(items()[0]).toBe('Move to day…')
    expect(focused()).toBe('Move to day…')

    openDays()
    fireEvent.keyDown(menu, { key: 'ArrowLeft' })
    expect(items()[0]).toBe('Move to day…')

    openDays()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(items()[0]).toBe('Move to day…')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape or Tab, returning focus', () => {
    const { menu, onClose, trigger } = renderMenu()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on a press or scroll outside, or when the window changes', () => {
    const { menu, onClose } = renderMenu()
    fireEvent.pointerDown(menu.firstElementChild!)
    fireEvent.scroll(menu)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(document.body)
    fireEvent.scroll(document)
    fireEvent(window, new Event('resize'))
    fireEvent(window, new Event('blur'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it("keeps the browser's own menu from opening over it", () => {
    const { menu } = renderMenu()
    expect(fireEvent.contextMenu(menu)).toBe(false)
  })
})
