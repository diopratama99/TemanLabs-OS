import { tr } from '../lib/i18n'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Expand, Maximize2, Minimize2, Minus, PanelLeft, PanelRight, Shrink, X } from 'lucide-react'
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
  | 'remux'
  | 'commands'
  | 'devices'
  | 'settings'
export type WindowId = SystemWindowId | `app:${string}` | `info:${string}` | `remote:${string}`

export interface Frame {
  x: number
  y: number
  width: number
  height: number
}

const MENUBAR_HEIGHT = 32

// ----- Snapping -----
/** Where a window can be snapped: halves, quarters, thirds, or filling the desktop. */
export type SnapZone = 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br' | 'l3' | 'm3' | 'r3' | 'fill'

// The desktop between the menu bar and the Dock, with a margin, as CSS lengths.
const TOP = MENUBAR_HEIGHT + 6
const SIDE = 8
const GAP = 8
const DOCK_ROOM = 98
const AREA_H = `(100vh - ${TOP + DOCK_ROOM}px)`
const HALF_W = `(50vw - ${SIDE + GAP / 2}px)`
const THIRD_W = `((100vw - ${2 * SIDE + 2 * GAP}px) / 3)`
const HALF_H = `(${AREA_H} / 2 - ${GAP / 2}px)`

/** The box of a zone, in CSS (it follows the browser window's size by itself). */
export function zoneBox(zone: SnapZone): CSSProperties {
  const full = { top: TOP, height: `calc(${AREA_H})` }
  const upper = { top: TOP, height: `calc(${HALF_H})` }
  const lower = { top: `calc(${TOP}px + ${HALF_H} + ${GAP}px)`, height: `calc(${HALF_H})` }
  const left = { left: SIDE, width: `calc(${HALF_W})` }
  const right = { left: `calc(50vw + ${GAP / 2}px)`, width: `calc(${HALF_W})` }
  switch (zone) {
    case 'left':
      return { ...full, ...left }
    case 'right':
      return { ...full, ...right }
    case 'tl':
      return { ...upper, ...left }
    case 'tr':
      return { ...upper, ...right }
    case 'bl':
      return { ...lower, ...left }
    case 'br':
      return { ...lower, ...right }
    case 'l3':
      return { ...full, left: SIDE, width: `calc(${THIRD_W})` }
    case 'm3':
      return { ...full, left: `calc(${SIDE + GAP}px + ${THIRD_W})`, width: `calc(${THIRD_W})` }
    case 'r3':
      return { ...full, left: `calc(100vw - ${SIDE}px - ${THIRD_W})`, width: `calc(${THIRD_W})` }
    case 'fill':
      return { ...full, left: SIDE, width: `calc(100vw - ${2 * SIDE}px)` }
  }
}

// Dragging a window into these spots snaps it: corners, then edges (the top one fills).
const CORNER = 28
const EDGE = 6
function zoneAt(x: number, y: number): SnapZone | null {
  const w = window.innerWidth
  const h = window.innerHeight
  const top = y <= MENUBAR_HEIGHT + CORNER
  const bottom = y >= h - CORNER
  if (x <= EDGE) return top ? 'tl' : bottom ? 'bl' : 'left'
  if (x >= w - EDGE) return top ? 'tr' : bottom ? 'br' : 'right'
  if (y <= MENUBAR_HEIGHT + 2) return 'fill'
  return null
}
const canSnap = () => window.innerWidth > 720

