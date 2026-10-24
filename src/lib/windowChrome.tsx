import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Whether the window a component is rendered in is the frontmost one. */
export const WindowActiveContext = createContext(true)

/**
 * Key handling for a whole window while it's in front (an app's key equivalents):
 * arrows in Preview work without clicking the photo first. Typing in fields is left alone, and
 * a handler that returns true has used the key (its default action is prevented).
 */
export function useWindowKeys(handler: (e: KeyboardEvent) => boolean | void) {
  const active = useContext(WindowActiveContext)
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"], .xterm')) return
      if (ref.current(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

/** The toolbar slot in the title bar of the window a component is rendered in. */
export const WindowToolbarContext = createContext<HTMLElement | null>(null)

/**
 * Puts its children in the window's title bar, as a unified toolbar: a window's own
 * controls (back/forward, title, search) live next to the window buttons, not in its content.
 */
export function WindowToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(WindowToolbarContext)
  return slot ? createPortal(children, slot) : null
}

/** Title (and optional subtitle) at the start of a toolbar, as the window title. */
export function ToolbarTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <span className="tb-title">
      <strong>{title}</strong>
      {subtitle && <small>{subtitle}</small>}
    </span>
  )
}
