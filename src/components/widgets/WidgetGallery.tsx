import { createPortal } from 'react-dom'
import { Plus, RotateCcw } from 'lucide-react'
import { useWidgets } from '../../hooks/useWidgets'
import { WIDGET_INFO, WIDGET_TYPES } from '../../lib/widgets'
import { Glass } from '../Glass'
import { tr } from '../../lib/i18n'

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
      aria-label={tr('Widget gallery')}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="wg-head">
        <div>
          <strong>{tr('Widgets')}</strong>
          <small>{tr('Add widgets below. Drag widgets on the desktop to rearrange them, or press − to remove.')}</small>
        </div>
        <button className="btn" onClick={reset}>
          <RotateCcw size={13} /> {tr('Reset')}
        </button>
        <button className="btn btn-primary" onClick={onDone}>
          {tr('Done')}
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
                <button className="pill-btn" onClick={() => add(type, 'small')} aria-label={tr('Add small {0} widget', info.name)}>
                  <Plus size={12} /> {tr('Small')}
                </button>
                <button className="pill-btn" onClick={() => add(type, 'medium')} aria-label={tr('Add medium {0} widget', info.name)}>
                  <Plus size={12} /> {tr('Medium')}
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
