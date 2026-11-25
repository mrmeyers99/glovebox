// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuAnchor } from './stopMenu'
import { LONG_PRESS_MS, useStopMenuTrigger } from './useStopMenuTrigger'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Row({
  open,
  onClick,
}: {
  open?: (anchor: MenuAnchor) => void
  onClick?: () => void
}) {
  const trigger = useStopMenuTrigger(open, {
    returnFocus: () => document.getElementById('more'),
    ignoreSelector: '.handle',
  })
  return (
    <div data-testid="row" onClick={onClick} {...trigger}>
      <span className="handle" data-testid="handle" />
      <button id="more" type="button">
        ⋯
      </button>
    </div>
  )
}

function setup(withOpen = true) {
  const open = vi.fn<(anchor: MenuAnchor) => void>()
  const onClick = vi.fn()
  render(<Row open={withOpen ? open : undefined} onClick={onClick} />)
  return {
    open,
    onClick,
    row: screen.getByTestId('row'),
    handle: screen.getByTestId('handle'),
    more: screen.getByRole('button'),
  }
}

const touch = (x: number, y: number) => ({
  pointerType: 'touch',
  clientX: x,
  clientY: y,
})

describe('useStopMenuTrigger', () => {
  it('opens on right-click at the pointer, instead of the browser menu', () => {
    const { open, row, more } = setup()
    expect(fireEvent.contextMenu(row, { clientX: 30, clientY: 40 })).toBe(false)
    expect(open).toHaveBeenCalledWith({ x: 30, y: 40, returnFocus: more })
  })

  it('opens at the element from the context-menu key', () => {
    const { open, row } = setup()
    row.getBoundingClientRect = () =>
      ({ left: 5, bottom: 15 }) as unknown as DOMRect
    fireEvent.contextMenu(row, { clientX: 0, clientY: 0 })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ x: 5, y: 15 }))
  })

  it('leaves presses on the ignored element alone', () => {
    const { open, handle } = setup()
    fireEvent.contextMenu(handle, { clientX: 30, clientY: 40 })
    fireEvent.pointerDown(handle, touch(30, 40))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing without a menu to open', () => {
    const { row } = setup(false)
    expect(fireEvent.contextMenu(row)).toBe(true)
    fireEvent.pointerDown(row, touch(30, 40))
    vi.advanceTimersByTime(LONG_PRESS_MS)
  })

  it('opens on a long-press just off the finger, and swallows the click', () => {
    const { open, onClick, row, more } = setup()
    fireEvent.pointerDown(row, touch(30, 40))
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(open).toHaveBeenCalledWith({ x: 42, y: 52, returnFocus: more })

    fireEvent.pointerUp(row)
    fireEvent.click(row)
    expect(onClick).not.toHaveBeenCalled()
    // Only that one click.
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('treats a moving touch as a scroll, not a long-press', () => {
    const { open, row } = setup()
    fireEvent.pointerDown(row, touch(30, 40))
    fireEvent.pointerMove(row, touch(33, 44))
    fireEvent.pointerMove(row, touch(30, 60))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(open).not.toHaveBeenCalled()
  })

  it('cancels when the touch ends or is cancelled early', () => {
    const { open, onClick, row } = setup()
    fireEvent.pointerDown(row, touch(30, 40))
    fireEvent.pointerUp(row)
    fireEvent.click(row)
    fireEvent.pointerDown(row, touch(30, 40))
    fireEvent.pointerCancel(row)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(open).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('ignores mouse presses (right-click covers those)', () => {
    const { open, row } = setup()
    fireEvent.pointerDown(row, { pointerType: 'mouse', clientX: 1 })
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(open).not.toHaveBeenCalled()
  })
})
