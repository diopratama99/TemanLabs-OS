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
import { tr } from '../lib/i18n'

const POLL_MS = 2500
/** Rendering hundreds of rows every poll isn't needed; search narrows the rest. */
const MAX_ROWS = 300

type SortKey = 'name' | 'pid' | 'cpu' | 'memory' | 'threads' | 'user'

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: tr('Process') },
  { key: 'pid', label: 'PID', numeric: true },
  { key: 'user', label: tr('User') },
  { key: 'cpu', label: tr('% CPU'), numeric: true },
  { key: 'memory', label: tr('Memory'), numeric: true },
  { key: 'threads', label: tr('Threads'), numeric: true },
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
        label: p ? tr('End {0}', p.name) : tr('End Process'),
        icon: OctagonX,
        disabled: unsafe,
        danger: true,
        confirm: tr('Click Again to End'),
        onSelect: () => p && void api.killProcess(p.pid).then(refresh),
      },
      {
        label: tr('Force Quit'),
        icon: Zap,
        disabled: unsafe,
        danger: true,
        confirm: tr('Click Again to Force Quit'),
        onSelect: () => p && void api.killProcess(p.pid, true).then(refresh),
      },
      'separator',
      { label: tr('Copy Command Line'), icon: Copy, disabled: !p?.command, onSelect: () => p?.command && void copyText(p.command) },
      { label: tr('Copy PID'), icon: Copy, disabled: !p, onSelect: () => p && void copyText(String(p.pid)) },
    ]
  }

  useAppMenus(() => [
    {
      label: tr('View'),
      items: [
        { label: tr('Show Kernel Threads'), checked: showKernel, onSelect: () => setShowKernel(v => !v) },
        { label: tr('Refresh'), icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
    { label: tr('Process'), items: processItems(selectedProcess) },
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
        <ToolbarTitle title={tr('System Monitor')} subtitle={tr('All Processes')} />
        <span className="tb-spacer" />
        {tabs}
        <span className="tb-spacer" />
          <label className="tb-search">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Name, PID, user, service…')} />
          </label>
      </WindowToolbar>
      <div className="am-summary">
        <div>
          <small>{tr('Processes')}</small>
          <strong>{list ? all.filter(p => !p.kernel).length : '—'}</strong>
        </div>
        <div>
          <small>{tr('Threads')}</small>
          <strong>{list ? totalThreads : '—'}</strong>
        </div>
        <div>
          <small>{tr('CPU (all processes)')}</small>
          <strong>
            {list ? totalCpu.toFixed(0) : '—'}
            <em>{tr('% of one core')}</em>
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
          <span>{tr('Service / Container')}</span>
        </div>
        <div className="am-body">
          {loadError && <p className="am-empty form-error">{tr('Couldn’t read processes:')} {loadError}</p>}
          {!list && !loadError && <p className="am-empty">{tr('Loading processes…')}</p>}
          {list && visible.length === 0 && <p className="am-empty">{tr('No processes match.')}</p>}
          {visible.map(p => (
            <div
              key={p.pid}
              role="row"
              className={`ps-row ${p.pid === selected ? 'is-selected' : ''}`}
              onClick={() => setSelected(p.pid)}
              onContextMenu={e => rowMenu(e, p)}
              title={tr("{0}\nRunning for {1}", p.command ?? p.name, formatUptime(Math.max(0, now - p.started)))}
            >
              <span className="am-name">
                <i className={`am-state ${p.state === 'R' ? 'state-running' : p.state === 'Z' ? 'state-dead' : ''}`} />
                <span className="am-name-text">{p.name}</span>
              </span>
              <span className="am-num">{p.pid}</span>
              <span className="am-name-text pv-user">{p.user}</span>
              <span className="am-num">
                <i className="am-meter">
                  <i className="am-bar" style={{ width: `${Math.min(100, p.cpu)}%` }} />
                </i>
                {p.cpu.toFixed(1)}
              </span>
              <span className="am-num">{formatBytes(p.memory)}</span>
              <span className="am-num">{p.threads}</span>
              <span className="am-name-text pv-user">{owner(p)}</span>
            </div>
          ))}
          {matching.length > MAX_ROWS && (
            <p className="am-empty">
              {tr('Showing the top')} {MAX_ROWS} of {matching.length}{tr('. Search to find the others.')}
            </p>
          )}
        </div>
      </div>
      <div className="pv-filters ps-foot">
        <label className="pv-toggle">
          <input type="checkbox" checked={showKernel} onChange={e => setShowKernel(e.target.checked)} /> {tr('Show kernel threads')}
        </label>
      </div>
    </div>
  )
}
