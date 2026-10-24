import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Plus, X } from 'lucide-react'
import { useClock } from '../../hooks/useClock'
import { formatTime } from '../../lib/media'
import { language, tr } from '../../lib/i18n'
import { WIDGET_INFO, type TodoItem, type WidgetOptions, type WidgetSize } from '../../lib/widgets'
import { Head, type WidgetData } from './WidgetViews'
import { MonthCalendar } from '../MonthCalendar'

/** Saves a widget's own content (a note's text, a list's items). */
export type OnOptions = (patch: Record<string, unknown>) => void

const locale = language === 'id' ? 'id-ID' : 'en-GB'

// ---------- Sticky note ----------

// Typing is saved a moment after it stops (and when the note loses focus), not on every key.
const SAVE_MS = 400

export function NoteWidget({ options, onOptions }: { options: WidgetOptions['note']; onOptions?: OnOptions }) {
  const [text, setText] = useState(options.text)
  const timer = useRef(0)
  // Follows changes made elsewhere (another tab, a reset) while not being typed in.
  useEffect(() => {
    if (!timer.current) setText(options.text)
  }, [options.text])
  const flush = (value: string) => {
    clearTimeout(timer.current)
    timer.current = 0
    if (value !== options.text) onOptions?.({ text: value })
  }
  return (
    <textarea
      className="w-note"
      value={text}
      readOnly={!onOptions}
      placeholder={tr('Write a note…')}
      spellCheck={false}
      aria-label={tr('Sticky note')}
      onChange={e => {
        const value = e.target.value
        setText(value)
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => flush(value), SAVE_MS)
      }}
      onBlur={e => flush(e.target.value)}
      // Right-click keeps the widget's own menu (colours, size); typing doesn't drag the widget.
      onPointerDown={e => e.stopPropagation()}
    />
  )
}

// ---------- To-do ----------