/** Layouts offered when the pointer rests on the green button, as rows of zones. */
const LAYOUTS: SnapZone[][] = [['left', 'right'], ['l3', 'm3', 'r3'], ['tl', 'tr', 'bl', 'br'], ['fill']]
const SNAP_MENU_DELAY_MS = 450
const ZONE_LABEL: Record<SnapZone, string> = {
  left: 'Left half',
  right: 'Right half',
  tl: 'Top left quarter',
  tr: 'Top right quarter',
  bl: 'Bottom left quarter',
  br: 'Bottom right quarter',
  l3: 'Left third',
  m3: 'Middle third',
  r3: 'Right third',
  fill: 'Fill the desktop',
}

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
  /** Snapped into part of the desktop (null: free). */
  snap?: SnapZone | null
  /** Covering the whole screen, menu bar and Dock hidden (the green button). */
  fullscreen?: boolean
  onSnap?: (zone: SnapZone | null) => void
  onToggleFullscreen?: () => void
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
  snap = null,
  fullscreen: fullscreenWanted = false,
  onSnap,
  onToggleFullscreen,
  children,
}: Props) {
  const [pos, setPos] = useState({ x: frame.x, y: frame.y })
  // The size to go back to when it leaves a snapped, filled or full-screen layout (what the
  // user last resized it to).
  const [size, setSize] = useState({ width: frame.width, height: frame.height })
  const drag = useRef<{ dx: number; dy: number; x: number; y: number; free: boolean } | null>(null)
  const [preview, setPreview] = useState<SnapZone | null>(null)
  const [snapMenu, setSnapMenu] = useState<DOMRect | null>(null)
  const menuTimer = useRef(0)
  // Full screen only while it's in front. Behind another window it fills the desktop instead,
  // with the menu bar and Dock back, and coming to the front makes it full screen again.
  const fullscreen = fullscreenWanted && active
  const laidOut = maximized || !!snap || fullscreenWanted
  // The green button of a full-screen window that was behind: the click that brought it to the
  // front already made it full screen again, so it doesn't also toggle it off.
  const activeAtPress = useRef(active)
  const { show } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const lastRect = useRef<Rect | null>(null)
  // Previous values, so the effects below animate changes only (not the first render).
  const layout = `${maximized}:${snap}:${fullscreen}`
  const was = useRef({ minimized, layout })

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

  // Zoom, snap, full screen: FLIP from the previous frame to the new one.
  useLayoutEffect(() => {
    const el = ref.current
    const prev = lastRect.current
    if (!el || !prev || was.current.layout === layout) return
    was.current.layout = layout
    if (prefersReducedMotion()) return
    const next = layoutRect(el)
    const from = `translate(${prev.left - next.left}px, ${prev.top - next.top}px) scale(${prev.width / next.width}, ${prev.height / next.height})`
    const anim = el.animate([{ transform: from }, { transform: 'none' }], { duration: ZOOM_MS, easing: EASE_OUT })
    return () => anim.cancel()
  }, [layout])

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

  // The frontmost window has the keyboard. Focus left behind in another window (Files, after
  // double-clicking a video) would otherwise take the arrow keys meant for this one. Coming back
  // to a window returns focus to what had it there (the terminal, a text field, the file list);
  // not to a button, where Space would press it again.
  const lastFocus = useRef<HTMLElement | null>(null)
  const restoreFocus = (el: HTMLElement) => {
    const back = lastFocus.current
    if (back && back.isConnected && el.contains(back) && !back.matches('button, a, select, summary')) back.focus({ preventScroll: true })
    else if (document.activeElement !== el) el.focus({ preventScroll: true })
  }
  useEffect(() => {
    const el = ref.current
    if (!active || minimized || closing || !el || el.contains(document.activeElement)) return
    restoreFocus(el)
  }, [active, minimized, closing])

  // Runs after the effects above, so they still see the previous frame.
  useLayoutEffect(() => {
    if (ref.current) lastRect.current = layoutRect(ref.current)
  })

  /** Keeps the free window's size before it's laid out, to return to it later. */
  const rememberSize = () => {
    const el = ref.current
    if (el && !laidOut) setSize({ width: el.offsetWidth, height: el.offsetHeight })
  }
  const snapTo = (zone: SnapZone | null) => {
    rememberSize()
    onSnap?.(zone)
  }

  const onTitlebarDown = (e: PointerEvent<HTMLDivElement>) => {
    if (fullscreen || (e.target as HTMLElement).closest('button, input, select, textarea, a, [data-no-drag]')) return
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, x: e.clientX, y: e.clientY, free: !laidOut }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onTitlebarMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.free) {
      // A snapped or filled window comes loose once it's really dragged, back at its own size,
      // under the pointer where it was holding it.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return
      const box = ref.current!.getBoundingClientRect()
      const along = (e.clientX - box.left) / box.width
      const x = e.clientX - along * size.width
      const y = Math.max(MENUBAR_HEIGHT + 4, e.clientY - Math.min(e.clientY - box.top, 40))
      d.dx = e.clientX - x
      d.dy = e.clientY - y
      d.free = true
      onSnap?.(null)
    }
    setPos({ x: e.clientX - d.dx, y: Math.max(MENUBAR_HEIGHT + 4, e.clientY - d.dy) })
    setPreview(canSnap() ? zoneAt(e.clientX, e.clientY) : null)
  }
  const endDrag = () => {
    const zone = drag.current?.free ? preview : null
    drag.current = null
    setPreview(null)
    if (zone) snapTo(zone)
  }

  // Layouts under the green button while the pointer rests on it.
  useEffect(() => () => clearTimeout(menuTimer.current), [])
  const greenEnter = (e: PointerEvent<HTMLButtonElement>) => {
    if (!canSnap() || fullscreen || !onSnap) return
    const box = e.currentTarget.getBoundingClientRect()
    clearTimeout(menuTimer.current)
    menuTimer.current = window.setTimeout(() => setSnapMenu(box), SNAP_MENU_DELAY_MS)
  }
  const greenLeave = () => {
    clearTimeout(menuTimer.current)
    menuTimer.current = window.setTimeout(() => setSnapMenu(null), 260)
  }
  const keepMenu = () => clearTimeout(menuTimer.current)

  const fixed = fullscreen
    ? { left: 0, top: 0, width: '100vw', height: '100vh' }
    : snap
      ? zoneBox(snap)
      : maximized || fullscreenWanted
        ? zoneBox('fill')
        : { left: pos.x, top: pos.y, width: size.width, height: size.height }
  // Full screen sits over the menu bar and the Dock while it's in front.
  const style: CSSProperties = { ...fixed, zIndex: fullscreen && active ? 1050 : z }

  return (
    <Glass
      ref={ref}
      radius={fullscreen ? 0 : 24}
      bezel={fullscreen ? 0 : 16}
      depth={18}
      blur={26}
      className={`window tint-window is-${variant} ${active ? 'is-active' : ''} ${minimized ? 'is-minimized' : ''} ${laidOut ? 'is-maximized' : ''} ${fullscreen ? 'is-fullscreen' : ''} ${closing ? 'is-closing' : ''}`}
      style={style}
      onPointerDown={onFocus}
      // Focusable itself, so a click anywhere in the window (even on blank space) moves the
      // keyboard here.
      tabIndex={-1}
      onFocus={e => {
        // A click on the title bar or blank space focuses the window itself: hand it on.
        if (e.target === e.currentTarget) restoreFocus(e.currentTarget)
        else lastFocus.current = e.target as HTMLElement
      }}
      // overflow: hidden still lets the browser scroll a window's content (focus, selection
      // drags, find in page), which slides the sidebar and title bar out of sight. Undo it.
      onScroll={e => {
        const el = e.currentTarget
        if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0)
      }}
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
        onDoubleClick={e => {
          if ((e.target as HTMLElement).closest('button, input, select, textarea, a, [data-no-drag]') || fullscreen) return
          rememberSize()
          onToggleZoom()
        }}
        onContextMenu={e =>
          show(e, [
            { label: tr('Minimize'), icon: Minus, onSelect: onMinimize },
            {
              label: maximized ? tr('Exit Zoom') : tr('Zoom'),
              icon: maximized ? Minimize2 : Maximize2,
              disabled: fullscreen,
              onSelect: () => {
                rememberSize()
                onToggleZoom()
              },
            },
            ...(onSnap && canSnap()
              ? ([
                  { label: tr('Left Half of Screen'), icon: PanelLeft, disabled: fullscreen, onSelect: () => snapTo('left') },
                  { label: tr('Right Half of Screen'), icon: PanelRight, disabled: fullscreen, onSelect: () => snapTo('right') },
                ] as const)
              : []),
            ...(onToggleFullscreen
              ? [
                  {
                    label: fullscreen ? tr('Exit Full Screen') : tr('Enter Full Screen'),
                    icon: fullscreen ? Shrink : Expand,
                    onSelect: () => {
                      rememberSize()
                      onToggleFullscreen()
                    },
                  },
                ]
              : []),
            'separator',
            { label: tr('Close Window'), icon: X, onSelect: onClose },
          ])
        }
      >
        <div className="traffic">
          <button className="tl tl-close" onClick={onClose} aria-label={tr('Close')}>
            <X size={8} strokeWidth={3} />
          </button>
          <button className="tl tl-min" onClick={onMinimize} aria-label={tr('Minimize')}>
            <Minus size={8} strokeWidth={3} />
          </button>
          <button
            className="tl tl-max"
            // Full screen, like the green button on a Mac; with Alt it zooms instead.
            onPointerDown={() => (activeAtPress.current = active)}
            onClick={e => {
              clearTimeout(menuTimer.current)
              setSnapMenu(null)
              if (fullscreenWanted && !activeAtPress.current) return
              rememberSize()
              if (e.altKey || !onToggleFullscreen) onToggleZoom()
              else onToggleFullscreen()
            }}
            onPointerEnter={greenEnter}
            onPointerLeave={greenLeave}
            aria-label={fullscreen ? tr('Exit Full Screen') : tr('Enter Full Screen')}
            title={fullscreen ? tr('Exit Full Screen') : tr('Enter Full Screen')}
          >
            {fullscreen ? <Minimize2 size={7} strokeWidth={3} /> : <Maximize2 size={7} strokeWidth={3} />}
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
      {preview && createPortal(<div className="snap-preview" style={{ ...zoneBox(preview), zIndex: z - 1 }} aria-hidden />, document.body)}
      {snapMenu &&
        createPortal(
          <div className="snap-menu" style={{ left: snapMenu.left - 8, top: snapMenu.bottom + 8 }} onPointerEnter={keepMenu} onPointerLeave={greenLeave} role="menu">
            <div className="snap-layouts">
              {LAYOUTS.map(row => (
                <div key={row.join()} className={`snap-layout is-${row.length === 4 ? 'grid' : row.length === 1 ? 'one' : row.length === 3 ? 'thirds' : 'halves'}`}>
                  {row.map(zone => (
                    <button
                      key={zone}
                      className={`snap-zone ${snap === zone || (zone === 'fill' && maximized) ? 'is-on' : ''}`}
                      aria-label={tr(ZONE_LABEL[zone])}
                      title={tr(ZONE_LABEL[zone])}
                      onClick={() => {
                        setSnapMenu(null)
                        snapTo(zone)
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
            {onToggleFullscreen && (
              <button
                className="snap-full"
                onClick={() => {
                  setSnapMenu(null)
                  rememberSize()
                  onToggleFullscreen()
                }}
              >
                <Expand size={13} /> {tr('Enter Full Screen')}
              </button>
            )}
          </div>,
          document.body,
        )}
    </Glass>
  )
}
