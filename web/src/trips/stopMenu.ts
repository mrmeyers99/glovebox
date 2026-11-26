// The stop menu: which actions a stop offers, where the menu goes on screen,
// and keyboard movement between its items. Used by the day list now and the
// map markers later.

import type { Stop } from '../lib/database.types'

/** Where a stop menu opens, in viewport coordinates. */
export type MenuAnchor = {
  x: number
  y: number
  /** Gets focus back when the menu closes (e.g. the "⋯" button). */
  returnFocus?: HTMLElement | null
}

export type StopMenuAction =
  | 'move'
  | 'skip'
  | 'unskip'
  | 'edit'
  | 'delete'
  | 'view'

/**
 * The actions `stop`'s menu offers, in order. Viewers can only view details.
 * The start and end can be moved like any stop (handing their role over),
 * but not skipped or deleted.
 */
export function stopMenuActions(
  stop: Pick<Stop, 'kind' | 'skipped'>,
  canEdit: boolean,
): StopMenuAction[] {
  if (!canEdit) return ['view']
  if (stop.kind !== 'waypoint') return ['move', 'edit']
  return ['move', stop.skipped ? 'unskip' : 'skip', 'edit', 'delete']
}

export const STOP_MENU_LABELS: Record<StopMenuAction, string> = {
  move: 'Move to day…',
  skip: 'Skip',
  unskip: 'Unskip',
  edit: 'Edit',
  delete: 'Delete…',
  view: 'View details',
}

type Size = { width: number; height: number }

/** Gap between the menu and the viewport's edges. */
const EDGE = 8

/**
 * The menu's top-left corner: at `anchor`, but flipped to the other side of
 * it if it would run off the right or bottom of `viewport`, and kept inside
 * the viewport.
 */
export function menuPosition(
  anchor: { x: number; y: number },
  menu: Size,
  viewport: Size,
): { left: number; top: number } {
  const place = (at: number, size: number, max: number) => {
    const flipped = at + size > max - EDGE ? at - size : at
    return Math.max(EDGE, Math.min(flipped, max - EDGE - size))
  }
  return {
    left: place(anchor.x, menu.width, viewport.width),
    top: place(anchor.y, menu.height, viewport.height),
  }
}

/**
 * The item to focus after pressing `key` on item `current` of `count`
 * (wrapping around), or null if the key doesn't move focus.
 */
export function menuFocusIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
