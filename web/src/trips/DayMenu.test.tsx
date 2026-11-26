// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DayMenu } from './DayMenu'

afterEach(cleanup)

function renderMenu(canDelete = true) {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  const props = {
    onEditNotes: vi.fn(),
    onInsertAfter: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  }
  render(
    <DayMenu
      dayNumber={2}
      anchor={{ x: 10, y: 20, returnFocus: trigger }}
      canDelete={canDelete}
      {...props}
    />,
  )
  const menu = screen.getByRole('menu', { name: 'Day 2 actions' })
  const focused = () => document.activeElement?.textContent
  return { ...props, menu, focused, trigger }
}

const item = (name: string) => screen.getByRole('menuitem', { name })

describe('DayMenu', () => {
  it('lists the actions and focuses the first', () => {
    const { focused } = renderMenu()
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Edit notes…',
      'Insert day after',
      'Delete day…',
    ])
    expect(focused()).toBe('Edit notes…')
  })

  it('runs an action after closing and giving focus back', () => {
    const { onEditNotes, onInsertAfter, onDelete, onClose, trigger } =
      renderMenu()
    fireEvent.click(item('Edit notes…'))
    expect(onClose).toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
    expect(onEditNotes).toHaveBeenCalled()
    fireEvent.click(item('Insert day after'))
    expect(onInsertAfter).toHaveBeenCalled()
    fireEvent.click(item('Delete day…'))
    expect(onDelete).toHaveBeenCalled()
  })

  it("can't delete the only day", () => {
    const { onDelete } = renderMenu(false)
    const del = item('Delete day…')
    expect(del.getAttribute('aria-disabled')).toBe('true')
    expect(del.getAttribute('title')).toMatch(/at least one day/)
    fireEvent.click(del)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('moves focus with the arrow keys and closes on Escape or Tab', () => {
    const { menu, focused, onClose } = renderMenu()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('Insert day after')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(focused()).toBe('Delete day…')
    fireEvent.keyDown(menu, { key: 'x' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on a press outside it', () => {
    const { onClose } = renderMenu()
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Edit notes…' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })
})
