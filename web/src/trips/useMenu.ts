// What every popup menu (stop menu, day menu) shares: placing it inside the
// viewport, moving focus between items, and closing on a press or scroll
// outside it or when the window changes.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { menuPosition, type MenuAnchor } from './stopMenu'

/**
 * `layoutKey` changes when the menu shows a different list (e.g. a
 * submenu), so it's placed and focused again.
 */
export function useMenu(
  anchor: MenuAnchor,
  onClose: () => void,
  layoutKey?: unknown,
) {
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
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
  }, [anchor, layoutKey])

  useEffect(() => {
    itemRefs.current[focus]?.focus()
  }, [focus, layoutKey])

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

  return { menuRef, itemRefs, focus, setFocus, position, close }
}
