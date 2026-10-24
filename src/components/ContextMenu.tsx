import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { Glass } from './Glass'

export type MenuItem =
  | {
      label: string
      icon?: LucideIcon
      /** A colored dot in place of the icon (Tags). */
      color?: string
      shortcut?: string
      /** Shows a check mark, for on/off items. */
      checked?: boolean
      disabled?: boolean
      danger?: boolean
      /** Destructive two-step: the first click swaps the label to this text, the second runs onSelect. */
      confirm?: string
      onSelect?: () => void
      /** Items shown in a menu beside this one (Open With ▸); the item itself only opens it. */
      submenu?: MenuItem[]
    }
  | 'separator'

type Item = Exclude<MenuItem, 'separator'>

export interface MenuAnchor {
  x: number
  y: number
  placement?: 'below' | 'above'
  align?: 'start' | 'center'
}

const MENU_WIDTH = 230
const SUBMENU_WIDTH = 190
const EDGE = 8
// The panels' padding: a submenu's first item lines up with the item that opened it.
const PANEL_PAD = 6
// Grace period before hovering another item closes the submenu, for a diagonal path into it.
const SUB_CLOSE_MS = 150

interface Props {
  items: MenuItem[]
  anchor: MenuAnchor
  onClose: () => void
}

// Portaled to <body>: menus opened from glass surfaces (Dock, menu bar) would otherwise sit inside
// a backdrop root and could not frost the wallpaper themselves. A submenu is a second panel next
// to the first, for the same reason.
export function ContextMenu({ items, anchor, onClose }: Props) {
  const main = useRef<HTMLDivElement>(null)
  const side = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [sub, setSub] = useState<{ label: string; items: MenuItem[]; top: number; left: number; flip: number } | null>(null)
  // A submenu with no room on either side (a phone) covers the menu; the menu then steps aside.
  const [crowded, setCrowded] = useState(false)
  const closeTimer = useRef(0)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!sub) setCrowded(false)
  }, [sub])

  // A press outside both panels, or Escape, closes the menu.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!main.current?.contains(t) && !side.current?.contains(t)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const { x, y, placement = 'below', align = 'start' } = anchor
  const left = Math.max(align === 'center' ? x - MENU_WIDTH / 2 : x, EDGE)
  const position: CSSProperties = placement === 'below' ? { left, top: y } : { left, bottom: window.innerHeight - y }

  const openSub = (item: Item, el: HTMLElement) => {
    clearTimeout(closeTimer.current)
    const panel = main.current!.getBoundingClientRect()
    const row = el.getBoundingClientRect()
    setSub({ label: item.label, items: item.submenu!, top: row.top - PANEL_PAD, left: panel.right - 4, flip: panel.left + 4 })
  }
  const pick = (item: Item) => {
    if (item.confirm !== undefined && armed !== item.label) return setArmed(item.label)
    item.onSelect?.()
    onClose()
  }

  return createPortal(
    <>
      <Panel
        panelRef={main}
        items={items}
        className={`menu-${placement} ${crowded && sub ? 'is-covered' : ''}`}
        style={{ ...position, minWidth: MENU_WIDTH }}
        armed={armed}
        openLabel={sub?.label}
        onPick={pick}
        onHover={(item, el) => {
          clearTimeout(closeTimer.current)
          if (item?.submenu) openSub(item, el)
          else if (sub) closeTimer.current = window.setTimeout(() => setSub(null), SUB_CLOSE_MS)
        }}
        onOpenSub={(item, el) => (sub?.label === item.label ? setSub(null) : openSub(item, el))}
      />
      {sub && (
        <Panel
          key={sub.label}
          panelRef={side}
          items={sub.items}
          className="menu-side"
          style={{ left: sub.left, top: sub.top, minWidth: SUBMENU_WIDTH }}
          flipTo={sub.flip}
          onCrowded={() => setCrowded(true)}
          armed={armed}
          onPick={pick}
          onHover={() => clearTimeout(closeTimer.current)}
          onOpenSub={() => {}}
        />
      )}
    </>,
    document.body,
  )
}

interface PanelProps {
  panelRef: RefObject<HTMLDivElement | null>
  items: MenuItem[]
  className: string
  style: CSSProperties
  /** For a submenu: the x its right edge moves to when it doesn't fit on the right. */
  flipTo?: number
  /** For a submenu: it fits on neither side of the menu that opened it. */
  onCrowded?: () => void
  armed: string | null
  openLabel?: string
  onPick: (item: Item) => void
  onHover: (item: Item | null, el: HTMLElement) => void
  onOpenSub: (item: Item, el: HTMLElement) => void
}

function Panel({ panelRef, items, className, style, flipTo, onCrowded, armed, openLabel, onPick, onHover, onOpenSub }: PanelProps) {
  const [shift, setShift] = useState({ x: 0, y: 0 })

  // Menus size to their content; nudge them back on screen if they overflow an edge
  // (a submenu that doesn't fit on the right opens on the left instead).
  useLayoutEffect(() => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx =
      rect.right > window.innerWidth - EDGE
        ? flipTo !== undefined
          ? Math.max(EDGE, flipTo - rect.width) - rect.left
          : window.innerWidth - EDGE - rect.right
        : 0
    const dy =
      rect.bottom > window.innerHeight - EDGE
        ? window.innerHeight - EDGE - rect.bottom
        : rect.top < EDGE
          ? EDGE - rect.top
          : 0
    if (dx || dy) setShift({ x: dx, y: dy })
    if (flipTo !== undefined && rect.right > window.innerWidth - EDGE && flipTo - rect.width < EDGE) onCrowded?.()
  }, [])

  const hasIcons = items.some(item => item !== 'separator' && (item.icon || item.color))
  const moved: CSSProperties = {
    ...style,
    ...(typeof style.left === 'number' ? { left: style.left + shift.x } : {}),
    ...(typeof style.top === 'number' ? { top: style.top + shift.y } : {}),
    ...(typeof style.bottom === 'number' ? { bottom: style.bottom - shift.y } : {}),
    maxWidth: `min(360px, calc(100vw - ${EDGE * 2}px))`,
  }

  return (
    <Glass
      ref={panelRef}
      radius={16}
      bezel={10}
      depth={10}
      blur={18}
      className={`menu tint-panel ${className}`}
      style={moved}
      role="menu"
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item === 'separator') return <div key={`sep-${i}`} className="menu-sep" />
        const Icon = item.icon
        const isArmed = item.confirm !== undefined && armed === item.label
        return (
          <button
            key={item.label}
            role="menuitem"
            className={`${item.danger ? 'danger' : ''} ${item.submenu && openLabel === item.label ? 'is-open' : ''}`}
            disabled={item.disabled}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? openLabel === item.label : undefined}
            onPointerEnter={e => !item.disabled && onHover(item, e.currentTarget)}
            onClick={e => (item.submenu ? onOpenSub(item, e.currentTarget) : onPick(item))}
          >
            {hasIcons && <span className="menu-icon">{item.color ? <i className="menu-dot" style={{ background: item.color }} /> : Icon && <Icon size={14} />}</span>}
            <span className="menu-label">{isArmed ? item.confirm : item.label}</span>
            {item.checked && <Check size={14} />}
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
            {item.submenu && <ChevronRight size={14} className="menu-more" />}
          </button>
        )
      })}
    </Glass>
  )
}
