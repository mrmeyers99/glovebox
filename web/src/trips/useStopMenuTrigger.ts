import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import type { MenuAnchor } from './stopMenu'

/** How long a touch has to be held to open the menu. */
export const LONG_PRESS_MS = 500
/** How far a touch can move before it's a scroll, not a long-press. */
const LONG_PRESS_TOLERANCE = 10
/** Keep the menu just off the finger, so lifting it doesn't pick an item. */
const TOUCH_OFFSET = 12

/**
 * Event handlers that open a stop menu on right-click (or the context-menu
 * key) and on a long-press with a finger. Spread them on the element, e.g.
 * a stop's row in the day list or its marker on the map.
 *
 * A click right after a long-press is swallowed, so it doesn't also select
 * the stop. Presses starting inside `ignoreSelector` (e.g. a drag handle,
 * whose own long-press starts a drag) are left alone.
 */
export function useStopMenuTrigger(
  open: ((anchor: MenuAnchor) => void) | undefined,
  {
    returnFocus,
    ignoreSelector,
  }: {
    /** Gets focus back when the menu closes. */
    returnFocus?: () => HTMLElement | null
    ignoreSelector?: string
  } = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const pressed = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }, [])
  useEffect(() => cancel, [cancel])

  const ignored = useCallback(
    (target: EventTarget) =>
      ignoreSelector !== undefined &&
      target instanceof Element &&
      target.closest(ignoreSelector) !== null,
    [ignoreSelector],
  )

  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!open) return
      e.preventDefault()
      if (ignored(e.target)) return
      cancel()
      // From the keyboard (context-menu key, Shift+F10) there's no pointer
      // position; open at the element instead.
      const keyboard = e.clientX === 0 && e.clientY === 0
      const rect = e.currentTarget.getBoundingClientRect()
      open({
        x: keyboard ? rect.left : e.clientX,
        y: keyboard ? rect.bottom : e.clientY,
        returnFocus: returnFocus?.(),
      })
    },
    [open, ignored, cancel, returnFocus],
  )

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      pressed.current = false
      if (!open || e.pointerType !== 'touch' || ignored(e.target)) return
      cancel()
      const point = { x: e.clientX, y: e.clientY }
      start.current = point
      timer.current = setTimeout(() => {
        timer.current = null
        pressed.current = true
        open({
          x: point.x + TOUCH_OFFSET,
          y: point.y + TOUCH_OFFSET,
          returnFocus: returnFocus?.(),
        })
      }, LONG_PRESS_MS)
    },
    [open, ignored, cancel, returnFocus],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const from = start.current
      if (
        from &&
        Math.hypot(e.clientX - from.x, e.clientY - from.y) >
          LONG_PRESS_TOLERANCE
      )
        cancel()
    },
    [cancel],
  )

  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!pressed.current) return
    pressed.current = false
    e.stopPropagation()
    e.preventDefault()
  }, [])

  return {
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture,
  }
}
