import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Bot,
  Briefcase,
  CircleArrowUp,
  CircleCheck,
  Clapperboard,
  Cloud,
  Code,
  Download,
  House,
  LayoutGrid,
  Library,
  LoaderCircle,
  MessagesSquare,
  Network,
  PackagePlus,
  Plus,
  RotateCw,
  Search,
  Settings2,
  Shapes,
  Trash2,
  TriangleAlert,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { AppSource, AppStatus, CustomAppSpec, InstalledApp, StoreAppDetails, StoreEntry, StoreListing } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import { CustomInstall } from '../components/CustomInstall'
import { StoreAppPage } from '../components/StoreAppPage'
import { StoreInstall } from '../components/StoreInstall'
import { usePresence } from '../hooks/usePresence'
import type { useAppUpdates } from '../hooks/useAppUpdates'
import { appMenuItems } from '../lib/appMenu'
import { useAppMenus } from '../lib/appMenus'
import { useContextMenu } from '../lib/contextMenu'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { tr } from '../lib/i18n'
import { useMobileBack } from '../lib/mobileBack'

/** 'All', 'Installed', 'Updates', or a store category ("Media", "Home"…). */
export type StoreCategory = string

const CATEGORY_ICON: Record<string, LucideIcon> = {
  All: LayoutGrid,
  Home: House,
  Media: Clapperboard,
  Productivity: Briefcase,
  Developer: Code,
  Networking: Network,
  AI: Bot,
  Social: MessagesSquare,
  Finance: Wallet,
  Cloud,
  Downloader: Download,
  Utilities: Wrench,
  Others: Shapes,
}

const STATUS_LABEL: Record<AppStatus, string> = {
  running: tr('Running'),
  stopped: tr('Stopped'),
  installing: tr('Installing…'),
}

const SOURCE_LABEL: Record<AppSource, string> = {
  temanlabs: tr('TemanLabsOS'),
  casaos: tr('CasaOS'),
  compose: tr('Docker Compose'),
  container: tr('Container'),
  native: tr('Outside Docker'),
}

const ICON_COLOR: [string, string] = ['#64d2ff', '#2f6bff']
const FEATURED = ['Jellyfin', 'Immich', 'Home Assistant', 'Nextcloud']
const STORE_POLL_MS = 3000

