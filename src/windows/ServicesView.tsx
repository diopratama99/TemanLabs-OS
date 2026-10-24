import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { AppWindow, ChevronDown, Copy, FileText, Lock, Play, Power, PowerOff, RotateCw, Search, Square } from 'lucide-react'
import { api } from '../api'
import type { InstalledApp, ServiceAction, ServiceInfo } from '../api/types'
import type { MenuItem } from '../components/ContextMenu'
import { LogsPane } from '../components/LogsPane'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { formatBytes, formatUptime } from '../lib/format'

const POLL_MS = 3000

type Filter = 'running' | 'all' | 'failed' | 'stopped'
type SortKey = 'name' | 'cpu' | 'memory' | 'since'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'running', label: 'Running' },
  { id: 'failed', label: 'Failed' },
  { id: 'stopped', label: 'Stopped' },
  { id: 'all', label: 'All' },
]

const isRunning = (s: ServiceInfo) => s.active === 'active' || s.active === 'activating' || s.active === 'reloading'
const enabledAtBoot = (s: ServiceInfo) => s.enabled === 'enabled' || s.enabled === 'enabled-runtime' || s.enabled === 'alias'
const shortName = (unit: string) => unit.replace(/\.service$/, '')

function statusLabel(s: ServiceInfo) {
  if (s.active === 'active') return s.sub === 'running' ? 'Running' : s.sub === 'exited' ? 'Done' : s.sub
  if (s.active === 'failed') return 'Failed'
  if (s.active === 'activating') return 'Starting…'
  if (s.active === 'deactivating') return 'Stopping…'
  return 'Stopped'
}

interface Props {
  apps: InstalledApp[]
  onOpenApp: (app: InstalledApp) => void
  tabs: ReactNode
}

