import { useEffect, useState, type MouseEvent } from 'react'
import {
  Briefcase,
  CircleCheck,
  Clapperboard,
  Code,
  Download,
  House,
  LayoutGrid,
  LoaderCircle,
  Network,
  PackagePlus,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { AppSource, AppStatus, CustomAppSpec, InstalledApp, StoreApp } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import { CustomInstall } from '../components/CustomInstall'
import { appMenuItems } from '../lib/appMenu'
import { useAppMenus } from '../lib/appMenus'
import { useContextMenu } from '../lib/contextMenu'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

export type StoreCategory = 'All' | 'Installed' | 'Media' | 'Productivity' | 'Network' | 'Smart Home' | 'Developer'
type Category = StoreCategory

const DISCOVER: { id: Category; icon: LucideIcon }[] = [
  { id: 'All', icon: LayoutGrid },
  { id: 'Media', icon: Clapperboard },
  { id: 'Productivity', icon: Briefcase },
  { id: 'Network', icon: Network },
  { id: 'Smart Home', icon: House },
  { id: 'Developer', icon: Code },
]

const STATUS_LABEL: Record<AppStatus, string> = {
  running: 'Running',
  stopped: 'Stopped',
  installing: 'Installing…',
}

const SOURCE_LABEL: Record<AppSource, string> = {
  temanlabs: 'TemanLabsOS',
  casaos: 'CasaOS',
  compose: 'Docker Compose',
  container: 'Container',
  native: 'Outside Docker',
}

const FEATURED_ID = 'jellyfin'

interface Props {
  apps: InstalledApp[]
  busy: ReadonlySet<string>
  category: Category
  onCategoryChange: (category: Category) => void
  onInstall: (id: string) => void
  onInstallCustom: (spec: CustomAppSpec) => Promise<string>
  onToggle: (app: InstalledApp) => void
  onUninstall: (id: string) => void
  onOpenApp: (app: InstalledApp) => void
}

export function AppCenter({
  apps,
  busy,
  category,
  onCategoryChange: setCategory,
  onInstall,
  onInstallCustom,
  onToggle,
  onUninstall,
  onOpenApp,
}: Props) {
  const [catalog, setCatalog] = useState<StoreApp[]>([])
  const [customOpen, setCustomOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const { show } = useContextMenu()

  // Refetch when apps change so "already installed (CasaOS)" stays accurate.
  const appIds = apps.map(a => a.id).join(',')
  useEffect(() => {
    let alive = true
    api
      .getCatalog()
      .then(list => {
        if (!alive) return
        setCatalog(list)
        setLoadError(null)
      })
      .catch((err: Error) => alive && setLoadError(err.message))
    return () => {
      alive = false
    }
  }, [appIds])

  const installedById = new Map(apps.map(app => [app.id, app]))
  /** The installed app matching a catalog entry: installed here, or the same image installed elsewhere. */
  const installedFor = (item: StoreApp) =>
    installedById.get(item.id) ?? (item.installedAs ? installedById.get(item.installedAs) : undefined)

  const appMenu = (e: MouseEvent, installed: InstalledApp | undefined, item?: StoreApp) => {
    show(
      e,
      installed
        ? appMenuItems(installed, { busy: busy.has(installed.id), onOpen: onOpenApp, onToggle, onUninstall })
        : item
          ? [{ label: `Get ${item.name}`, icon: Download, onSelect: () => onInstall(item.id) }]
          : [],
    )
  }

  const q = query.trim().toLowerCase()
  const list = catalog.filter(
    app => (category === 'All' || app.category === category) && app.name.toLowerCase().includes(q),
  )
  const featured = catalog.find(app => app.id === FEATURED_ID)

  useAppMenus(() => [
    {
      label: 'Store',
      items: [
        ...DISCOVER.map(({ id, icon }) => ({
          label: id === 'All' ? 'All Apps' : id,
          icon,
          checked: category === id,
          onSelect: () => setCategory(id),
        })),
        'separator',
        { label: 'Installed', icon: CircleCheck, checked: category === 'Installed', onSelect: () => setCategory('Installed') },
        'separator',
        { label: 'Manual Install…', icon: PackagePlus, onSelect: () => setCustomOpen(true) },
      ],
    },
  ])

  const sidebarItem = (id: Category, Icon: LucideIcon, badge?: number) => (
    <button key={id} className={`sidebar-item ${id === category ? 'is-active' : ''}`} onClick={() => setCategory(id)}>
      <Icon size={15} /> {id}
      {badge !== undefined && <span className="sidebar-badge">{badge}</span>}
    </button>
  )

  const installCustom = async (spec: CustomAppSpec) => {
    const id = await onInstallCustom(spec)
    setCategory('Installed')
    return id
  }

  return (
    <div className="split">
      <WindowToolbar>
        <ToolbarTitle
          title={category === 'All' ? 'Discover' : category}
          subtitle={category === 'Installed' ? `${apps.length} apps on the server` : undefined}
        />
        <span className="tb-spacer" />
        <div className="tb-group">
          <button className="tb-btn" onClick={() => setCustomOpen(true)} aria-label="Manual install" title="Manual Install">
            <PackagePlus size={16} />
          </button>
        </div>
      </WindowToolbar>
      <aside className="sidebar">
        <label className="sidebar-search">
          <Search size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" />
        </label>
        <div className="sidebar-group">Discover</div>
        {DISCOVER.map(({ id, icon }) => sidebarItem(id, icon))}
        <div className="sidebar-group">Library</div>
        {sidebarItem('Installed', CircleCheck, apps.length)}
        <button className="sidebar-item sidebar-action" onClick={() => setCustomOpen(true)}>
          <PackagePlus size={15} /> Manual Install
        </button>
      </aside>

      <div className="pane">
        {category === 'Installed' ? (
          <>
            <div className="pane-title-row">
              <h3 className="pane-title">Installed</h3>
              <button className="pill-btn" onClick={() => setCustomOpen(true)}>
                <PackagePlus size={13} /> Manual Install
              </button>
            </div>
            <p className="pane-note">
              Every app running on the server. Apps from the TemanLabsOS App Center can be uninstalled here; CasaOS apps
              are managed in CasaOS.
            </p>
            <div className="installed-list">
              {apps
                .filter(app => app.name.toLowerCase().includes(q))
                .map(app => (
                  <InstalledRow
                    key={app.id}
                    app={app}
                    busy={busy.has(app.id)}
                    onToggle={onToggle}
                    onUninstall={onUninstall}
                    onOpen={onOpenApp}
                    onContextMenu={e => appMenu(e, app)}
                  />
                ))}
            </div>
            {apps.length === 0 && <p className="empty">No apps found on the server.</p>}
          </>
        ) : (
          <>
            {loadError && (
              <p className="app-placeholder-error">
                <TriangleAlert size={14} /> Couldn't load the App Center: {loadError}
              </p>
            )}
            {category === 'All' && !q && featured && (
              <div
                className="hero"
                style={{ background: `linear-gradient(120deg, ${featured.color[0]}, ${featured.color[1]})` }}
              >
                <AppIcon icon={featured.icon} iconUrl={featured.iconUrl} color={featured.color} size={88} />
                <div>
                  <small>Featured</small>
                  <h3>{featured.name}</h3>
                  <p>{featured.description}</p>
                  <GetButton app={featured} installed={installedFor(featured)} onInstall={onInstall} onOpen={onOpenApp} />
                </div>
              </div>
            )}

            <h3 className="pane-title">{category === 'All' ? 'All Apps' : category}</h3>
            <div className="store-grid">
              {list.map(item => {
                const installed = installedFor(item)
                return (
                  <div className="store-card" key={item.id} onContextMenu={e => appMenu(e, installed, item)}>
                    <AppIcon icon={item.icon} iconUrl={item.iconUrl} color={item.color} size={52} />
                    <div className="store-card-info">
                      <strong>{item.name}</strong>
                      <span>
                        {installed && installed.source !== 'temanlabs'
                          ? `Already installed via ${SOURCE_LABEL[installed.source]}.`
                          : item.description}
                      </span>
                    </div>
                    <GetButton app={item} installed={installed} onInstall={onInstall} onOpen={onOpenApp} />
                  </div>
                )
              })}
            </div>
            {catalog.length > 0 && list.length === 0 && <p className="empty">No apps found.</p>}
          </>
        )}
      </div>
      <CustomInstall open={customOpen} onClose={() => setCustomOpen(false)} onInstall={installCustom} />
    </div>
  )
}

interface GetButtonProps {
  app: StoreApp
  installed?: InstalledApp
  onInstall: (id: string) => void
  onOpen: (app: InstalledApp) => void
}

function GetButton({ app, installed, onInstall, onOpen }: GetButtonProps) {
  if (installed?.status === 'installing') {
    return (
      <span className="get-btn is-busy">
        <LoaderCircle size={13} className="spin" /> Installing
      </span>
    )
  }
  if (installed?.error) {
    return (
      <button className="get-btn" onClick={() => onInstall(app.id)} title={installed.error}>
        Retry
      </button>
    )
  }
  if (installed) {
    return (
      <button className="get-btn" onClick={() => onOpen(installed)}>
        Open
      </button>
    )
  }
  return (
    <button className="get-btn" onClick={() => onInstall(app.id)}>
      Get
    </button>
  )
}

interface InstalledRowProps {
  app: InstalledApp
  busy: boolean
  onToggle: (app: InstalledApp) => void
  onUninstall: (id: string) => void
  onOpen: (app: InstalledApp) => void
  onContextMenu: (e: MouseEvent) => void
}

function InstalledRow({ app, busy, onToggle, onUninstall, onOpen, onContextMenu }: InstalledRowProps) {
  const [confirming, setConfirming] = useState(false)
  const running = app.status === 'running'
  const installing = app.status === 'installing'
  const details = [
    busy && !installing ? 'Working…' : STATUS_LABEL[app.status],
    SOURCE_LABEL[app.source],
    app.port ? `port ${app.port}` : 'no web UI',
    app.containers > 1 ? `${app.containers} containers` : null,
  ].filter(Boolean)
  return (
    <div className="installed-row" onContextMenu={onContextMenu}>
      <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={40} />
      <div className="store-card-info">
        <strong>{app.name}</strong>
        <span className={`app-status status-${app.status}`}>
          <i />
          {details.join(' · ')}
        </span>
        {app.error && <span className="installed-error">{app.error}</span>}
      </div>
      <button className="pill-btn" onClick={() => onToggle(app)} disabled={busy || installing || (app.source === 'native' && !app.unit)}>
        {running ? 'Stop' : 'Start'}
      </button>
      {app.canUninstall && (
        <button
          className="pill-btn danger"
          onClick={() => (confirming ? onUninstall(app.id) : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={busy || installing}
        >
          {confirming ? 'Confirm' : 'Uninstall'}
        </button>
      )}
      <button className="get-btn" onClick={() => onOpen(app)} disabled={installing || !app.port}>
        Open
      </button>
    </div>
  )
}
