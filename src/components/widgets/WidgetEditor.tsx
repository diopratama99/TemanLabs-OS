import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Disk } from '../../api/types'
import { useDismiss } from '../../hooks/useDismiss'
import { useWidgets } from '../../hooks/useWidgets'
import { TIME_ZONES, WIDGET_INFO, type WidgetConfig } from '../../lib/widgets'
import { Glass } from '../Glass'
import { Segmented } from '../Segmented'
import { Switch } from '../Switch'

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
          <Field label="Style">
            <Segmented
              label="Clock style"
              value={o.style}
              options={[
                { value: 'analog', label: 'Analog' },
                { value: 'digital', label: 'Digital' },
              ]}
              onChange={style => set({ style })}
            />
          </Field>
          <Field label="Time zone">
            <select className="we-select" value={o.timeZone} onChange={e => set({ timeZone: e.target.value })}>
              {TIME_ZONES.map(zone => (
                <option key={zone.id} value={zone.id}>
                  {zone.label}
                </option>
              ))}
            </select>
          </Field>
          <Toggle label={o.style === 'analog' ? 'Second hand' : 'Show seconds'} checked={o.seconds} onChange={seconds => set({ seconds })} />
          {o.style === 'digital' && <Toggle label="24-hour time" checked={o.hour24} onChange={hour24 => set({ hour24 })} />}
        </>
      )
      break
    }
    case 'cpu': {
      const o = config.options
      fields = (
        <>
          <Toggle label="Temperature" checked={o.temperature} onChange={temperature => set({ temperature })} />
          <Toggle label="Usage graph" checked={o.graph} onChange={graph => set({ graph })} />
        </>
      )
      break
    }
    case 'memory': {
      const o = config.options
      fields = (
        <>
          <Field label="Style">
            <Segmented
              label="Memory style"
              value={o.display}
              options={[
                { value: 'ring', label: 'Ring' },
                { value: 'bar', label: 'Bar' },
              ]}
              onChange={display => set({ display })}
            />
          </Field>
          <Toggle label="Details" checked={o.details} onChange={details => set({ details })} />
        </>
      )
      break
    }
    case 'apps': {
      const o = config.options
      fields = (
        <>
          <Field label="Show">
            <Segmented
              label="Apps to show"
              value={o.show}
              options={[
                { value: 'running', label: 'Running' },
                { value: 'all', label: 'All apps' },
              ]}
              onChange={show => set({ show })}
            />
          </Field>
          <Toggle label="App icons" checked={o.icons} onChange={icons => set({ icons })} />
        </>
      )
      break
    }
    case 'storage': {
      const o = config.options
      fields = (
        <>
          <Field label="Show">
            <Segmented
              label="Space to show"
              value={o.show}
              options={[
                { value: 'used', label: 'Used' },
                { value: 'free', label: 'Free' },
              ]}
              onChange={show => set({ show })}
            />
          </Field>
          <div className="we-group-label">Disks</div>
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
          <Field label="Units">
            <Segmented
              label="Speed units"
              value={o.units}
              options={[
                { value: 'bytes', label: 'MB/s' },
                { value: 'bits', label: 'Mbps' },
              ]}
              onChange={units => set({ units })}
            />
          </Field>
          <Toggle label="Traffic graph" checked={o.graph} onChange={graph => set({ graph })} />
        </>
      )
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
      aria-label={`Edit ${info.name} widget`}
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
      <Field label="Size">
        <Segmented
          label="Widget size"
          value={config.size}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
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
          Remove Widget
        </button>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Done
        </button>
      </div>
    </Glass>,
    document.body,
  )
}
