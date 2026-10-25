import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import type { MenuItem } from '../components/ContextMenu'
import { tr } from '../lib/i18n'

/**
 * A menu on a phone: the same items as a right-click menu, as a sheet from the bottom with rows
 * big enough for a finger. A submenu (Open With ▸) opens in its place, with a way back.
 */
export function ActionSheet({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [stack, setStack] = useState<{ label: string; items: MenuItem[] }[]>([])
  const [armed, setArmed] = useState<string | null>(null)
  const page = stack.at(-1)
  const shown = page?.items ?? items
  return createPortal(
    <div className="m-sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="m-sheet" role="menu">
        {page && (
          <button className="m-sheet-back" onClick={() => setStack(s => s.slice(0, -1))}>
            <ChevronLeft size={18} /> {page.label}
          </button>
        )}
        <div className="m-sheet-items">
          {shown.map((item, i) => {
            if (item === 'separator') return <hr key={`sep-${i}`} />
            const Icon = item.icon
            const confirming = armed === item.label && !!item.confirm
            return (
              <button
                key={item.label}
                role="menuitem"
                className={`m-sheet-item ${item.danger ? 'is-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  if (item.submenu) {
                    setStack(s => [...s, { label: item.label, items: item.submenu! }])
                    return
                  }
                  if (item.confirm && !confirming) {
                    setArmed(item.label)
                    return
                  }
                  onClose()
                  item.onSelect?.()
                }}
              >
                <span className="m-sheet-icon">
                  {item.color ? <i className="m-sheet-dot" style={{ background: item.color }} /> : Icon ? <Icon size={18} /> : null}
                </span>
                <span className="m-sheet-label">{confirming ? item.confirm : item.label}</span>
                {item.checked && <Check size={17} />}
                {item.submenu && <ChevronRight size={17} className="m-sheet-more" />}
              </button>
            )
          })}
        </div>
        <button className="m-sheet-cancel" onClick={onClose}>
          {tr('Cancel')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
