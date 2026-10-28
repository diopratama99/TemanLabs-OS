import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, Folder, House, LayoutGrid, Settings as SettingsIcon, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { api, ApiError } from '../api'
import type { Device, InstalledApp } from '../api/types'
import { AppSettings, type SettingsRequest } from '../components/AppSettings'
import { FileInfo } from '../components/FileInfo'
import { PowerOverlay } from '../components/PowerOverlay'
import { renderSystemWindow, SYSTEM_WINDOWS, WINDOW_VARIANT, type MediaWindow, type WindowHost } from '../components/SystemWindowContent'
import type { SystemWindowId, WindowId } from '../components/Window'
import { useApps } from '../hooks/useApps'
import { useAppUpdates } from '../hooks/useAppUpdates'
import { useSystemBadges } from '../hooks/useSystemBadges'
import { useSystemStats } from '../hooks/useSystemStats'
import { appMenuItems } from '../lib/appMenu'
import { MenuRegistryContext, type MenuRegistry } from '../lib/appMenus'
import { openApp as openInTab } from '../lib/apps'
import { tr } from '../lib/i18n'
import type { MediaKind, MediaRequest } from '../lib/media'
import type { BackHandler } from '../lib/mobileBack'
import { useSettings } from '../lib/settings'
import type { StoreCategory } from '../windows/AppCenter'
import { AppView } from '../windows/AppView'
import type { OpenRequest } from '../windows/CodeEditor'
import { RemoteScreen } from '../windows/RemoteScreen'
import type { SettingsSection } from '../windows/Settings'
import { isMerged, MERGED_APPS } from '../lib/systemApps'
import type { ShareRequest } from '../windows/Sharing'
import { AppsList } from './AppsList'
import { Home } from './Home'
import { MobileScreen } from './MobileScreen'
import { SettingsList } from './SettingsList'

// TemanLabsOS on a phone: four tabs, each a stack of full screens (back goes down the stack, as
// does the phone's own back button), and the same apps as on the desktop inside them.

type Tab = 'home' | 'apps' | 'files' | 'settings'

/** A screen: one of the tabs' own lists, or what a desktop window would show (a WindowId). */
interface Screen {
  key: string
  id: string
}

const TABS: { id: Tab; label: string; icon: LucideIcon; root: string }[] = [
  { id: 'home', label: tr('Home'), icon: House, root: 'home' },
  { id: 'apps', label: tr('Apps'), icon: LayoutGrid, root: 'apps' },
  { id: 'files', label: tr('Files'), icon: Folder, root: 'files' },
  { id: 'settings', label: tr('Settings'), icon: SettingsIcon, root: 'settings-list' },
]

const MEDIA_WINDOW: Record<MediaKind, MediaWindow> = { image: 'preview', video: 'video', audio: 'music' }
const TOAST_MS = 6000

// Menus belong to the desktop's menu bar; a phone has none.
const NO_MENUS: MenuRegistry = { register: () => {}, unregister: () => {} }

let screenSeq = 0
const screen = (id: string): Screen => ({ key: `${id}#${++screenSeq}`, id })

