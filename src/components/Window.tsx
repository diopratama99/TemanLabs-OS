import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { WindowIdContext } from '../lib/appMenus'
import { WindowActiveContext, WindowToolbarContext } from '../lib/windowChrome'
import { useContextMenu } from '../lib/contextMenu'
import { EASE_IN, EASE_OUT, prefersReducedMotion } from '../lib/motion'
import { Glass } from './Glass'

export type SystemWindowId =
  | 'files'
  | 'code'
  | 'store'
  | 'terminal'
  | 'activity'
  | 'sharing'
  | 'updates'
  | 'console'
  | 'disks'
  | 'network'
  | 'scheduler'
  | 'kubernetes'
  | 'music'
  | 'preview'
  | 'video'
  | 'settings'
export type WindowId = SystemWindowId | `app:${string}`

export interface Frame {
  x: number
  y: number
  width: number
  height: number
}

const MENUBAR_HEIGHT = 32

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

// Layout box, unaffected by running transform animations.
const layoutRect = (el: HTMLElement): Rect => ({
  left: el.offsetLeft,
  top: el.offsetTop,
  width: el.offsetWidth,
  height: el.offsetHeight,
})

/** Where a window zooms out of and minimizes into: its Dock icon, or the Dock itself. */
function dockTarget(id: WindowId): DOMRect | null {
  const icon = document.querySelector(`[data-dock-id="${CSS.escape(id)}"] .app-icon`) ?? document.querySelector('.dock')
  return icon?.getBoundingClientRect() ?? null
}

/** Transform (with transform-origin 0 0) that shrinks a window onto a target rect, keeping its aspect. */
function shrinkTo(win: Rect, target: Rect) {
  const s = Math.max(0.02, target.width / win.width)
  const x = target.left + target.width / 2 - win.left - (win.width * s) / 2
  const y = target.top + target.height / 2 - win.top - (win.height * s) / 2
  return `translate(${x}px, ${y}px) scale(${s})`
}

/** The same window, scaled about its own centre. */
function scaled(win: Rect, s: number, dy = 0) {
  return `translate(${(win.width * (1 - s)) / 2}px, ${(win.height * (1 - s)) / 2 + dy}px) scale(${s})`
}

const OPEN_MS = 440
const MINIMIZE_MS = 480
const CLOSE_MS = 190
const ZOOM_MS = 380

interface Props {
  id: WindowId
  title: string
  frame: Frame
  z: number
  minimized: boolean
  maximized: boolean
  /** Set when the window is closing; it plays its exit animation, then calls onClosed. */
  closing?: boolean
  /** The frontmost window; the others get grey window buttons. */
  active?: boolean
  /**
   * sidebar: the content's sidebar runs the full height with the window buttons on it.
   * compact: a slim title bar for windows without a toolbar (Terminal).
 */
  variant?: 'default' | 'sidebar' | 'compact'
  /** Replaces the centered title, e.g. with an address pill. */
  center?: ReactNode
  /** Buttons on the right side of the title bar. */
  actions?: ReactNode
  onFocus: () => void
  onClose: () => void
  onClosed?: () => void
  onMinimize: () => void
  onToggleZoom: () => void
  children: ReactNode
}