export function TodoWidget({ size, options, onOptions }: { size: WidgetSize; options: WidgetOptions['todo']; onOptions?: OnOptions }) {
  const [draft, setDraft] = useState('')
  const items = options.items
  const shown = options.hideDone ? items.filter(i => !i.done) : items
  const left = items.filter(i => !i.done).length
  const save = (next: TodoItem[]) => onOptions?.({ items: next })
  const add = () => {
    const text = draft.trim()
    if (!text) return
    save([...items, { id: `t${Date.now().toString(36)}`, text, done: false }])
    setDraft('')
  }
  return (
    <div className={`w-todo is-${size}`} onPointerDown={e => e.stopPropagation()}>
      <div className="w-todo-head">
        <strong>{options.title || tr('To-do')}</strong>
        <small>{left === 0 && items.length ? tr('All done') : tr('{0} left', left)}</small>
      </div>
      <ul className="w-todo-list">
        {shown.map(item => (
          <li key={item.id} className={item.done ? 'is-done' : ''}>
            <button
              className="w-check"
              role="checkbox"
              aria-checked={item.done}
              aria-label={item.text}
              disabled={!onOptions}
              onClick={() => save(items.map(i => (i.id === item.id ? { ...i, done: !i.done } : i)))}
            />
            <span>{item.text}</span>
            {onOptions && (
              <button className="w-todo-remove" onClick={() => save(items.filter(i => i.id !== item.id))} aria-label={tr('Remove')}>
                <X size={11} />
              </button>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="w-todo-empty">{tr('Nothing to do.')}</li>}
      </ul>
      {onOptions && (
        <label className="w-todo-add">
          <Plus size={13} />
          <input
            value={draft}
            placeholder={tr('Add an item')}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') add()
              e.stopPropagation()
            }}
          />
        </label>
      )}
    </div>
  )
}

// ---------- Calendar ----------

export function CalendarWidget({ size, options }: { size: WidgetSize; options: WidgetOptions['calendar'] }) {
  const now = useClock()
  const weekday = now.toLocaleDateString(locale, { weekday: 'long' })
  const month = now.toLocaleDateString(locale, { month: 'long' })
  const today = (
    <div className="w-cal-today">
      <span className="w-cal-weekday">{weekday}</span>
      <strong className="w-cal-date">{now.getDate()}</strong>
      <span className="w-sub">
        {month} {now.getFullYear()}
      </span>
    </div>
  )
  if (size === 'small') return today

  return (
    <div className="w-split">
      {today}
      <MonthCalendar date={now} weekStart={options.weekStart} />
    </div>
  )
}

// ---------- Power ----------

const PART_NAME: Record<string, string> = {
  core: tr('Cores'),
  uncore: tr('Graphics'),
  dram: tr('Memory'),
  psys: tr('Platform'),
}

// Scaled with headroom over the recent peak (at least 10 W), so steady draw doesn't fill the box;
// slots without a reading yet are faint, as in the CPU graph.
function PowerBars({ history, count }: { history: number[]; count: number }) {
  const top = Math.max(10, ...history) * 1.25
  const bars = [...Array<number | null>(Math.max(0, count - history.length)).fill(null), ...history.slice(-count)]
  return (
    <div className="bars w-power-bars" aria-hidden>
      {bars.map((v, i) => (
        <i key={i} className={v === null ? 'is-empty' : undefined} style={{ height: `${Math.max(6, ((v ?? 0) / top) * 100)}%` }} />
      ))}
    </div>
  )
}

export function PowerWidget({ size, options, data }: { size: WidgetSize; options: WidgetOptions['power']; data: WidgetData }) {
  const power = data.stats.power
  const head = <Head icon={WIDGET_INFO.power.icon} title={WIDGET_INFO.power.name} />
  if (!power) {
    return (
      <>
        {head}
        <p className="w-sub w-power-none">{tr('This server doesn’t report its power draw.')}</p>
      </>
    )
  }
  const source = power.source === 'battery' ? tr('From the battery') : tr('CPU and memory')
  const big = (
    <div className="w-big">
      {power.watts < 10 ? power.watts.toFixed(1) : Math.round(power.watts)}
      <small>W</small>
    </div>
  )
  const parts = (power.parts ?? []).filter(p => PART_NAME[p.name])
  if (size === 'small') {
    return (
      <>
        {head}
        {big}
        <div className="w-sub">{source}</div>
        {options.graph && <PowerBars history={data.history.power} count={18} />}
      </>
    )
  }
  return (
    <>
      {head}
      <div className="w-split">
        <div className="w-col">
          {big}
          <div className="w-sub">{source}</div>
          {options.parts && parts.length > 0 && (
            <dl className="w-details">
              {parts.map(p => [<dt key={`t${p.name}`}>{PART_NAME[p.name]}</dt>, <dd key={`d${p.name}`}>{p.watts.toFixed(1)} W</dd>])}
            </dl>
          )}
        </div>
        {options.graph && (
          <div className="w-graph">
            <PowerBars history={data.history.power} count={30} />
          </div>
        )}
      </div>
    </>
  )
}

// ---------- Server ----------

function uptimeText(seconds: number) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : formatTime(seconds)
}

export function ServerWidget({ size, options, data }: { size: WidgetSize; options: WidgetOptions['server']; data: WidgetData }) {
  const { stats } = data
  const load = stats.load
  const cores = stats.cpu.cores || 1
  return (
    <>
      <Head icon={WIDGET_INFO.server.icon} title={WIDGET_INFO.server.name} />
      <strong className="w-server-name">{stats.hostname}</strong>
      <div className="w-sub">{stats.os}</div>
      {size === 'medium' && <div className="w-sub">{tr('Kernel {0}', stats.kernel)}</div>}
      <div className="w-server-up">
        <span>{tr('Up {0}', uptimeText(stats.uptime))}</span>
      </div>
      {options.load && load && (
        <div className="w-load" title={tr('Load average over 1, 5 and 15 minutes ({0} cores)', cores)}>
          {load.map((l, i) => (
            <div key={i} className="w-load-item">
              <i style={{ '--h': `${Math.min(100, (l / cores) * 100)}%` } as CSSProperties} className={l > cores ? 'is-high' : ''} />
              <small>{l.toFixed(2)}</small>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
