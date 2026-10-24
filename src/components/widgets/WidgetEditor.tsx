import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Disk } from '../../api/types'
import { useDismiss } from '../../hooks/useDismiss'
import { useWidgets } from '../../hooks/useWidgets'
import { NOTE_COLORS, TIME_ZONES, WIDGET_INFO, type WidgetConfig } from '../../lib/widgets'
import { Glass } from '../Glass'
import { Segmented } from '../Segmented'
import { Switch } from '../Switch'
import { tr } from '../../lib/i18n'

const WIDTH = 300
const GAP = 14
const EDGE = 8

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="we-field">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="we-toggle">
      <span>{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </label>
  )
}

interface Props {
  config: WidgetConfig
  /** The widget's on-screen box; the editor opens beside it. */
  anchor: DOMRect
  disks: Disk[]
  onClose: () => void
}

/** Per-widget settings, shown as the widget's "Edit" side. */
export function WidgetEditor({ config, anchor, disks, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { setSize, setOptions, remove } = useWidgets()
  useDismiss(ref, true, onClose)
  const info = WIDGET_INFO[config.type]
  const Icon = info.icon
  const set = (patch: Record<string, unknown>) => setOptions(config.id, patch)

  const fitsRight = anchor.right + GAP + WIDTH < window.innerWidth - EDGE
  const left = fitsRight ? anchor.right + GAP : Math.max(EDGE, anchor.left - GAP - WIDTH)
  const top = Math.max(40, Math.min(anchor.top, window.innerHeight - 440))

  let fields: ReactNode
  switch (config.type) {
    case 'clock': {
      const o = config.options
      fields = (
        <>
          <Field label={tr('Style')}>
            <Segmented
              label={tr('Clock style')}
              value={o.style}
              options={[
                { value: 'analog', label: tr('Analog') },
                { value: 'digital', label: tr('Digital') },
              ]}
              onChange={style => set({ style })}
            />
          </Field>
          <Field label={tr('Time zone')}>
            <select className="we-select" value={o.timeZone} onChange={e => set({ timeZone: e.target.value })}>
              {TIME_ZONES.map(zone => (
                <option key={zone.id} value={zone.id}>
                  {zone.label}
                </option>
              ))}
            </select>
          </Field>
          <Toggle label={o.style === 'analog' ? tr('Second hand') : tr('Show seconds')} checked={o.seconds} onChange={seconds => set({ seconds })} />
          {o.style === 'digital' && <Toggle label={tr('24-hour time')} checked={o.hour24} onChange={hour24 => set({ hour24 })} />}
        </>
      )
      break
    }
    case 'cpu': {
      const o = config.options
      fields = (
        <>
          <Toggle label={tr('Temperature')} checked={o.temperature} onChange={temperature => set({ temperature })} />
          <Toggle label={tr('Usage graph')} checked={o.graph} onChange={graph => set({ graph })} />
        </>
      )
      break
    }
    case 'memory': {
      const o = config.options
      fields = (
        <>
          <Field label={tr('Style')}>
            <Segmented
              label={tr('Memory style')}
              value={o.display}
              options={[
                { value: 'ring', label: tr('Ring') },
                { value: 'bar', label: tr('Bar') },
              ]}
              onChange={display => set({ display })}
            />
          </Field>
          <Toggle label={tr('Details')} checked={o.details} onChange={details => set({ details })} />
        </>
      )
      break
    }
    case 'apps': {
      const o = config.options
      fields = (
        <>
          <Field label={tr('Show')}>
            <Segmented
              label={tr('Apps to show')}
              value={o.show}
              options={[
                { value: 'running', label: tr('Running') },
                { value: 'all', label: tr('All apps') },
              ]}
              onChange={show => set({ show })}
            />
          </Field>
          <Toggle label={tr('App icons')} checked={o.icons} onChange={icons => set({ icons })} />
        </>
      )
      break
    }
    case 'storage': {
      const o = config.options
      fields = (
        <>
          <Field label={tr('Show')}>
            <Segmented
              label={tr('Space to show')}
              value={o.show}
              options={[
                { value: 'used', label: tr('Used') },
                { value: 'free', label: tr('Free') },
              ]}
              onChange={show => set({ show })}
            />
          </Field>
          <div className="we-group-label">{tr('Disks')}</div>
          {disks.map(disk => (
            <Toggle
              key={disk.mount}
              label={`${disk.name} (${disk.mount})`}
              checked={!o.hidden.includes(disk.mount)}
              onChange={visible =>
                set({ hidden: visible ? o.hidden.filter(m => m !== disk.mount) : [...o.hidden, disk.mount] })
              }
            />
          ))}
        </>
      )
      break
    }
    case 'network': {
      const o = config.options
      fields = (
        <>
          <Field label={tr('Units')}>
            <Segmented
              label={tr('Speed units')}
              value={o.units}
              options={[
                { value: 'bytes', label: tr('MB/s') },
                { value: 'bits', label: tr('Mbps') },
              ]}
              onChange={units => set({ units })}
            />
          </Field>
          <Toggle label={tr('Traffic graph')} checked={o.graph} onChange={graph => set({ graph })} />
        </>
      )
      break
    }
    case 'note': {
      const o = config.options
      fields = (
        <Field label={tr('Color')}>
          <div className="we-swatches" role="radiogroup" aria-label={tr('Note color')}>
            {NOTE_COLORS.map(c => (
              <button
                key={c.id}
                role="radio"
                aria-checked={o.color === c.id}
                aria-label={c.label}
                title={c.label}
                data-color={c.id}
                className={`we-swatch ${o.color === c.id ? 'is-on' : ''}`}
                onClick={() => set({ color: c.id })}
              />
            ))}
          </div>
        </Field>
      )
      break
    }
    case 'todo': {
      const o = config.options
      fields = (
        <>
          <Field label={tr('Title')}>
            <input className="we-input" value={o.title} onChange={e => set({ title: e.target.value })} />
          </Field>
          <Toggle label={tr('Hide finished items')} checked={o.hideDone} onChange={hideDone => set({ hideDone })} />
        </>
      )
      break
    }
    case 'calendar': {
      const o = config.options
      fields = (
        <Field label={tr('Week starts on')}>
          <Segmented
            label={tr('Week starts on')}
            value={o.weekStart}
            options={[
              { value: 'monday', label: tr('Monday') },
              { value: 'sunday', label: tr('Sunday') },
            ]}
            onChange={weekStart => set({ weekStart })}
          />
        </Field>
      )
      break
    }
    case 'power': {
      const o = config.options
      fields = (
        <>
          <Toggle label={tr('Graph')} checked={o.graph} onChange={graph => set({ graph })} />
          <Toggle label={tr('Breakdown (medium size)')} checked={o.parts} onChange={parts => set({ parts })} />
        </>
      )
      break
    }
    case 'server': {
      const o = config.options
      fields = <Toggle label={tr('Load average')} checked={o.load} onChange={load => set({ load })} />
      break
    }
  }

  return createPortal(
    <Glass
      ref={ref}
      radius={22}
      bezel={14}
      depth={14}
      blur={20}
      className="widget-editor tint-panel"
      style={{ left, top, width: WIDTH }}
      role="dialog"
      aria-label={tr('Edit {0} widget', info.name)}
      onKeyDown={e => e.key === 'Escape' && onClose()}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="we-head">
        <span className="we-icon">
          <Icon size={16} />
        </span>
        <div>
          <strong>{info.name}</strong>
          <small>{info.description}</small>
        </div>
      </div>
      <Field label={tr('Size')}>
        <Segmented
          label={tr('Widget size')}
          value={config.size}
          options={[
            { value: 'small', label: tr('Small') },
            { value: 'medium', label: tr('Medium') },
          ]}
          onChange={size => setSize(config.id, size)}
        />
      </Field>
      {fields}
      <div className="we-foot">
        <button
          className="we-remove"
          onClick={() => {
            remove(config.id)
            onClose()
          }}
        >
          {tr('Remove Widget')}
        </button>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          {tr('Done')}
        </button>
      </div>
    </Glass>,
    document.body,
  )
}
