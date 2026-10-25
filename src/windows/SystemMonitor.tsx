import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Play,
  RotateCw,
  Search,
  Square,
} from 'lucide-react'
import { api } from '../api'
import type { ContainerInfo, ContainerSample, InstalledApp, SystemStats } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import { LogsPane } from '../components/LogsPane'
import type { MenuItem } from '../components/ContextMenu'
import { useAppMenus } from '../lib/appMenus'
import { hasWebUI } from '../lib/apps'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { formatBytes, formatSpeed } from '../lib/format'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { PortsView } from './PortsView'
import { HistoryView } from './HistoryView'
import { ProcessesView } from './ProcessesView'
import { ServicesView } from './ServicesView'
import { tr } from '../lib/i18n'

const POLL_MS = 2500

type SortKey = 'name' | 'cpu' | 'mem' | 'netRx' | 'netTx' | 'block' | 'pids'
type Action = 'start' | 'stop' | 'restart'

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: tr('Name') },
  { key: 'cpu', label: tr('% CPU'), numeric: true },
  { key: 'mem', label: tr('Memory'), numeric: true },
  { key: 'netRx', label: tr('Net ↓'), numeric: true },
  { key: 'netTx', label: tr('Net ↑'), numeric: true },
  { key: 'block', label: tr('Disk R / W'), numeric: true },
  { key: 'pids', label: tr('PIDs'), numeric: true },
]

const sortValue = (c: { name: string; stats: ContainerSample | null }, key: SortKey): number | string => {
  if (key === 'name') return c.name.toLowerCase()
  const s = c.stats
  if (!s) return -1
  switch (key) {
    case 'cpu':
      return s.cpu
    case 'mem':
      return s.memUsed
    case 'netRx':
      return s.netRx
    case 'netTx':
      return s.netTx
    case 'block':
      return s.blockRead + s.blockWrite
    case 'pids':
      return s.pids
  }
}

/** Sums the samples of a group's containers (null when none are sampled). */
function sumStats(list: ContainerInfo[]): ContainerSample | null {
  const sampled = list.map(c => c.stats).filter((s): s is ContainerSample => !!s)
  if (sampled.length === 0) return null
  return sampled.reduce((a, s) => ({
    cpu: a.cpu + s.cpu,
    memUsed: a.memUsed + s.memUsed,
    memLimit: Math.max(a.memLimit, s.memLimit),
    netRx: a.netRx + s.netRx,
    netTx: a.netTx + s.netTx,
    blockRead: a.blockRead + s.blockRead,
    blockWrite: a.blockWrite + s.blockWrite,
    pids: a.pids + s.pids,
  }))
}

interface Props {
  apps: InstalledApp[]
  stats: SystemStats | null
  onOpenApp: (app: InstalledApp) => void
}

type Tab = 'containers' | 'services' | 'processes' | 'ports' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'containers', label: tr('Containers') },
  { id: 'services', label: tr('Services') },
  { id: 'processes', label: tr('Processes') },
  { id: 'ports', label: tr('Ports') },
  { id: 'history', label: tr('History') },
]

