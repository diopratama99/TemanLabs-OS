import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ContextMenu, type MenuAnchor, type MenuItem } from '../components/ContextMenu'

type PointerLike = { clientX: number; clientY: number; preventDefault: () => void }

interface ContextMenuApi {
  /**
   * Opens a menu at the pointer (calling preventDefault on the event) or at an explicit anchor.
   * Because the event is consumed, parent handlers can check `e.defaultPrevented` to avoid
   * replacing a more specific menu opened further down the tree.
   */
  show: (at: PointerLike | MenuAnchor, items: MenuItem[]) => void
  close: () => void
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null)

// iOS Safari never fires `contextmenu`, so there a long press synthesizes one.
const NEEDS_LONG_PRESS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 10

function useLongPressContextMenu() {
  useEffect(() => {
    if (!NEEDS_LONG_PRESS) return
    let timer = 0
    let start: { x: number; y: number } | null = null
    const cancel = () => {
      clearTimeout(timer)
      start = null
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel()
      const touch = e.touches[0]
      const origin = { x: touch.clientX, y: touch.clientY }
      const target = e.target
      start = origin
      timer = window.setTimeout(() => {
        if (start !== origin) return
        start = null
        target?.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: origin.x, clientY: origin.y }),
        )
        // Swallow the click that lifting the finger would otherwise send to whatever was pressed.
        const swallow = new AbortController()
        window.addEventListener(
          'click',
          ev => {
            ev.preventDefault()
            ev.stopPropagation()
          },
          { capture: true, once: true, signal: swallow.signal },
        )
        setTimeout(() => swallow.abort(), 800)
      }, LONG_PRESS_MS)
    }
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_TOLERANCE) cancel()
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', cancel)
    document.addEventListener('touchcancel', cancel)
    return () => {
      cancel()
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', cancel)
      document.removeEventListener('touchcancel', cancel)
    }
  }, [])
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ id: number; anchor: MenuAnchor; items: MenuItem[] } | null>(null)
  const nextId = useRef(0)
  useLongPressContextMenu()

  const show = useCallback((at: PointerLike | MenuAnchor, items: MenuItem[]) => {
    let anchor: MenuAnchor
    if ('clientX' in at) {
      at.preventDefault()
      anchor = { x: at.clientX, y: at.clientY }
    } else {
      anchor = at
    }
    setMenu({ id: ++nextId.current, anchor, items })
  }, [])
  const close = useCallback(() => setMenu(null), [])
  const api = useMemo(() => ({ show, close }), [show, close])

  return (
    <ContextMenuContext.Provider value={api}>
      {children}
      {/* Keyed so per-menu state (like an armed confirm item) resets for every new menu. */}
      {menu && <ContextMenu key={menu.id} items={menu.items} anchor={menu.anchor} onClose={close} />}
    </ContextMenuContext.Provider>
  )
}

export function useContextMenu() {
  const ctx = useContext(ContextMenuContext)
  if (!ctx) throw new Error('useContextMenu must be used inside ContextMenuProvider')
  return ctx
}
