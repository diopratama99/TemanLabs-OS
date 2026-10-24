import { createPortal } from 'react-dom'
import { Plus, RotateCcw } from 'lucide-react'
import { useWidgets } from '../../hooks/useWidgets'
import { WIDGET_INFO, WIDGET_TYPES } from '../../lib/widgets'
import { Glass } from '../Glass'

/** Shown while editing the widget layout: add widgets, reset, or finish. */
export function WidgetGallery({ onDone }: { onDone: () => void }) {
  const { add, reset } = useWidgets()
  return createPortal(
    <Glass
      radius={26}
      bezel={18}
      depth={18}
      blur={22}
      className="widget-gallery tint-panel"
      role="dialog"
      aria-label="Widget gallery"
      onContextMenu={e => e.preventDefault()}
    >
      <div className="wg-head">
        <div>
          <strong>Widgets</strong>
          <small>Add widgets below. Drag widgets on the desktop to rearrange them, or press − to remove.</small>
        </div>
        <button className="btn" onClick={reset}>
          <RotateCcw size={13} /> Reset
        </button>
        <button className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="wg-list">
        {WIDGET_TYPES.map(type => {
          const info = WIDGET_INFO[type]
          const Icon = info.icon
          return (
            <div className="wg-item" key={type}>
              <span className="wg-icon">
                <Icon size={18} />
              </span>
              <div className="wg-text">
                <strong>{info.name}</strong>
                <small>{info.description}</small>
              </div>
              <div className="wg-add">
                <button className="pill-btn" onClick={() => add(type, 'small')} aria-label={`Add small ${info.name} widget`}>
                  <Plus size={12} /> Small
                </button>
                <button className="pill-btn" onClick={() => add(type, 'medium')} aria-label={`Add medium ${info.name} widget`}>
                  <Plus size={12} /> Medium
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </Glass>,
    document.body,
  )
}