/** System Monitor: Docker containers (live resource use, logs, controls) and listening ports. */
export function SystemMonitor(props: Props) {
  const [tab, setTab] = useState<Tab>('containers')
  const tabs = (
    <div className="tb-segmented am-tabs">
      {TABS.map(t => (
        <button key={t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
  switch (tab) {
    case 'services':
      return <ServicesView apps={props.apps} onOpenApp={props.onOpenApp} tabs={tabs} />
    case 'processes':
      return <ProcessesView tabs={tabs} />
    case 'ports':
      return <PortsView apps={props.apps} onOpenApp={props.onOpenApp} tabs={tabs} />
    case 'history':
      return <HistoryView tabs={tabs} />
    default:
      return <ContainersView {...props} tabs={tabs} />
  }
}

function ContainersView({ apps, stats, onOpenApp, tabs }: Props & { tabs: ReactNode }) {
  const [containers, setContainers] = useState<ContainerInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'cpu', desc: true })
  const [grouped, setGrouped] = useState(true)
  const [showStopped, setShowStopped] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const { show } = useContextMenu()

  const refresh = useCallback(async () => {
    try {
      setContainers(await api.listContainers())
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

  const appsById = useMemo(() => new Map(apps.map(a => [a.id, a])), [apps])
  const selectedContainer = containers?.find(c => c.id === selected) ?? null

  const act = async (c: ContainerInfo, action: Action) => {
    setBusy(b => new Set(b).add(c.id))
    try {
      await api.containerAction(c.id, action)
    } finally {
      setBusy(b => {
        const next = new Set(b)
        next.delete(c.id)
        return next
      })
      await refresh()
    }
  }

  const containerItems = (c: ContainerInfo | null): MenuItem[] => {
    const running = c?.state === 'running'
    const app = c ? appsById.get(c.appId) : undefined
    const disabled = !c || busy.has(c.id)
    return [
      { label: tr('Start'), icon: Play, disabled: disabled || running, onSelect: () => c && void act(c, 'start') },
      { label: tr('Stop'), icon: Square, disabled: disabled || !running, onSelect: () => c && void act(c, 'stop') },
      { label: tr('Restart'), icon: RotateCw, disabled: disabled || !running, onSelect: () => c && void act(c, 'restart') },
      'separator',
      {
        label: tr('Show Logs'),
        icon: FileText,
        disabled: !c,
        onSelect: () => {
          if (c) setSelected(c.id)
          setLogsOpen(true)
        },
      },
      {
        label: tr('Open Web UI'),
        icon: ExternalLink,
        disabled: !app || !hasWebUI(app),
        onSelect: () => app && onOpenApp(app),
      },
      { label: tr('Copy Container ID'), icon: Copy, disabled: !c, onSelect: () => c && void copyText(c.id) },
    ]
  }

  const rowMenu = (e: MouseEvent, c: ContainerInfo) => {
    setSelected(c.id)
    show(e, containerItems(c))
  }

  useAppMenus(() => [
    {
      label: tr('View'),
      items: [
        { label: tr('Group by App'), checked: grouped, onSelect: () => setGrouped(g => !g) },
        { label: tr('Show Stopped Containers'), checked: showStopped, onSelect: () => setShowStopped(s => !s) },
        { label: tr('Show Logs'), checked: logsOpen, onSelect: () => setLogsOpen(o => !o) },
        'separator',
        { label: tr('Refresh'), icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
    { label: tr('Container'), items: containerItems(selectedContainer) },
  ])

  // ----- Rows -----
  const q = query.trim().toLowerCase()
  const visible = (containers ?? []).filter(
    c =>
      (showStopped || c.state === 'running') &&
      (!q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || c.appId.toLowerCase().includes(q)),
  )
  const compare = (a: { name: string; stats: ContainerSample | null }, b: { name: string; stats: ContainerSample | null }) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    const order = va < vb ? -1 : va > vb ? 1 : 0
    return sort.desc ? -order : order
  }

  const byApp = new Map<string, ContainerInfo[]>()
  for (const c of visible) byApp.set(c.appId, [...(byApp.get(c.appId) ?? []), c])
  const groups = [...byApp].map(([appId, list]) => {
    const app = appsById.get(appId)
    return { appId, name: app?.name ?? appId, app, list: [...list].sort(compare), stats: sumStats(list) }
  })

  const running = (containers ?? []).filter(c => c.state === 'running')
  const totals = sumStats(running)
  const cores = stats?.cpu.cores ?? 1
  const hostMemory = stats?.memory.total ?? 0

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' }))

  const statCells = (s: ContainerSample | null) => (
    <>
      <span className="am-num">
        {s ? (
          <>
            <i className="am-meter">
              <i className="am-bar" style={{ width: `${Math.min(100, s.cpu / cores)}%` }} />
            </i>
            {s.cpu.toFixed(1)}
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="am-num">
        {s ? (
          <>
            <i className="am-meter">
              <i className="am-bar am-bar-mem" style={{ width: `${hostMemory ? Math.min(100, (s.memUsed / hostMemory) * 100) : 0}%` }} />
            </i>
            {formatBytes(s.memUsed)}
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="am-num">{s ? formatSpeed(s.netRx) : '—'}</span>
      <span className="am-num">{s ? formatSpeed(s.netTx) : '—'}</span>
      <span className="am-num">{s ? `${formatBytes(s.blockRead, 0)} / ${formatBytes(s.blockWrite, 0)}` : '—'}</span>
      <span className="am-num">{s ? s.pids : '—'}</span>
    </>
  )

  const containerRow = (c: ContainerInfo, indent: boolean) => (
    <div
      key={c.id}
      role="row"
      aria-selected={c.id === selected}
      className={`am-row ${c.id === selected ? 'is-selected' : ''} ${c.state !== 'running' ? 'is-stopped' : ''}`}
      onClick={() => setSelected(c.id)}
      onDoubleClick={() => {
        setSelected(c.id)
        setLogsOpen(true)
      }}
      onContextMenu={e => rowMenu(e, c)}
      title={`${c.image}\n${c.status}${c.ports.length ? `\n${c.ports.join(', ')}` : ''}`}
    >
      <span className={`am-name ${indent ? 'is-child' : ''}`}>
        <i className={`am-state state-${c.state}`} />
        <span className="am-name-text">{c.name}</span>
        {busy.has(c.id) && <RotateCw size={11} className="spin" />}
      </span>
      {statCells(c.stats)}
    </div>
  )

  return (
    <div className="am">
      <WindowToolbar>
        <ToolbarTitle title={tr('System Monitor')} subtitle={tr('Containers')} />
        <span className="tb-spacer" />
        {tabs}
        <span className="tb-spacer" />
          <label className="tb-search">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Search containers')} />
          </label>
      </WindowToolbar>
      <div className="am-summary">
        <div>
          <small>{tr('Containers')}</small>
          <strong>
            {running.length}
            <em>/{containers?.length ?? 0} {tr('running')}</em>
          </strong>
        </div>
        <div>
          <small>CPU</small>
          <strong>
            {totals ? (totals.cpu / cores).toFixed(1) : '—'}
            <em>{tr('% of')} {cores} {tr('cores')}</em>
          </strong>
        </div>
        <div>
          <small>{tr('Memory')}</small>
          <strong>
            {totals ? formatBytes(totals.memUsed) : '—'}
            <em>{hostMemory ? tr(' of {0}', formatBytes(hostMemory, 0)) : ''}</em>
          </strong>
        </div>
        <div>
          <small>{tr('Network')}</small>
          <strong className="am-net">
            <ArrowDown size={12} /> {totals ? formatSpeed(totals.netRx) : '—'}
            <ArrowUp size={12} /> {totals ? formatSpeed(totals.netTx) : '—'}
          </strong>
        </div>
      </div>

      <div className="am-table" role="table">
        <div className="am-row am-head" role="row">
          {COLUMNS.map(col => (
            <button
              key={col.key}
              role="columnheader"
              className={`${col.numeric ? 'am-num' : ''} ${sort.key === col.key ? 'is-sorted' : ''}`}
              onClick={() => toggleSort(col.key)}
              aria-sort={sort.key === col.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
            >
              {col.label}
              {sort.key === col.key && (sort.desc ? <ChevronDown size={12} /> : <ChevronDown size={12} className="flip" />)}
            </button>
          ))}
        </div>
        <div className="am-body">
          {loadError && <p className="am-empty form-error">{tr('Couldn’t read containers:')} {loadError}</p>}
          {!containers && !loadError && <p className="am-empty">{tr('Loading containers…')}</p>}
          {containers && visible.length === 0 && <p className="am-empty">{tr('No containers match.')}</p>}
          {grouped
            ? [...groups]
                .sort((a, b) => compare({ name: a.name, stats: a.stats }, { name: b.name, stats: b.stats }))
                .map(group =>
                  group.list.length === 1 && group.list[0].name === group.appId ? (
                    containerRow(group.list[0], false)
                  ) : (
                    <div key={group.appId} role="rowgroup">
                      <div
                        role="row"
                        className="am-row am-group"
                        onClick={() =>
                          setCollapsed(set => {
                            const next = new Set(set)
                            if (next.has(group.appId)) next.delete(group.appId)
                            else next.add(group.appId)
                            return next
                          })
                        }
                      >
                        <span className="am-name">
                          {collapsed.has(group.appId) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          {group.app && <AppIcon icon={group.app.icon} iconUrl={group.app.iconUrl} color={group.app.color} size={18} />}
                          <span className="am-name-text">{group.name}</span>
                          <small>{group.list.length}</small>
                        </span>
                        {statCells(group.stats)}
                      </div>
                      {!collapsed.has(group.appId) && group.list.map(c => containerRow(c, true))}
                    </div>
                  ),
                )
            : [...visible].sort(compare).map(c => containerRow(c, false))}
        </div>
      </div>

      {logsOpen && (
        <LogsPane
          title={selectedContainer ? tr('Logs — {0}', selectedContainer.name) : tr('Logs')}
          source={selectedContainer?.id ?? null}
          load={api.containerLogs}
          emptyText={tr('Select a container to see its logs.')}
          onClose={() => setLogsOpen(false)}
        />
      )}
    </div>
  )
}

