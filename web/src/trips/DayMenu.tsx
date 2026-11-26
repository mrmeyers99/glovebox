// A day's actions menu, for owners and editors: Edit notes…, Insert day
// after and Delete day…. Opened from the "⋯" button on the day's header.

import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { menuFocusIndex, type MenuAnchor } from './stopMenu'
import { useMenu } from './useMenu'

type Props = {
  dayNumber: number
  anchor: MenuAnchor
  /** False for the trip's only day, which can't be deleted. */
  canDelete: boolean
  onEditNotes: () => void
  onInsertAfter: () => void
  onDelete: () => void
  onClose: () => void
}

export function DayMenu({
  dayNumber,
  anchor,
  canDelete,
  onEditNotes,
  onInsertAfter,
  onDelete,
  onClose,
}: Props) {
  const { menuRef, itemRefs, focus, setFocus, position, close } = useMenu(
    anchor,
    onClose,
  )

  // Close first, so focus is back on the trigger before an action opens a
  // dialog (which hands focus back there when it closes).
  const run = (action: () => void) => () => {
    close(true)
    action()
  }

  const items = [
    { key: 'notes', label: 'Edit notes…', onSelect: run(onEditNotes) },
    { key: 'insert', label: 'Insert day after', onSelect: run(onInsertAfter) },
    {
      key: 'delete',
      label: 'Delete day…',
      danger: true,
      disabled: !canDelete,
      title: canDelete ? undefined : 'A trip needs at least one day.',
      onSelect: run(onDelete),
    },
  ]

  function onKeyDown(e: KeyboardEvent) {
    const next = menuFocusIndex(e.key, focus, items.length)
    if (next !== null) {
      e.preventDefault()
      setFocus(next)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      close(true)
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      className="stop-menu"
      role="menu"
      aria-label={`Day ${dayNumber} actions`}
      style={position}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          ref={(node) => {
            itemRefs.current[i] = node
          }}
          type="button"
          role="menuitem"
          className="stop-menu-item"
          data-danger={item.danger || undefined}
          tabIndex={i === focus ? 0 : -1}
          aria-disabled={item.disabled || undefined}
          title={item.title}
          onFocus={() => setFocus(i)}
          onClick={item.disabled ? undefined : item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