/** systemd services: status, resource use, start/stop, start at boot, and logs. */
export function ServicesView({ apps, onOpenApp, tabs }: Props) {
  const [list, setList] = useState<ServiceInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('running')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const [selected, setSelected] = useState<string | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const { show } = useContextMenu()

  const refresh = useCallback(async () => {
    try {
      setList(await api.listServices())
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

  const act = async (svc: ServiceInfo, action: ServiceAction) => {
    setBusy(b => new Set(b).add(svc.unit))
    try {
      await api.serviceAction(svc.unit, action)
    } finally {
      setBusy(b => {
        const next = new Set(b)
        next.delete(svc.unit)
        return next
      })
      await refresh()
    }
  }

  const appFor = (svc: ServiceInfo) => apps.find(a => a.unit === svc.unit)
  const selectedService = list?.find(s => s.unit === selected) ?? null

  const serviceItems = (svc: ServiceInfo | null): MenuItem[] => {
    const running = !!svc && isRunning(svc)
    const locked = !!svc?.protected
    const disabled = !svc || busy.has(svc.unit)
    const app = svc ? appFor(svc) : undefined
    return [
      { label: 'Start', icon: Play, disabled: disabled || running, onSelect: () => svc && void act(svc, 'start') },
      {
        label: locked ? 'Stop (protected)' : 'Stop',
        icon: locked ? Lock : Square,
        disabled: disabled || !running || locked,
        confirm: 'Click Again to Stop',
        onSelect: () => svc && void act(svc, 'stop'),
      },
      {
        label: 'Restart',
        icon: RotateCw,
        disabled: disabled || svc?.unit === 'temanlabsos.service',
        onSelect: () => svc && void act(svc, 'restart'),
      },
      'separator',
      svc && enabledAtBoot(svc)
        ? {
            label: 'Don’t Start at Boot',
            icon: PowerOff,
            disabled: disabled || locked,
            onSelect: () => svc && void act(svc, 'disable'),
          }
        : {
            label: 'Start at Boot',
            icon: Power,
            disabled: disabled || svc?.enabled === 'static' || svc?.enabled === 'masked',
            onSelect: () => svc && void act(svc, 'enable'),
          },
      'separator',
      {
        label: 'Show Logs',
        icon: FileText,
        disabled: !svc,
        onSelect: () => {
          if (svc) setSelected(svc.unit)
          setLogsOpen(true)
        },
      },
      ...(app ? [{ label: `Open ${app.name}`, icon: AppWindow, onSelect: () => onOpenApp(app) }] : []),
      { label: 'Copy Service Name', icon: Copy, disabled: !svc, onSelect: () => svc && void copyText(svc.unit) },
    ]
  }

  useAppMenus(() => [
    {
      label: 'View',
      items: [
        ...FILTERS.map(f => ({ label: `${f.label} Services`, checked: filter === f.id, onSelect: () => setFilter(f.id) })),
        'separator',
        { label: 'Show Logs', checked: logsOpen, onSelect: () => setLogsOpen(o => !o) },
        { label: 'Refresh', icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
    { label: 'Service', items: serviceItems(selectedService) },
  ])

  const all = list ?? []
  const q = query.trim().toLowerCase()
  const visible = all
    .filter(s =>
      filter === 'all'
        ? true
        : filter === 'running'
          ? isRunning(s)
          : filter === 'failed'
            ? s.active === 'failed'
            : !isRunning(s) && s.active !== 'failed',
    )
    .filter(s => !q || s.unit.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    .sort((a, b) => {
      const order =
        sort.key === 'name'
          ? a.unit.localeCompare(b.unit)
          : sort.key === 'cpu'
            ? a.cpu - b.cpu
            : sort.key === 'memory'
              ? (a.memory ?? 0) - (b.memory ?? 0)
              : (a.since ?? Infinity) - (b.since ?? Infinity)
      return sort.desc ? -order : order
    })

  const header = (key: SortKey, label: string, numeric = false) => (
    <button
      className={`${numeric ? 'am-num' : ''} ${sort.key === key ? 'is-sorted' : ''}`}
      onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      {sort.key === key && <ChevronDown size={12} className={sort.desc ? '' : 'flip'} />}
    </button>
  )

  const now = Date.now() / 1000
  const failed = all.filter(s => s.active === 'failed').length

  const rowMenu = (e: MouseEvent, svc: ServiceInfo) => {
    setSelected(svc.unit)
    show(e, serviceItems(svc))
  }

  return (
    <div className="am">
      <WindowToolbar>
        <ToolbarTitle title="System Monitor" subtitle="Services" />
        <span className="tb-spacer" />
        {tabs}
        <span className="tb-spacer" />
          <label className="tb-search">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search services" />
          </label>
      </WindowToolbar>
      <div className="am-summary">
        <div>
          <small>Running</small>
          <strong>
            {list ? all.filter(isRunning).length : '—'}
            <em>/{all.length} services</em>
          </strong>
        </div>
        <button className={`sv-failed ${failed ? 'has-failed' : ''}`} onClick={() => setFilter('failed')} disabled={!failed}>
          <small>Failed</small>
          <strong>{list ? failed : '—'}</strong>
        </button>
        <div>
          <small>Start at boot</small>
          <strong>{list ? all.filter(enabledAtBoot).length : '—'}</strong>
        </div>
      </div>

      <div className="pv-filters">
        <div className="segmented sv-filter">
          {FILTERS.map(f => (
            <button key={f.id} className={filter === f.id ? 'is-active' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="am-table" role="table">
        <div className="sv-row am-head" role="row">
          {header('name', 'Service')}
          <span>Status</span>
          <span>At Boot</span>
          {header('cpu', '% CPU', true)}
          {header('memory', 'Memory', true)}
          {header('since', 'Running For', true)}
        </div>
        <div className="am-body">
          {loadError && <p className="am-empty form-error">Couldn’t read services: {loadError}</p>}
          {!list && !loadError && <p className="am-empty">Loading services…</p>}
          {list && visible.length === 0 && <p className="am-empty">No services match.</p>}
          {visible.map(svc => {
            const app = appFor(svc)
            return (
              <div
                key={svc.unit}
                role="row"
                className={`sv-row ${svc.unit === selected ? 'is-selected' : ''} ${isRunning(svc) ? '' : 'is-stopped'}`}
                onClick={() => setSelected(svc.unit)}
                onDoubleClick={() => {
                  setSelected(svc.unit)
                  setLogsOpen(true)
                }}
                onContextMenu={e => rowMenu(e, svc)}
                title={svc.unit}
              >
                <span className="sv-name">
                  <strong className="am-name-text">
                    {svc.description || shortName(svc.unit)}
                    {svc.protected && <Lock size={11} className="sv-lock" aria-label="Protected" />}
                  </strong>
                  <small className="am-name-text">
                    {shortName(svc.unit)}
                    {app ? ` · ${app.name}` : ''}
                  </small>
                </span>
                <span>
                  <i className={`sv-status status-${svc.active}`}>
                    {busy.has(svc.unit) ? <RotateCw size={10} className="spin" /> : null} {statusLabel(svc)}
                  </i>
                </span>
                <span className="sv-boot">{enabledAtBoot(svc) ? 'Yes' : svc.enabled === 'static' ? 'Auto' : svc.enabled ? 'No' : '—'}</span>
                <span className="am-num">{isRunning(svc) ? svc.cpu.toFixed(1) : '—'}</span>
                <span className="am-num">{svc.memory ? formatBytes(svc.memory) : '—'}</span>
                <span className="am-num">{svc.since && isRunning(svc) ? formatUptime(Math.max(0, now - svc.since)) : '—'}</span>
              </div>
            )
          })}
        </div>
      </div>

      {logsOpen && (
        <LogsPane
          title={selectedService ? `Logs — ${shortName(selectedService.unit)}` : 'Logs'}
          source={selectedService?.unit ?? null}
          load={api.serviceLogs}
          emptyText="Select a service to see its logs."
          onClose={() => setLogsOpen(false)}
        />
      )}
    </div>
  )
}
