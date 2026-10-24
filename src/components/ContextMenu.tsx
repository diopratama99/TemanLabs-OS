import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, type LucideIcon } from 'lucide-react'
import { useDismiss } from '../hooks/useDismiss'
import { Glass } from './Glass'

export type MenuItem =
  | {
      label: string
      icon?: LucideIcon
      shortcut?: string
      /** Shows a check mark, for on/off items. */
      checked?: boolean
      disabled?: boolean
      danger?: boolean
      /** Destructive two-step: the first click swaps the label to this text, the second runs onSelect. */
      confirm?: string
      onSelect: () => void
    }
  | 'separator'

export interface MenuAnchor {
  x: number
  y: number
  placement?: 'below' | 'above'
  align?: 'start' | 'center'
}

const MENU_WIDTH = 230
const EDGE = 8

interface Props {
  items: MenuItem[]
  anchor: MenuAnchor
  onClose: () => void
}

// Portaled to <body>: menus opened from glass surfaces (Dock, menu bar) would otherwise sit inside
// a backdrop root and could not frost the wallpaper themselves.
export function ContextMenu({ items, anchor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [shift, setShift] = useState({ x: 0, y: 0 })
  useDismiss(ref, true, onClose)

  // Menus size to their content; nudge them back on screen if they overflow an edge.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const dx = rect.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - rect.right : 0
    const dy =
      rect.bottom > window.innerHeight - EDGE
        ? window.innerHeight - EDGE - rect.bottom
        : rect.top < EDGE
          ? EDGE - rect.top
          : 0
    if (dx || dy) setShift({ x: dx, y: dy })
  }, [])

  const { x, y, placement = 'below', align = 'start' } = anchor
  const left = Math.max(align === 'center' ? x - MENU_WIDTH / 2 : x, EDGE) + shift.x
  const position =
    placement === 'below' ? { left, top: y + shift.y } : { left, bottom: window.innerHeight - y - shift.y }
  const hasIcons = items.some(item => item !== 'separator' && item.icon)

  return createPortal(
    <Glass
      ref={ref}
      radius={16}
      bezel={10}
      depth={10}
      blur={18}
      className={`menu tint-panel menu-${placement}`}
      style={{ ...position, minWidth: MENU_WIDTH, maxWidth: `min(360px, calc(100vw - ${EDGE * 2}px))` }}
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
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              if (item.confirm !== undefined && !isArmed) return setArmed(item.label)
              item.onSelect()
              onClose()
            }}
          >
            {hasIcons && <span className="menu-icon">{Icon && <Icon size={14} />}</span>}
            <span className="menu-label">{isArmed ? item.confirm : item.label}</span>
            {item.checked && <Check size={14} />}
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        )
      })}
    </Glass>,
    document.body,
  )
}
