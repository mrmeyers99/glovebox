// A stop's actions menu: Move to day…, Skip/Unskip, Edit and Delete for
// owners and editors, View details for viewers. Opened from the "⋯" button,
// a right-click or a long-press (see useStopMenuTrigger), in the day list now
// and on map markers later.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { Stop } from '../lib/database.types'
import {
  menuFocusIndex,
  menuPosition,
  STOP_MENU_LABELS,
  stopMenuActions,
  type MenuAnchor,
} from './stopMenu'

export type StopMenuDay = { dayId: string; dayNumber: number }

type Props = {
  stop: Stop
  anchor: MenuAnchor
  /** Owners and editors; viewers only get View details. */
  canEdit: boolean
  /** The trip's days in order. */
  days: StopMenuDay[]
  /** Move the stop to the end of `dayId`, or to a new day at the end (null). */
  onMoveToDay: (dayId: string | null) => void
  onSetSkipped: (skipped: boolean) => void
  /** Open the stop's form (or its details, for viewers). */
  onOpen: () => void
  /** Ask to delete the stop. */
  onDelete: () => void
  onClose: () => void
}

type Item = {
  key: string
  label: string
  disabled?: boolean
  /** Opens the list of days instead of acting. */
  submenu?: boolean
  danger?: boolean
  onSelect: () => void
}

export function StopMenu({
  stop,
  anchor,
  canEdit,
  days,
  onMoveToDay,
  onSetSkipped,
  onOpen,
  onDelete,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  // The main list, or the days to move to.
  const [view, setView] = useState<'main' | 'days'>('main')
  const [focus, setFocus] = useState(0)
  // Moved inside the viewport before it's painted (see below).
  const [position, setPosition] = useState<CSSProperties>({
    left: anchor.x,
    top: anchor.y,
  })

  const close = useCallback(
    (restoreFocus: boolean) => {
      if (restoreFocus) anchor.returnFocus?.focus()
      onClose()
    },
    [anchor, onClose],
  )

  // Close first, so focus is back on the trigger before an action opens a
  // dialog (which hands focus back there when it closes).
  const run = (action: () => void) => () => {
    close(true)
    action()
  }

  const showView = (next: 'main' | 'days', focusIndex: number) => {
    setView(next)
    setFocus(focusIndex)
  }

  const mainActions = stopMenuActions(stop, canEdit)
  const items: Item[] =
    view === 'main'
      ? mainActions.map((action) => ({
          key: action,
          label: STOP_MENU_LABELS[action],
          submenu: action === 'move',
          danger: action === 'delete',
          onSelect:
            action === 'move'
              ? // The first day it can move to (after Back).
                () =>
                  showView(
                    'days',
                    1 + days.findIndex((d) => d.dayId !== stop.day_id),
                  )
              : action === 'skip' || action === 'unskip'
                ? run(() => onSetSkipped(action === 'skip'))
                : action === 'delete'
                  ? run(onDelete)
                  : run(onOpen),
        }))
      : [
          {
            key: 'back',
            label: '‹ Back',
            onSelect: () => showView('main', mainActions.indexOf('move')),
          },
          ...days.map((day) => {
            const current = day.dayId === stop.day_id
            return {
              key: day.dayId,
              label: `Day ${day.dayNumber}${current ? ' (current)' : ''}`,
              disabled: current,
              onSelect: current ? () => {} : run(() => onMoveToDay(day.dayId)),
            }
          }),
          {
            key: 'new',
            label: `New day at end (Day ${days.length + 1})`,
            onSelect: run(() => onMoveToDay(null)),
          },
        ]

  // Place the menu once its size is known, and again when its list changes.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition(
      menuPosition(
        anchor,
        { width, height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [anchor, view])

  useEffect(() => {
    itemRefs.current[focus]?.focus()
  }, [focus, view])

  // Close on a press or scroll outside the menu, or when the window changes.
  useEffect(() => {
    const outside = (e: Event) => {
      if (!(e.target instanceof Node && menuRef.current?.contains(e.target)))
        close(false)
    }
    const dismiss = () => close(false)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', outside, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', outside, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [close])

  function onKeyDown(e: KeyboardEvent) {
    const next = menuFocusIndex(e.key, focus, items.length)
    if (next !== null) {
      e.preventDefault()
      setFocus(next)
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        if (view === 'days') showView('main', mainActions.indexOf('move'))
        else close(true)
        break
      case 'ArrowLeft':
        if (view === 'days') {
          e.preventDefault()
          showView('main', mainActions.indexOf('move'))
        }
        break
      case 'ArrowRight':
        if (items[focus]?.submenu) {
          e.preventDefault()
          items[focus].onSelect()
        }
        break
      case 'Tab':
        e.preventDefault()
        close(true)
        break
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      className="stop-menu"
      role="menu"
      aria-label={
        view === 'main' ? `${stop.name} actions` : `Move ${stop.name} to day`
      }
      style={position}
      onKeyDown={onKeyDown}
      // Keep the browser's menu from opening over this one.
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
          aria-haspopup={item.submenu ? 'menu' : undefined}
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