export function MobileApp() {
  const { stats } = useSystemStats()
  const { apps, busy, install, installCustom, uninstall, toggle, refresh: refreshApps } = useApps()
  const appUpdates = useAppUpdates()
  const badges = useSystemBadges()
  const { update } = useSettings()

  const [tab, setTab] = useState<Tab>('home')
  const [stacks, setStacks] = useState<Record<Tab, Screen[]>>(() => Object.fromEntries(TABS.map(t => [t.id, [screen(t.root)]])) as Record<Tab, Screen[]>)

  // What the apps ask each other for, as on the desktop.
  const [storeCategory, setStoreCategory] = useState<StoreCategory>('All')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [filesOpen, setFilesOpen] = useState<{ path: string; nonce: number } | null>(null)
  const [editorRequest, setEditorRequest] = useState<OpenRequest | null>(null)
  const [mediaRequests, setMediaRequests] = useState<Partial<Record<MediaWindow, MediaRequest>>>({})
  const [remuxRequest, setRemuxRequest] = useState<MediaRequest | null>(null)
  const [shareRequest, setShareRequest] = useState<ShareRequest | null>(null)
  const [terminalInput, setTerminalInput] = useState<{ text: string; nonce: number } | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [remoteDevices, setRemoteDevices] = useState<Record<string, Device>>({})
  const [settingsRequest, setSettingsRequest] = useState<SettingsRequest | null>(null)
  const [powering, setPowering] = useState<'restart' | 'shutdown' | null>(null)

  // ----- Moving between screens -----

  const remember = (id: string) =>
    (id.startsWith('app:') || SYSTEM_WINDOWS[id as SystemWindowId]) &&
    update(s => (s.recentApps?.[0] === id ? {} : { recentApps: [id, ...(s.recentApps ?? []).filter(k => k !== id)].slice(0, 16) }))

  // Parts of apps to show: a merged app's old name opens its part of the app it went into.
  const [parts, setParts] = useState<WindowHost['parts']>({})

  /** Opens a screen on top of the tab in front; one already there is brought back instead. */
  const open = (target: string) => {
    let id = target
    if (isMerged(target)) {
      const m = MERGED_APPS[target]
      if (m.into === 'settings') setSettingsSection(m.part as SettingsSection)
      else setParts(p => ({ ...p, [m.into]: { part: m.part, nonce: Date.now() } }))
      id = m.into
    }
    remember(id)
    if (id === 'files') {
      // Files has a tab of its own.
      setTab('files')
      setStacks(s => ({ ...s, files: s.files.slice(0, 1) }))
      return
    }
    if (id === 'settings') {
      setTab('settings')
      setStacks(s => ({ ...s, settings: [s.settings[0], screen('settings')] }))
      return
    }
    setStacks(s => {
      const stack = s[tab]
      const i = stack.findIndex(x => x.id === id)
      return { ...s, [tab]: i >= 0 ? stack.slice(0, i + 1) : [...stack, screen(id)] }
    })
  }

  // Each screen's own way back (Settings' pages), asked before the screen closes.
  const backHandlers = useRef(new Map<string, BackHandler>())
  const backSetters = useRef(new Map<string, (handler: BackHandler | null) => void>())
  const backSetter = (key: string) => {
    let setter = backSetters.current.get(key)
    if (!setter) {
      setter = handler => (handler ? backHandlers.current.set(key, handler) : backHandlers.current.delete(key))
      backSetters.current.set(key, setter)
    }
    return setter
  }

  const back = (): boolean => {
    const stack = stacks[tab]
    const top = stack[stack.length - 1]
    if (backHandlers.current.get(top.key)?.()) return true
    if (stack.length > 1) {
      setStacks(s => ({ ...s, [tab]: s[tab].slice(0, -1) }))
      return true
    }
    if (tab !== 'home') {
      setTab('home')
      return true
    }
    return false
  }
  const backRef = useRef(back)
  backRef.current = back

  // The phone's back button: a history entry stands guard, and comes back after each use while
  // there's somewhere to go back to inside.
  useEffect(() => {
    history.pushState({ temanlabs: true }, '')
    const onPop = () => {
      if (backRef.current()) history.pushState({ temanlabs: true }, '')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const selectTab = (t: Tab) => {
    // The tab already in front goes back to its first screen.
    if (t === tab) setStacks(s => ({ ...s, [t]: s[t].slice(0, 1) }))
    setTab(t)
  }

  // ----- What the apps get -----

  const openAppWindow = (app: InstalledApp) => open(`app:${app.id}`)
  const openAppSettings = (app: InstalledApp, options: { tab?: 'terminal'; update?: boolean } = {}) => setSettingsRequest({ app, ...options, nonce: Date.now() })
  const openSettings = (section: SettingsSection) => {
    setSettingsSection(section)
    open('settings')
  }
  const setWindowTitle = useCallback((id: WindowId, title: string) => setTitles(t => (t[id] === title ? t : { ...t, [id]: title })), [])
  const host: WindowHost = {
    stats,
    apps,
    appsState: { busy, install, installCustom, toggle, uninstall, refresh: refreshApps },
    appUpdates,
    storeCategory,
    setStoreCategory,
    settingsSection,
    setSettingsSection,
    filesOpen,
    editorRequest,
    mediaRequests,
    remuxRequest,
    shareRequest,
    terminalInput,
    parts,
    openWindow: id => open(id),
    openAppWindow,
    openAppSettings,
    openMedia: (path, kind) => {
      const id = MEDIA_WINDOW[kind]
      setMediaRequests(r => ({ ...r, [id]: { path, nonce: Date.now() } }))
      open(id)
    },
    openFilesAt: path => {
      setFilesOpen({ path, nonce: Date.now() })
      open('files')
    },
    openInEditor: (path, kind = 'file') => {
      setEditorRequest({ path, kind, nonce: Date.now() })
      open('code')
    },
    openSettings,
    openStore: category => {
      setStoreCategory(category)
      open('store')
    },
    openRemote: device => {
      setRemoteDevices(m => ({ ...m, [device.id]: device }))
      open(`remote:${device.id}`)
    },
    openShare: path => {
      setShareRequest({ path, nonce: Date.now() })
      open('sharing')
    },
    openRemux: path => {
      setRemuxRequest({ path, nonce: Date.now() })
      open('remux')
    },
    runInTerminal: text => {
      setTerminalInput({ text, nonce: Date.now() })
      open('terminal')
    },
    setWindowTitle,
    onPower: action => void api.power(action).then(() => setPowering(action)),
    // Widgets live on the desktop; a phone has none to arrange.
    onEditWidgets: () => {},
  }

  const appMenu = (app: InstalledApp) =>
    appMenuItems(app, {
      busy: busy.has(app.id),
      onOpen: openAppWindow,
      onToggle: toggle,
      onUninstall: uninstall,
      onSettings: openAppSettings,
      updateAvailable: appUpdates.available(app.id),
    })

  // ----- Errors, as the desktop shows them -----

  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  useEffect(() => {
    let timer = 0
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ApiError && e.reason.status === 423) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      clearTimeout(timer)
      setToast({ id: Date.now(), message: e.reason instanceof Error ? e.reason.message : String(e.reason) })
      timer = window.setTimeout(() => setToast(null), TOAST_MS)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  // ----- Screens -----

  const appOf = (id: string) => (id.startsWith('app:') ? apps.find(a => a.id === id.slice(4)) : undefined)
  const titleOf = (id: string): string => {
    if (id === 'home') return tr('Home')
    if (id === 'apps') return tr('Apps')
    if (id === 'settings-list') return tr('Settings')
    if (id.startsWith('app:')) return appOf(id)?.name ?? tr('App')
    if (id.startsWith('info:')) return titles[id] ?? tr('Get Info')
    if (id.startsWith('remote:')) return remoteDevices[id.slice(7)]?.name ?? tr('Devices')
    return titles[id] ?? SYSTEM_WINDOWS[id as SystemWindowId]?.title ?? id
  }

  const content = (s: Screen, visible: boolean): ReactNode => {
    const { id } = s
    if (id === 'home')
      return (
        <Home
          stats={stats}
          apps={apps}
          updates={{ apps: appUpdates.count, packages: badges.packages, release: badges.release }}
          onOpen={open}
          onOpenApp={openAppWindow}
          onOpenUpdates={which => (which === 'apps' ? host.openStore('Updates') : which === 'packages' ? open('updates') : openSettings('updates'))}
          onPower={host.onPower}
        />
      )
    if (id === 'apps') return <AppsList apps={apps} busy={busy} onOpen={open} onOpenApp={openAppWindow} appMenu={appMenu} />
    if (id === 'settings-list') return <SettingsList onOpen={openSettings} />
    if (id.startsWith('app:')) return <AppView app={appOf(id)} busy={busy.has(id.slice(4))} onToggle={toggle} />
    if (id.startsWith('info:')) return <FileInfo path={id.slice(5)} onTitle={t => host.setWindowTitle(id as WindowId, t)} />
    if (id.startsWith('remote:')) {
      const device = remoteDevices[id.slice(7)]
      return device ? <RemoteScreen device={device} active={visible} /> : null
    }
    return renderSystemWindow(id as SystemWindowId, host)
  }

  const variantOf = (id: string) =>
    id.startsWith('app:') || id.startsWith('info:') || id.startsWith('remote:') ? 'compact' : (WINDOW_VARIANT[id as SystemWindowId] ?? 'default')

  const badgeOf = (t: Tab) => (t === 'apps' ? appUpdates.count : t === 'settings' ? (badges.release ? 1 : 0) : 0)

  return (
    <MenuRegistryContext.Provider value={NO_MENUS}>
      <div className="m-shell">
        <div className="m-screens">
          {TABS.map(t =>
            stacks[t.id].map((s, i) => {
              const visible = tab === t.id && i === stacks[t.id].length - 1
              const app = appOf(s.id)
              return (
                <MobileScreen
                  key={s.key}
                  id={s.id}
                  title={titleOf(s.id)}
                  visible={visible}
                  onBack={i > 0 ? () => void back() : undefined}
                  onBackHandler={backSetter(s.key)}
                  variant={variantOf(s.id)}
                  actions={
                    app && app.status === 'running' ? (
                      <button className="m-icon-btn" onClick={() => openInTab(app)} aria-label={tr('Open in Browser')}>
                        <ExternalLink size={20} />
                      </button>
                    ) : undefined
                  }
                >
                  {content(s, visible)}
                </MobileScreen>
              )
            }),
          )}
        </div>

        <nav className="m-tabbar" aria-label={tr('Sections')}>
          {TABS.map(t => {
            const Icon = t.icon
            const badge = badgeOf(t.id)
            return (
              <button key={t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => selectTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
                <span className="m-tab-icon">
                  <Icon size={23} strokeWidth={tab === t.id ? 2.4 : 1.9} />
                  {badge > 0 && <i className="m-badge">{badge}</i>}
                </span>
                {t.label}
              </button>
            )
          })}
        </nav>

        {toast && (
          <div className="m-toast" role="alert" key={toast.id}>
            <TriangleAlert size={18} />
            <span>{toast.message}</span>
            <button className="m-icon-btn" onClick={() => setToast(null)} aria-label={tr('Dismiss')}>
              <X size={18} />
            </button>
          </div>
        )}
        {powering && <PowerOverlay action={powering} />}
        <AppSettings
          request={settingsRequest}
          updateAvailable={appUpdates.available}
          onClose={() => setSettingsRequest(null)}
          onChanged={() => {
            void refreshApps()
            void appUpdates.refresh()
          }}
        />
      </div>
    </MenuRegistryContext.Provider>
  )
}