export function Window({
  id,
  title,
  frame,
  z,
  minimized,
  maximized,
  closing = false,
  active = true,
  variant = 'default',
  center,
  actions,
  onFocus,
  onClose,
  onClosed,
  onMinimize,
  onToggleZoom,
  children,
}: Props) {
  const [pos, setPos] = useState({ x: frame.x, y: frame.y })
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const { show } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const lastRect = useRef<Rect | null>(null)
  // Previous values, so the effects below animate changes only (not the first render).
  const was = useRef({ minimized, maximized })

  // Opening: zoom out of the Dock icon (or grow in place when it has none).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    const win = layoutRect(el)
    const from = dockTarget(id)
    const anim = from
      ? el.animate(
          [
            { transform: shrinkTo(win, from), opacity: 0 },
            { opacity: 1, offset: 0.3 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: OPEN_MS, easing: EASE_OUT },
        )
      : el.animate([{ transform: scaled(win, 0.92, 12), opacity: 0 }, { transform: 'none', opacity: 1 }], {
          duration: OPEN_MS * 0.75,
          easing: EASE_OUT,
        })
    return () => anim.cancel()
  }, [])

  // Minimize into the Dock and restore out of it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || was.current.minimized === minimized) return
    was.current.minimized = minimized
    if (prefersReducedMotion()) return
    const win = layoutRect(el)
    const target = dockTarget(id)
    if (!target) return
    const icon = { transform: shrinkTo(win, target), opacity: 0, visibility: 'visible' }
    const full = { transform: 'none', opacity: 1, visibility: 'visible' }
    const anim = minimized
      ? el.animate([full, { opacity: 0.9, offset: 0.7 }, icon], { duration: MINIMIZE_MS, easing: EASE_IN })
      : el.animate([icon, { opacity: 1, offset: 0.35 }, full], { duration: MINIMIZE_MS * 0.9, easing: EASE_OUT })
    return () => anim.cancel()
  }, [minimized])

  // Zoom: FLIP from the previous frame to the new one.
  useLayoutEffect(() => {
    const el = ref.current
    const prev = lastRect.current
    if (!el || !prev || was.current.maximized === maximized) return
    was.current.maximized = maximized
    if (prefersReducedMotion()) return
    const next = layoutRect(el)
    const from = `translate(${prev.left - next.left}px, ${prev.top - next.top}px) scale(${prev.width / next.width}, ${prev.height / next.height})`
    const anim = el.animate([{ transform: from }, { transform: 'none' }], { duration: ZOOM_MS, easing: EASE_OUT })
    return () => anim.cancel()
  }, [maximized])

  // Closing: shrink and fade, then let the parent unmount us.
  useLayoutEffect(() => {
    const el = ref.current
    if (!closing || !el) return
    if (minimized || prefersReducedMotion()) {
      onClosed?.()
      return
    }
    const anim = el.animate([{ transform: 'none', opacity: 1 }, { transform: scaled(layoutRect(el), 0.94, 6), opacity: 0 }], {
      duration: CLOSE_MS,
      easing: EASE_IN,
      fill: 'forwards',
    })
    let cancelled = false
    anim.finished.then(
      () => !cancelled && onClosed?.(),
      () => {},
    )
    return () => {
      cancelled = true
      anim.cancel()
    }
  }, [closing])

  // Runs after the effects above, so they still see the previous frame.
  useLayoutEffect(() => {
    if (ref.current) lastRect.current = layoutRect(ref.current)
  })

  const onTitlebarDown = (e: PointerEvent<HTMLDivElement>) => {
    if (maximized || (e.target as HTMLElement).closest('button, input, select, textarea, a, [data-no-drag]')) return
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onTitlebarMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setPos({ x: e.clientX - drag.current.dx, y: Math.max(MENUBAR_HEIGHT + 4, e.clientY - drag.current.dy) })
  }
  const endDrag = () => {
    drag.current = null
  }

  const style: CSSProperties = maximized
    ? { left: 8, top: MENUBAR_HEIGHT + 6, width: 'calc(100vw - 16px)', height: 'calc(100vh - 136px)', zIndex: z }
    : { left: pos.x, top: pos.y, width: frame.width, height: frame.height, zIndex: z }

  return (
    <Glass
      ref={ref}
      radius={24}
      bezel={16}
      depth={18}
      blur={26}
      className={`window tint-window is-${variant} ${active ? 'is-active' : ''} ${minimized ? 'is-minimized' : ''} ${maximized ? 'is-maximized' : ''} ${closing ? 'is-closing' : ''}`}
      style={style}
      onPointerDown={onFocus}
      role="dialog"
      aria-label={title}
      inert={minimized || closing}
    >
      <div
        className="window-titlebar"
        onPointerDown={onTitlebarDown}
        onPointerMove={onTitlebarMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={e => !(e.target as HTMLElement).closest('button, input, select, textarea, a, [data-no-drag]') && onToggleZoom()}
        onContextMenu={e =>
          show(e, [
            { label: 'Minimize', icon: Minus, onSelect: onMinimize },
            {
              label: maximized ? 'Exit Zoom' : 'Zoom',
              icon: maximized ? Minimize2 : Maximize2,
              onSelect: onToggleZoom,
            },
            'separator',
            { label: 'Close Window', icon: X, onSelect: onClose },
          ])
        }
      >
        <div className="traffic">
          <button className="tl tl-close" onClick={onClose} aria-label="Close">
            <X size={8} strokeWidth={3} />
          </button>
          <button className="tl tl-min" onClick={onMinimize} aria-label="Minimize">
            <Minus size={8} strokeWidth={3} />
          </button>
          <button className="tl tl-max" onClick={onToggleZoom} aria-label="Zoom">
            <Maximize2 size={7} strokeWidth={3} />
          </button>
        </div>
        <div className="window-center">{center ?? <span className="window-title">{title}</span>}</div>
        <div className="window-toolbar" ref={setToolbar} />
        {actions && <div className="window-actions">{actions}</div>}
      </div>
      <div className="window-body">
        <WindowIdContext.Provider value={id}>
          <WindowActiveContext.Provider value={active && !minimized}>
            <WindowToolbarContext.Provider value={toolbar}>{children}</WindowToolbarContext.Provider>
          </WindowActiveContext.Provider>
        </WindowIdContext.Provider>
      </div>
    </Glass>
  )
}
