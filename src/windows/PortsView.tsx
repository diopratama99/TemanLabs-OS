import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { AppWindow, ChevronDown, Copy, ExternalLink, OctagonX, RotateCw, Search, Square, Zap } from 'lucide-react'
import { api } from '../api'
import type { InstalledApp, ListenPort } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import type { MenuItem } from '../components/ContextMenu'
import { useAppMenus } from '../lib/appMenus'
import { hasWebUI } from '../lib/apps'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

const POLL_MS = 3000

type Filter = 'all' | 'tcp' | 'udp'
type SortKey = 'port' | 'process' | 'app'

const keyOf = (p: ListenPort) => `${p.protocol}:${p.port}`
const isLocalAddress = (a: string) => a.startsWith('127.') || a === '::1'

interface Props {
  apps: InstalledApp[]
  onOpenApp: (app: InstalledApp) => void
  tabs: ReactNode
}

/** Every listening port on the server and who owns it: a process, a container, or both. */
export function PortsView({ apps, onOpenApp, tabs }: Props) {
  const [ports, setPorts] = useState<ListenPort[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [publicOnly, setPublicOnly] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'port', desc: false })
  const [selected, setSelected] = useState<string | null>(null)
  const [check, setCheck] = useState('')
  const { show } = useContextMenu()

  const refresh = useCallback(async () => {
    try {
      setPorts(await api.listPorts())
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

  const appsById = new Map(apps.map(a => [a.id, a]))
  const selectedPort = ports?.find(p => keyOf(p) === selected) ?? null
  const browserUrl = (p: ListenPort) => `${p.port === 443 || p.port === 8443 ? 'https' : 'http'}://${location.hostname}:${p.port}/`

  const portItems = (p: ListenPort | null): MenuItem[] => {
    const app = p?.appId ? appsById.get(p.appId) : undefined
    const web = !!p && p.protocol === 'tcp' && p.public
    const proxy = p?.process === 'docker-proxy'
    return [
      { label: 'Open in Browser', icon: ExternalLink, disabled: !web, onSelect: () => p && window.open(browserUrl(p), '_blank', 'noopener') },
      {
        label: app ? `Open ${app.name}` : 'Open App Window',
        icon: AppWindow,
        disabled: !app || !hasWebUI(app),
        onSelect: () => app && onOpenApp(app),
      },
      'separator',
      { label: 'Copy Address', icon: Copy, disabled: !p, onSelect: () => p && void copyText(`${location.hostname}:${p.port}`) },
      { label: 'Copy Command Line', icon: Copy, disabled: !p?.command, onSelect: () => p?.command && void copyText(p.command) },
      'separator',
      {
        label: p?.container ? `Stop Container ${p.container}` : 'Stop Container',
        icon: Square,
        disabled: !p?.containerId,
        confirm: 'Click Again to Stop',
        onSelect: () => p?.containerId && void api.containerAction(p.containerId, 'stop').then(refresh),
      },
      // docker-proxy belongs to Docker; ending it would break the container's port, not free it.
      {
        label: p?.process ? `End Process ${p.process}` : 'End Process',
        icon: OctagonX,
        disabled: !p?.pid || p.pid === 1 || proxy,
        danger: true,
        confirm: 'Click Again to End',
        onSelect: () => p?.pid && void api.killProcess(p.pid).then(refresh),
      },
      {
        label: 'Force Quit Process',
        icon: Zap,
        disabled: !p?.pid || p.pid === 1 || proxy,
        danger: true,
        confirm: 'Click Again to Force Quit',
        onSelect: () => p?.pid && void api.killProcess(p.pid, true).then(refresh),
      },
    ]
  }

  useAppMenus(() => [
    {
      label: 'View',
      items: [
        { label: 'All Ports', checked: filter === 'all', onSelect: () => setFilter('all') },
        { label: 'TCP Only', checked: filter === 'tcp', onSelect: () => setFilter('tcp') },
        { label: 'UDP Only', checked: filter === 'udp', onSelect: () => setFilter('udp') },
        'separator',
        { label: 'Reachable From Network Only', checked: publicOnly, onSelect: () => setPublicOnly(v => !v) },
        'separator',
        { label: 'Refresh', icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
    { label: 'Port', items: portItems(selectedPort) },
  ])

  const q = query.trim().toLowerCase()
  const ownerName = (p: ListenPort) => (p.appId ? (appsById.get(p.appId)?.name ?? p.container ?? '') : (p.container ?? ''))
  const visible = (ports ?? [])
    .filter(p => (filter === 'all' || p.protocol === filter) && (!publicOnly || p.public))
    .filter(
      p =>
        !q ||
        String(p.port).includes(q) ||
        [p.process, p.command, p.container, ownerName(p), p.user].some(v => v?.toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      const order =
        sort.key === 'port'
          ? a.port - b.port || a.protocol.localeCompare(b.protocol)
          : sort.key === 'process'
            ? (a.process ?? '~').localeCompare(b.process ?? '~')
            : (ownerName(a) || '~').localeCompare(ownerName(b) || '~')
      return sort.desc ? -order : order
    })

  // "Is port N free?" — answered from the same list.
  const checkPort = Number(check)
  const checkHits = checkPort > 0 ? (ports ?? []).filter(p => p.port === checkPort) : []

  const header = (key: SortKey, label: string) => (
    <button
      className={sort.key === key ? 'is-sorted' : ''}
      onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : false }))}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      {sort.key === key && <ChevronDown size={12} className={sort.desc ? '' : 'flip'} />}
    </button>
  )

  const rowMenu = (e: MouseEvent, p: ListenPort) => {
    setSelected(keyOf(p))
    show(e, portItems(p))
  }

  return (
    <div className="am">
      <WindowToolbar>
        <ToolbarTitle title="System Monitor" subtitle="Listening Ports" />
        <span className="tb-spacer" />
        {tabs}
        <span className="tb-spacer" />
          <label className="tb-search">
            <Search size={13} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Port, process, app…" />
          </label>
      </WindowToolbar>
      <div className="am-summary">
        <div>
          <small>Listening</small>
          <strong>
            {ports?.length ?? '—'}
            <em> ports</em>
          </strong>
        </div>
        <div>
          <small>From the network</small>
          <strong>
            {ports ? ports.filter(p => p.public).length : '—'}
            <em> reachable</em>
          </strong>
        </div>
        <div className="pv-check">
          <small>Is a port free?</small>
          <input value={check} onChange={e => setCheck(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="e.g. 8080" inputMode="numeric" />
          {checkPort > 0 && ports && (
            <span className={`pv-verdict ${checkHits.length ? 'is-used' : 'is-free'}`}>
              {checkHits.length
                ? `In use by ${checkHits.map(p => ownerName(p) || p.process || 'unknown').join(', ')}`
                : checkPort > 65535
                  ? 'Not a port'
                  : 'Free'}
            </span>
          )}
        </div>
      </div>

      <div className="pv-filters">
        <div className="segmented">
          {(['all', 'tcp', 'udp'] as Filter[]).map(f => (
            <button key={f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="pv-toggle">
          <input type="checkbox" checked={publicOnly} onChange={e => setPublicOnly(e.target.checked)} /> Reachable from network only
        </label>
      </div>

      <div className="am-table" role="table">
        <div className="pv-row am-head" role="row">
          {header('port', 'Port')}
          <span>Address</span>
          {header('process', 'Process')}
          {header('app', 'App / Container')}
          <span>User</span>
        </div>
        <div className="am-body">
          {loadError && <p className="am-empty form-error">Couldn’t read ports: {loadError}</p>}
          {!ports && !loadError && <p className="am-empty">Scanning ports…</p>}
          {ports && visible.length === 0 && <p className="am-empty">No ports match.</p>}
          {visible.map(p => {
            const app = p.appId ? appsById.get(p.appId) : undefined
            const key = keyOf(p)
            return (
              <div
                key={key}
                role="row"
                className={`pv-row ${key === selected ? 'is-selected' : ''}`}
                onClick={() => setSelected(key)}
                onDoubleClick={() => {
                  if (app && hasWebUI(app)) onOpenApp(app)
                  else if (p.protocol === 'tcp' && p.public) window.open(browserUrl(p), '_blank', 'noopener')
                }}
                onContextMenu={e => rowMenu(e, p)}
                title={p.command}
              >
                <span className="pv-port">
                  <strong>{p.port}</strong>
                  <small>{p.protocol.toUpperCase()}</small>
                  {p.targetPort && p.targetPort !== p.port && <small className="pv-target">→ {p.targetPort}</small>}
                </span>
                <span className="pv-addr">
                  <i className={`pv-badge ${p.public ? 'is-public' : 'is-local'}`}>{p.public ? 'Network' : 'Local only'}</i>
                  <span className="am-name-text">{p.addresses.map(a => (a === '0.0.0.0' || a === '::' ? `${a} (all)` : a)).join(', ')}</span>
                </span>
                <span className="am-name-text">
                  {p.process ?? '—'}
                  {p.pid ? <small className="pv-pid"> {p.pid}</small> : null}
                </span>
                <span className="pv-owner">
                  {app && <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={18} />}
                  <span className="am-name-text">{app?.name ?? p.container ?? (p.addresses.every(isLocalAddress) ? 'System (local)' : 'System')}</span>
                </span>
                <span className="am-name-text pv-user">{p.user ?? '—'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
