import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, Copy, OctagonX, RotateCw, Search, Zap } from 'lucide-react'
import { api } from '../api'
import type { ProcessInfo } from '../api/types'
import type { MenuItem } from '../components/ContextMenu'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { formatBytes, formatUptime } from '../lib/format'

const POLL_MS = 2500
/** Rendering hundreds of rows every poll isn't needed; search narrows the rest. */
const MAX_ROWS = 300

type SortKey = 'name' | 'pid' | 'cpu' | 'memory' | 'threads' | 'user'

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Process' },
  { key: 'pid', label: 'PID', numeric: true },
  { key: 'user', label: 'User' },
  { key: 'cpu', label: '% CPU', numeric: true },
  { key: 'memory', label: 'Memory', numeric: true },
  { key: 'threads', label: 'Threads', numeric: true },
]

const owner = (p: ProcessInfo) => (p.container ? `Container ${p.container}` : p.unit ? p.unit.replace(/\.service$/, '') : '')

/** Every process on the server, like htop: CPU, memory, owner, and End Process. */
export function ProcessesView({ tabs }: { tabs: ReactNode }) {
  const [list, setList] = useState<ProcessInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showKernel, setShowKernel] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'cpu', desc: true })
  const [selected, setSelected] = useState<number | null>(null)
  const { show } = useContextMenu()

  const refresh = useCallback(async () => {
    try {
      setList(await api.listProcesses())
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const selectedProcess = list?.find(p => p.pid === selected) ?? null

  const processItems = (p: ProcessInfo | null): MenuItem[] => {
    const unsafe = !p || p.pid <= 2 || !!p.kernel
    return [
      {
        label: p ? `End ${p.name}` : 'End Process',
        icon: OctagonX,
        disabled: unsafe,
        danger: true,
        confirm: 'Click Again to End',
        onSelect: () => p && void api.killProcess(p.pid).then(refresh),
      },
      {
        label: 'Force Quit',
        icon: Zap,
        disabled: unsafe,
        danger: true,
        confirm: 'Click Again to Force Quit',
        onSelect: () => p && void api.killProcess(p.pid, true).then(refresh),
      },
      'separator',
      { label: 'Copy Command Line', icon: Copy, disabled: !p?.command, onSelect: () => p?.command && void copyText(p.command) },
      { label: 'Copy PID', icon: Copy, disabled: !p, onSelect: () => p && void copyText(String(p.pid)) },
    ]
  }

  useAppMenus(() => [
    {
      label: 'View',
      items: [
        { label: 'Show Kernel Threads', checked: showKernel, onSelect: () => setShowKernel(v => !v) },
        { label: 'Refresh', icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
    { label: 'Process', items: processItems(selectedProcess) },
  ])

  const all = list ?? []
  const q = query.trim().toLowerCase()
  const matching = all
    .filter(p => showKernel || !p.kernel)
    .filter(p => !q || String(p.pid) === q || [p.name, p.command, p.user, p.unit, p.container].some(v => v?.toLowerCase().includes(q)))
    .sort((a, b) => {
      const va = a[sort.key] ?? ''
      const vb = b[sort.key] ?? ''
      const order = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)
      return sort.desc ? -order : order
    })
  const visible = matching.slice(0, MAX_ROWS)
  const totalCpu = all.reduce((sum, p) => sum + p.cpu, 0)
  const totalThreads = all.reduce((sum, p) => sum + p.threads, 0)
  const now = Date.now() / 1000

  const rowMenu = (e: MouseEvent, p: ProcessInfo) => {
    setSelected(p.pid)
    show(e, processItems(p))
  }

  return (
    <div className="am">
      <WindowToolbar>
        <ToolbarTitle title="System Monitor" subtitle="All Processes" />
        <span className="tb-spacer" />
        {tabs}
        <span className="tb-spacer" />
          <label className="tb-search">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, PID, user, service…" />
          </label>
      </WindowToolbar>
      <div className="am-summary">
        <div>
          <small>Processes</small>
          <strong>{list ? all.filter(p => !p.kernel).length : '—'}</strong>
        </div>
        <div>
          <small>Threads</small>
          <strong>{list ? totalThreads : '—'}</strong>
        </div>
        <div>
          <small>CPU (all processes)</small>
          <strong>
            {list ? totalCpu.toFixed(0) : '—'}
            <em>% of one core</em>
          </strong>
        </div>
      </div>

      <div className="am-table" role="table">
        <div className="ps-row am-head" role="row">
          {COLUMNS.map(col => (
            <button
              key={col.key}
              className={`${col.numeric ? 'am-num' : ''} ${sort.key === col.key ? 'is-sorted' : ''}`}
              onClick={() =>
                setSort(s => ({ key: col.key, desc: s.key === col.key ? !s.desc : col.key !== 'name' && col.key !== 'user' }))
              }
              aria-sort={sort.key === col.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
            >
              {col.label}
              {sort.key === col.key && <ChevronDown size={12} className={sort.desc ? '' : 'flip'} />}
            </button>
          ))}
          <span>Service / Container</span>
        </div>
        <div className="am-body">
          {loadError && <p className="am-empty form-error">Couldn’t read processes: {loadError}</p>}
          {!list && !loadError && <p className="am-empty">Loading processes…</p>}
          {list && visible.length === 0 && <p className="am-empty">No processes match.</p>}
          {visible.map(p => (
            <div
              key={p.pid}
              role="row"
              className={`ps-row ${p.pid === selected ? 'is-selected' : ''}`}
              onClick={() => setSelected(p.pid)}
              onContextMenu={e => rowMenu(e, p)}
              title={`${p.command ?? p.name}\nRunning for ${formatUptime(Math.max(0, now - p.started))}`}
            >
              <span className="am-name">
                <i className={`am-state ${p.state === 'R' ? 'state-running' : p.state === 'Z' ? 'state-dead' : ''}`} />
                <span className="am-name-text">{p.name}</span>
              </span>
              <span className="am-num">{p.pid}</span>
              <span className="am-name-text pv-user">{p.user}</span>
              <span className="am-num">
                <i className="am-bar" style={{ width: `${Math.min(100, p.cpu)}%` }} />
                {p.cpu.toFixed(1)}
              </span>
              <span className="am-num">{formatBytes(p.memory)}</span>
              <span className="am-num">{p.threads}</span>
              <span className="am-name-text pv-user">{owner(p)}</span>
            </div>
          ))}
          {matching.length > MAX_ROWS && (
            <p className="am-empty">
              Showing the top {MAX_ROWS} of {matching.length}. Search to find the others.
            </p>
          )}
        </div>
      </div>
      <div className="pv-filters ps-foot">
        <label className="pv-toggle">
          <input type="checkbox" checked={showKernel} onChange={e => setShowKernel(e.target.checked)} /> Show kernel threads
        </label>
      </div>
    </div>
  )
}
