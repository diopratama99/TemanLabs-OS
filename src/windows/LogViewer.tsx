import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertOctagon, CircleAlert, Copy, Cpu, KeyRound, List, Pause, Play, RotateCw, Search, Trash2, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import type { LogEntry, LogView } from '../api/types'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { WindowToolbar, ToolbarTitle } from '../lib/windowChrome'
import { tr } from '../lib/i18n'

const VIEWS: { id: LogView; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: tr('All Messages'), icon: List },
  { id: 'errors', label: tr('Errors'), icon: AlertOctagon },
  { id: 'warnings', label: tr('Warnings & Errors'), icon: CircleAlert },
  { id: 'kernel', label: tr('Kernel'), icon: Cpu },
  { id: 'auth', label: tr('Logins & sudo'), icon: KeyRound },
]

const RANGES = [
  { id: '', label: tr('Latest') },
  { id: '1 hour ago', label: tr('Last hour') },
  { id: 'today', label: tr('Today') },
  { id: 'boot', label: tr('Since restart') },
]

const LIVE_MS = 2000
const MAX_ROWS = 3000
const LEVEL: Record<number, string> = { 0: 'Emergency', 1: 'Alert', 2: 'Critical', 3: 'Error', 4: 'Warning', 5: 'Notice', 6: 'Info', 7: 'Debug' }
const levelClass = (p: number) => (p <= 3 ? 'is-error' : p === 4 ? 'is-warning' : p >= 7 ? 'is-debug' : '')
const time = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Log Viewer: the server's log (systemd journal), by category. */
export function LogViewer() {
  const [view, setView] = useState<LogView>('all')
  const [range, setRange] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [unit, setUnit] = useState('')
  const [unitDraft, setUnitDraft] = useState('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const cursor = useRef('')
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const { show } = useContextMenu()

  // Typing in the search box waits for a pause before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 350)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.logs({ view, since: range, q: search, unit, lines: 800 })
      setEntries(res.entries)
      cursor.current = res.cursor
      setError(null)
      pinned.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [view, range, search, unit])

  useEffect(() => {
    setSelected(null)
    void load()
  }, [load])

  // Live: append what's new since the last entry.
  useEffect(() => {
    if (!live) return
    const timer = setInterval(async () => {
      if (!cursor.current) return
      const res = await api.logs({ view, q: search, unit, after: cursor.current }).catch(() => null)
      if (!res || res.entries.length === 0) return
      cursor.current = res.cursor
      setEntries(e => [...e, ...res.entries].slice(-MAX_ROWS))
    }, LIVE_MS)
    return () => clearInterval(timer)
  }, [live, view, search, unit])

  // Stay at the bottom while new lines arrive, unless the user scrolled up to read.
  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [entries])

  useAppMenus(() => [
    {
      label: tr('View'),
      items: [
        ...VIEWS.map(v => ({ label: v.label, icon: v.icon, checked: view === v.id, onSelect: () => setView(v.id) })),
        'separator',
        { label: live ? tr('Pause Live Updates') : tr('Resume Live Updates'), icon: live ? Pause : Play, onSelect: () => setLive(l => !l) },
        { label: tr('Reload'), icon: RotateCw, onSelect: () => void load() },
        { label: tr('Clear'), icon: Trash2, onSelect: () => setEntries([]) },
      ],
    },
  ])

  const current = selected !== null ? entries[selected] : null
  const errors = entries.filter(e => e.priority <= 3).length

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-group">{tr('Reports')}</div>
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`sidebar-item ${view === id && !unit ? 'is-active' : ''}`}
            onClick={() => {
              setView(id)
              setUnit('')
              setUnitDraft('')
            }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
        <div className="sidebar-group">{tr('Service')}</div>
        <label className="sidebar-search">
          <input
            value={unitDraft}
            onChange={e => setUnitDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setUnit(unitDraft.trim())}
            onBlur={() => setUnit(unitDraft.trim())}
            placeholder={tr('e.g. docker.service ⏎')}
            spellCheck={false}
          />
        </label>
      </aside>

      <div className="cn">
        <WindowToolbar>
          <ToolbarTitle title={tr('Log Viewer')} subtitle={unit || VIEWS.find(v => v.id === view)?.label} />
          <span className="tb-spacer" />
          <div className="tb-segmented">
            {RANGES.map(r => (
              <button key={r.id} className={range === r.id ? 'is-active' : ''} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="tb-group">
            <button className={`tb-btn ${live ? 'is-on' : ''}`} onClick={() => setLive(l => !l)} aria-label={live ? tr('Pause') : tr('Live')} title={live ? tr('Pause live updates') : tr('Live updates')}>
              {live ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button className="tb-btn" onClick={() => void load()} aria-label={tr('Reload')} title={tr('Reload')}>
              <RotateCw size={14} className={loading ? 'spin' : ''} />
            </button>
          </div>
          <label className="tb-search">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Search messages')} />
          </label>
        </WindowToolbar>

        <div className="cn-head">
          <span>{tr('Time')}</span>
          <span>{tr('Process')}</span>
          <span>{tr('Message')}</span>
        </div>
        <div
          className="cn-list"
          ref={list}
          onScroll={e => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          {error && <p className="am-empty form-error">{error}</p>}
          {!error && entries.length === 0 && <p className="am-empty">{loading ? tr('Reading the log…') : tr('No messages.')}</p>}
          {entries.map((e, i) => (
            <div
              key={`${e.time}-${i}`}
              className={`cn-row ${levelClass(e.priority)} ${selected === i ? 'is-selected' : ''}`}
              onClick={() => setSelected(i)}
              onContextMenu={ev => {
                setSelected(i)
                show(ev, [
                  { label: tr('Copy Message'), icon: Copy, onSelect: () => void copyText(e.message) },
                  { label: tr('Copy Line'), icon: Copy, onSelect: () => void copyText(`${time(e.time)} ${e.source}: ${e.message}`) },
                  ...(e.unit
                    ? [
                        {
                          label: tr('Show only {0}', e.unit),
                          icon: List,
                          onSelect: () => {
                            setUnit(e.unit!)
                            setUnitDraft(e.unit!)
                          },
                        },
                      ]
                    : []),
                ])
              }}
            >
              <span className="cn-time">{time(e.time)}</span>
              <span className="cn-source">{e.source}</span>
              <span className="cn-msg">{e.message}</span>
            </div>
          ))}
        </div>
        <div className="cn-detail">
          {current ? (
            <>
              <div>
                <strong className={levelClass(current.priority)}>{LEVEL[current.priority] ?? current.priority}</strong> · {current.source}
                {current.pid && ` [${current.pid}]`}
                {current.unit && ` · ${current.unit}`} · {time(current.time)}
              </div>
              <pre>{current.message}</pre>
            </>
          ) : (
            <span>
              {entries.length} {tr('messages')}{errors ? tr(' · {0} errors', errors) : ''}
              {live ? tr(' · live') : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