interface Props {
  apps: InstalledApp[]
  busy: ReadonlySet<string>
  category: StoreCategory
  onCategoryChange: (category: StoreCategory) => void
  onInstall: (id: string) => void
  onInstallCustom: (spec: CustomAppSpec) => Promise<string>
  onToggle: (app: InstalledApp) => void
  onUninstall: (id: string) => void
  onOpenApp: (app: InstalledApp) => void
  onSettings: (app: InstalledApp) => void
  /** A store install started: refresh the app list so it shows as installing. */
  onInstalled?: () => void
  updates: ReturnType<typeof useAppUpdates>
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
  onSettings,
  onInstalled,
  updates,
}: Props) {
  const [store, setStore] = useState<StoreListing | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  // The app whose page is open, and the one being installed (with the details its page read).
  const [page, setPage] = useState<StoreEntry | null>(null)
  const [installing, setInstalling] = useState<{ entry: StoreEntry; details: StoreAppDetails | null } | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const listScroll = useRef(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const { show } = useContextMenu()

  const loadStore = useCallback(async () => {
    try {
      setStore(await api.appStore())
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Refetch when apps change so "installed" marks stay accurate; poll while stores download.
  const appIds = apps.map(a => `${a.id}:${a.status}`).join(',')
  useEffect(() => {
    void loadStore()
  }, [appIds, loadStore])
  const syncing = !!store?.syncing
  useEffect(() => {
    if (!syncing) return
    const timer = setInterval(() => void loadStore(), STORE_POLL_MS)
    return () => clearInterval(timer)
  }, [syncing, loadStore])

  const installedById = useMemo(() => new Map(apps.map(app => [app.id, app])), [apps])
  const installedFor = (entry: StoreEntry) => (entry.installedAs ? installedById.get(entry.installedAs) : undefined)

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of store?.apps ?? []) counts.set(a.category, (counts.get(a.category) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => (a[0] === 'Others' ? 1 : b[0] === 'Others' ? -1 : b[1] - a[1]))
      .map(([name, count]) => ({ name, count }))
  }, [store])

  const appMenu = (e: MouseEvent, installed: InstalledApp | undefined, entry?: StoreEntry) => {
    show(
      e,
      installed
        ? appMenuItems(installed, {
            busy: busy.has(installed.id),
            onOpen: onOpenApp,
            onToggle,
            onUninstall,
            onSettings: app => onSettings(app),
            updateAvailable: updates.available(installed.id),
          })
        : entry
          ? [{ label: tr('Get {0}…', entry.name), icon: Download, onSelect: () => startGet(entry) }]
          : [],
    )
  }

  const q = query.trim().toLowerCase()
  const browsing = category !== 'Installed' && category !== 'Updates'
  const list = (store?.apps ?? []).filter(
    app =>
      (category === 'All' || !browsing || app.category === category) &&
      (!q || app.name.toLowerCase().includes(q) || app.tagline.toLowerCase().includes(q) || app.category.toLowerCase().includes(q)),
  )
  const featured = FEATURED.map(name => store?.apps.find(a => a.name === name)).find(Boolean)
  const multipleSources = (store?.sources.length ?? 0) > 1

  useAppMenus(() => [
    {
      label: tr('Store'),
      items: [
        { label: tr('All Apps'), icon: LayoutGrid, checked: category === 'All', onSelect: () => setCategory('All') },
        { label: tr('Installed'), icon: CircleCheck, checked: category === 'Installed', onSelect: () => setCategory('Installed') },
        { label: tr('Updates'), icon: CircleArrowUp, checked: category === 'Updates', onSelect: () => setCategory('Updates') },
        'separator',
        { label: tr('Manual Install…'), icon: PackagePlus, onSelect: () => setCustomOpen(true) },
        { label: tr('App Stores…'), icon: Library, onSelect: () => setSourcesOpen(true) },
        { label: tr('Refresh App Stores'), icon: RotateCw, disabled: syncing, onSelect: () => void api.refreshStores().then(loadStore) },
      ],
    },
  ])

  const sidebarItem = (id: StoreCategory, Icon: LucideIcon, badge?: number) => (
    <button key={id} className={`sidebar-item ${id === category ? 'is-active' : ''}`} onClick={() => setCategory(id)}>
      <Icon size={15} /> {id === 'All' ? tr('All Apps') : tr(id)}
      {badge !== undefined && <span className="sidebar-badge">{badge}</span>}
    </button>
  )

  const installCustom = async (spec: CustomAppSpec) => {
    const id = await onInstallCustom(spec)
    setCategory('Installed')
    return id
  }

  // A page opens at its top; going back returns to where the list was.
  const openPage = (entry: StoreEntry) => {
    if (!page) listScroll.current = pane.current?.scrollTop ?? 0
    setPage(entry)
    requestAnimationFrame(() => pane.current?.scrollTo({ top: 0 }))
  }
  const closePage = useCallback(() => {
    setPage(null)
    requestAnimationFrame(() => pane.current?.scrollTo({ top: listScroll.current }))
  }, [])
  useEffect(() => setPage(null), [category, query])
  // On a phone, back from an app's page returns to the list.
  useMobileBack(() => {
    if (!page) return false
    closePage()
    return true
  })
  // Built-in picks install in one click; store apps ask for their settings first.
  const startGet = (entry: StoreEntry, details: StoreAppDetails | null = null) => {
    if (entry.source === 'TemanLabsOS') {
      onInstall(entry.id)
      setPage(null)
      setCategory('Installed')
    } else setInstalling({ entry, details })
  }
  const getButton = (entry: StoreEntry) => (
    <GetButton entry={entry} installed={installedFor(entry)} onGet={() => startGet(entry)} onOpen={onOpenApp} />
  )

  const total = store?.apps.length ?? 0
  return (
    <div className="split">
      <WindowToolbar>
        <ToolbarTitle
          title={category === 'All' ? tr('Discover') : tr(category)}
          subtitle={
            category === 'Installed'
              ? tr('{0} apps on the server', apps.length)
              : syncing
                ? tr('Downloading app stores…')
                : browsing
                  ? tr('{0} apps{1}', list.length, store ? ` · ${store.sources.map(s => s.name).join(', ')}` : '')
                  : undefined
          }
        />
        <span className="tb-spacer" />
        <div className="tb-group">
          <button className="tb-btn" onClick={() => setSourcesOpen(true)} aria-label={tr('App stores')} title={tr('App Stores')}>
            <Library size={16} />
          </button>
          <button className="tb-btn" onClick={() => setCustomOpen(true)} aria-label={tr('Manual install')} title={tr('Manual Install')}>
            <PackagePlus size={16} />
          </button>
        </div>
      </WindowToolbar>
      <aside className="sidebar">
        <label className="sidebar-search">
          <Search size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={total ? tr('Search {0} apps', total) : tr('Search')} />
        </label>
        <div className="sidebar-group">{tr('Discover')}</div>
        {sidebarItem('All', LayoutGrid)}
        {categories.map(c => sidebarItem(c.name, CATEGORY_ICON[c.name] ?? Shapes))}
        <div className="sidebar-group">{tr('Library')}</div>
        {sidebarItem('Installed', CircleCheck, apps.length)}
        {sidebarItem('Updates', CircleArrowUp, updates.count || undefined)}
        <button className="sidebar-item sidebar-action" onClick={() => setCustomOpen(true)}>
          <PackagePlus size={15} /> {tr('Manual Install')}
        </button>
      </aside>

      <div className="pane" ref={pane}>
        {page && browsing && (
          <StoreAppPage
            entry={page}
            installed={installedFor(page)}
            related={(store?.apps ?? []).filter(a => a.category === page.category && a.id !== page.id).slice(0, 6)}
            backLabel={category === 'All' ? tr('All Apps') : tr(category)}
            covered={!!installing}
            onBack={closePage}
            onSelect={openPage}
            onGet={details => startGet(page, details)}
            onOpen={onOpenApp}
            renderGet={getButton}
          />
        )}
        <div hidden={!!page && browsing}>
          {category === 'Updates' ? (
            <UpdatesPane apps={apps} updates={updates} onSettings={onSettings} />
          ) : category === 'Installed' ? (
            <>
              <div className="pane-title-row">
                <h3 className="pane-title">{tr('Installed')}</h3>
                <button className="pill-btn" onClick={() => setCustomOpen(true)}>
                  <PackagePlus size={13} /> {tr('Manual Install')}
                </button>
              </div>
              <p className="pane-note">
                {tr(
                  'Every app on the server, whoever installed it: TemanLabsOS, CasaOS, a compose file or docker run. Settings changes ports, folders and variables; Update pulls newer images.',
                )}
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
                      onSettings={onSettings}
                      updateAvailable={updates.available(app.id)}
                      onContextMenu={e => appMenu(e, app)}
                    />
                  ))}
              </div>
              {apps.length === 0 && <p className="empty">{tr('No apps found on the server.')}</p>}
            </>
          ) : (
            <>
              {loadError && (
                <p className="app-placeholder-error">
                  <TriangleAlert size={14} /> {tr("Couldn't load the App Center:")} {loadError}
                </p>
              )}
              {store?.sources.some(s => s.error) && (
                <p className="app-placeholder-error">
                  <TriangleAlert size={14} />{' '}
                  {store.sources
                    .filter(s => s.error)
                    .map(s => `${s.name}: ${s.error}`)
                    .join(' · ')}
                </p>
              )}
              {category === 'All' && !q && featured && (
                <div className="hero" onClick={() => openPage(featured)}>
                  <AppIcon icon="boxes" iconUrl={featured.iconUrl || undefined} color={ICON_COLOR} size={88} />
                  <div>
                    <small>{tr('Featured')}</small>
                    <h3>{featured.name}</h3>
                    <p>{featured.tagline}</p>
                    {getButton(featured)}
                  </div>
                </div>
              )}

              <h3 className="pane-title">{category === 'All' ? tr('All Apps') : category}</h3>
              {syncing && total === 0 && (
                <p className="as-loading">
                  <LoaderCircle size={14} className="spin" />{' '}
                  {tr('Downloading the app stores (CasaOS, BigBear)… the first time takes a minute.')}
                </p>
              )}
              <div className="store-grid">
                {list.map(entry => {
                  const installed = installedFor(entry)
                  return (
                    <div
                      className="store-card"
                      key={entry.id}
                      onClick={() => openPage(entry)}
                      onContextMenu={e => appMenu(e, installed, entry)}
                    >
                      <AppIcon icon="boxes" iconUrl={entry.iconUrl || undefined} color={ICON_COLOR} size={52} />
                      <div className="store-card-info">
                        <strong>
                          {entry.name}
                          {multipleSources && <small className="store-source">{entry.source}</small>}
                        </strong>
                        <span>
                          {installed && installed.source !== 'temanlabs'
                            ? tr('Installed via {0}.', SOURCE_LABEL[installed.source])
                            : entry.tagline}
                        </span>
                      </div>
                      {getButton(entry)}
                    </div>
                  )
                })}
              </div>
              {store && list.length === 0 && !syncing && <p className="empty">{tr('No apps found.')}</p>}
            </>
          )}
        </div>
      </div>
      <CustomInstall open={customOpen} onClose={() => setCustomOpen(false)} onInstall={installCustom} />
      <StoreInstall
        entry={installing?.entry ?? null}
        prefetched={installing?.details}
        onClose={() => setInstalling(null)}
        onInstalled={() => {
          onInstalled?.()
          setPage(null)
          setCategory('Installed')
        }}
      />
      <SourcesSheet open={sourcesOpen} listing={store} onClose={() => setSourcesOpen(false)} onChanged={loadStore} />
    </div>
  )
}

