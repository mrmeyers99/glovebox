import { describe, expect, it } from 'vitest'
import { menuFocusIndex, menuPosition, stopMenuActions } from './stopMenu'

describe('stopMenuActions', () => {
  it('offers everything on a waypoint to owners and editors', () => {
    expect(stopMenuActions({ kind: 'waypoint', skipped: false }, true)).toEqual(
      ['move', 'skip', 'edit', 'delete'],
    )
  })

  it('offers Unskip on a skipped waypoint', () => {
    expect(stopMenuActions({ kind: 'waypoint', skipped: true }, true)).toEqual([
      'move',
      'unskip',
      'edit',
      'delete',
    ])
  })

  it("offers Move and Edit on the start and end, which can't be skipped or deleted", () => {
    expect(stopMenuActions({ kind: 'start', skipped: false }, true)).toEqual([
      'move',
      'edit',
    ])
    expect(stopMenuActions({ kind: 'end', skipped: false }, true)).toEqual([
      'move',
      'edit',
    ])
  })

  it('only offers View details to viewers', () => {
    expect(
      stopMenuActions({ kind: 'waypoint', skipped: false }, false),
    ).toEqual(['view'])
    expect(stopMenuActions({ kind: 'end', skipped: false }, false)).toEqual([
      'view',
    ])
  })
})

describe('menuPosition', () => {
  const viewport = { width: 400, height: 800 }
  const menu = { width: 200, height: 150 }

  it('opens at the anchor when there is room', () => {
    expect(menuPosition({ x: 50, y: 100 }, menu, viewport)).toEqual({
      left: 50,
      top: 100,
    })
  })

  it('flips left and up near the right and bottom edges', () => {
    expect(menuPosition({ x: 350, y: 750 }, menu, viewport)).toEqual({
      left: 150,
      top: 600,
    })
  })

  it('stays inside a viewport too small to flip into', () => {
    expect(
      menuPosition({ x: 150, y: 100 }, menu, { width: 250, height: 800 }),
    ).toEqual({ left: 8, top: 100 })
  })
})

describe('menuFocusIndex', () => {
  it('moves down and up, wrapping around', () => {
    expect(menuFocusIndex('ArrowDown', 0, 3)).toBe(1)
    expect(menuFocusIndex('ArrowDown', 2, 3)).toBe(0)
    expect(menuFocusIndex('ArrowUp', 0, 3)).toBe(2)
  })

  it('jumps to the first and last item', () => {
    expect(menuFocusIndex('Home', 2, 3)).toBe(0)
    expect(menuFocusIndex('End', 0, 3)).toBe(2)
  })

  it('ignores other keys and empty menus', () => {
    expect(menuFocusIndex('a', 0, 3)).toBeNull()
    expect(menuFocusIndex('ArrowDown', 0, 0)).toBeNull()
  })
})