function GetButton({
  entry,
  installed,
  onGet,
  onOpen,
}: {
  entry: StoreEntry
  installed?: InstalledApp
  onGet: () => void
  onOpen: (app: InstalledApp) => void
}) {
  const stop = (e: MouseEvent) => e.stopPropagation()
  if (installed?.status === 'installing') {
    return (
      <span className="get-btn is-busy" onClick={stop}>
        <LoaderCircle size={13} className="spin" /> {tr('Installing')}
      </span>
    )
  }
  if (installed) {
    return (
      <button
        className="get-btn"
        onClick={e => {
          stop(e)
          onOpen(installed)
        }}
      >
        {tr('Open')}
      </button>
    )
  }
  return (
    <button
      className="get-btn"
      onClick={e => {
        stop(e)
        onGet()
      }}
      aria-label={tr('Get {0}', entry.name)}
    >
      {tr('Get')}
    </button>
  )
}

interface InstalledRowProps {
  app: InstalledApp
  busy: boolean
  onToggle: (app: InstalledApp) => void
  onUninstall: (id: string) => void
  onOpen: (app: InstalledApp) => void
  onSettings: (app: InstalledApp) => void
  updateAvailable: boolean
  onContextMenu: (e: MouseEvent) => void
}

function InstalledRow({ app, busy, onToggle, onUninstall, onOpen, onSettings, updateAvailable, onContextMenu }: InstalledRowProps) {
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
      {updateAvailable && (
        <button className="pill-btn is-update" onClick={() => onSettings(app)} title={tr('A newer image is available')}>
          <CircleArrowUp size={12} /> {tr('Update')}
        </button>
      )}
      {app.source !== 'native' && (
        <button
          className="icon-btn"
          onClick={() => onSettings(app)}
          disabled={installing}
          aria-label={tr('Settings')}
          title={tr('Settings')}
        >
          <Settings2 size={15} />
        </button>
      )}
      <button className="pill-btn" onClick={() => onToggle(app)} disabled={busy || installing || (app.source === 'native' && !app.unit)}>
        {running ? tr('Stop') : tr('Start')}
      </button>
      {app.canUninstall && app.source !== 'native' && (
        <button
          className="pill-btn danger"
          onClick={() => (confirming ? onUninstall(app.id) : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={busy || installing}
        >
          {confirming ? tr('Confirm') : tr('Uninstall')}
        </button>
      )}
      <button className="get-btn" onClick={() => onOpen(app)} disabled={installing || !app.port}>
        {tr('Open')}
      </button>
    </div>
  )
}

type UpdateState = 'waiting' | 'updating' | 'done' | 'failed'

const UPDATE_LABEL: Record<UpdateState, string> = {
  waiting: tr('Waiting'),
  updating: tr('Updating…'),
  done: tr('Updated'),
  failed: tr('Failed: open Settings for the log'),
}

/** Apps with newer images, with Update All (one after another, so the server isn't swamped). */
function UpdatesPane({
  apps,
  updates,
  onSettings,
}: {
  apps: InstalledApp[]
  updates: ReturnType<typeof useAppUpdates>
  onSettings: (app: InstalledApp) => void
}) {
  const [states, setStates] = useState<Record<string, UpdateState>>({})
  const [running, setRunning] = useState(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const pending = apps.filter(a => updates.available(a.id) || states[a.id])

  const updateAll = async () => {
    const todo = apps.filter(a => updates.available(a.id))
    setRunning(true)
    setStates(Object.fromEntries(todo.map(a => [a.id, 'waiting' as UpdateState])))
    for (const app of todo) {
      if (!alive.current) return
      setStates(s => ({ ...s, [app.id]: 'updating' }))
      try {
        const { job } = await api.updateApp(app.id)
        let state = await api.job(job)
        while (state.running) {
          await new Promise(r => setTimeout(r, 1500))
          state = await api.job(job)
        }
        setStates(s => ({ ...s, [app.id]: state.exit === 0 ? 'done' : 'failed' }))
      } catch {
        setStates(s => ({ ...s, [app.id]: 'failed' }))
      }
    }
    setRunning(false)
    void updates.refresh()
  }

  const checked = updates.updates?.checked
  return (
    <>
      <div className="pane-title-row">
        <h3 className="pane-title">{tr('Updates')}</h3>
        <button className="pill-btn" onClick={() => void updates.refresh(true)} disabled={updates.checking || running}>
          <RotateCw size={12} className={updates.checking ? 'spin' : ''} /> {updates.checking ? tr('Checking…') : tr('Check Now')}
        </button>
        {apps.some(a => updates.available(a.id)) && (
          <button className="get-btn" onClick={() => void updateAll()} disabled={running}>
            {running ? <LoaderCircle size={13} className="spin" /> : null} {tr('Update All')}
          </button>
        )}
      </div>
      <p className="pane-note">
        {tr(
          "TemanLabsOS compares each app's image with its registry (Docker Hub, GHCR, LinuxServer…) every few hours, without downloading anything. Images you built yourself are skipped.",
        )}
        {checked && !checked.startsWith('0001') ? tr(' Last checked {0}.', new Date(checked).toLocaleString()) : ''}
      </p>
      <div className="installed-list">
        {pending.map(app => (
          <div key={app.id} className="installed-row">
            <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={40} />
            <div className="store-card-info">
              <strong>{app.name}</strong>
              <span>
                {states[app.id]
                  ? UPDATE_LABEL[states[app.id]]
                  : (updates.updates?.apps[app.id]?.images ?? [])
                      .filter(i => i.available)
                      .map(i => i.image)
                      .join(', ')}
              </span>
            </div>
            <button className="get-btn" onClick={() => onSettings(app)} disabled={running}>
              {tr('Details')}
            </button>
          </div>
        ))}
      </div>
      {pending.length === 0 && <p className="empty">{updates.checking ? tr('Checking for updates…') : tr('All apps are up to date.')}</p>}
    </>
  )
}

/** The app stores TemanLabsOS reads, in CasaOS's format; any CasaOS store link works. */
function SourcesSheet({
  open,
  listing,
  onClose,
  onChanged,
}: {
  open: boolean
  listing: StoreListing | null
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { mounted, closing } = usePresence(open, 220)
  const [adding, setAdding] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!mounted) return null
  const sources = listing?.sources ?? []
  const save = async (urls: string[]) => {
    setSaving(true)
    setError(null)
    try {
      await api.setStoreSources(urls)
      await onChanged()
      setAdding('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className={`sheet-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci src-sheet" role="dialog" aria-label={tr('App stores')}>
        <header className="ci-head">
          <strong>{tr('App Stores')}</strong>
          <span className="tb-spacer" />
          <button className="pill-btn" onClick={() => void api.refreshStores().then(onChanged)} disabled={listing?.syncing}>
            <RotateCw size={12} className={listing?.syncing ? 'spin' : ''} /> {listing?.syncing ? tr('Downloading…') : tr('Refresh All')}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body">
          <p className="ci-note">
            {tr(
              'App stores in CasaOS’s format: a .zip with an Apps folder. Any store CasaOS can add works here, e.g. the ones listed on awesome-casaos. They’re refreshed once a day.',
            )}
          </p>
          <div className="src-list">
            {sources.map(s => (
              <div key={s.url} className="src-row">
                <Library size={16} />
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.url}</small>
                  <small className={s.error ? 'is-bad' : ''}>
                    {s.error ? s.error : tr('{0} apps{1}', s.apps, s.updated ? ` · updated ${new Date(s.updated).toLocaleString()}` : '')}
                  </small>
                </span>
                <button
                  className="icon-btn"
                  onClick={() => void save(sources.filter(x => x.url !== s.url).map(x => x.url))}
                  disabled={saving}
                  aria-label={tr('Remove {0}', s.name)}
                  title={tr('Remove')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <form
            className="src-add"
            onSubmit={e => {
              e.preventDefault()
              if (adding.trim()) void save([...sources.map(s => s.url), adding.trim()])
            }}
          >
            <input
              value={adding}
              onChange={e => setAdding(e.target.value)}
              placeholder="https://github.com/…/archive/refs/heads/main.zip"
              spellCheck={false}
            />
            <button className="btn btn-primary" disabled={!adding.trim() || saving}>
              <Plus size={13} /> {tr('Add')}
            </button>
          </form>
          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}
