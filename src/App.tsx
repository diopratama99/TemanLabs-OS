import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent } from 'react'
import {
  Braces,
  Copy,
  EyeOff,
  ExternalLink,
  Folder,
  FolderOpen,
  Globe,
  Image,
  Info,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  Link,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  Play,
  Power,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  Square,
  SquareTerminal,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api } from './api'
import type { InstalledApp } from './api/types'
import { AppIcon } from './components/AppIcon'
import type { MenuAnchor, MenuItem } from './components/ContextMenu'
import { DesktopWidgets } from './components/DesktopWidgets'
import { Dock } from './components/Dock'
import { Glass } from './components/Glass'
import { Launcher } from './components/Launcher'
import { MenuBar, QUICK_SEARCH_SHORTCUT, type MenuBarContent } from './components/MenuBar'
import { QuickSearch } from './components/QuickSearch'
import { Wallpaper } from './components/Wallpaper'
import { Window, type Frame, type SystemWindowId, type WindowId } from './components/Window'
import { useApps } from './hooks/useApps'
import { usePresence } from './hooks/usePresence'
import type { MediaKind, MediaRequest } from './lib/media'
import { useSystemStats } from './hooks/useSystemStats'
import { appMenuItems } from './lib/appMenu'
import { MenuRegistryContext, type AppMenu, type MenuBuilder, type MenuRegistry } from './lib/appMenus'
import { appUrl, openApp as openInTab } from './lib/apps'
import { copyText } from './lib/clipboard'
import { useContextMenu } from './lib/contextMenu'
import { isEditable } from './lib/dom'
import { useSettings } from './lib/settings'
import { findShortcut, shortcutOf, TEXT_EDITING_KEYS } from './lib/shortcuts'
import { SYSTEM_APPS } from './lib/systemApps'
import { AppCenter, type StoreCategory } from './windows/AppCenter'
import { SystemMonitor } from './windows/SystemMonitor'
import { Sharing, type ShareRequest } from './windows/Sharing'
import { PowerOverlay } from './components/PowerOverlay'
import { LogViewer } from './windows/LogViewer'
import { DiskManager } from './windows/DiskManager'
import { NetworkTools } from './windows/NetworkTools'
import { ScheduledTasks } from './windows/ScheduledTasks'
import { SystemUpdates } from './windows/SystemUpdates'
import { Kubernetes } from './windows/Kubernetes'
import { MusicPlayer } from './windows/MusicPlayer'
import { PhotoViewer } from './windows/PhotoViewer'
import { VideoPlayer } from './windows/VideoPlayer'
import { AppView } from './windows/AppView'
import { CodeEditor, type OpenRequest } from './windows/CodeEditor'
import { Files } from './windows/Files'
import { Settings, type SettingsSection } from './windows/Settings'
import { Terminal } from './windows/Terminal'

interface WindowState {
  id: WindowId
  z: number
  minimized: boolean
  maximized: boolean
  frame: Frame
  /** Bumped by the reload button to remount an app's web view. */
  nonce: number
  /** Playing its close animation; removed from the list once it finishes. */
  closing?: boolean
}

const SYSTEM_WINDOWS: Record<SystemWindowId, { title: string; width: number; height: number }> = {
  store: { title: 'App Center', width: 940, height: 600 },
  files: { title: 'Files', width: 820, height: 520 },
  code: { title: 'Code', width: 1120, height: 700 },
  settings: { title: 'Settings', width: 720, height: 500 },
  terminal: { title: 'Terminal', width: 680, height: 420 },
  activity: { title: 'System Monitor', width: 980, height: 600 },
  sharing: { title: 'File Sharing', width: 900, height: 600 },
  updates: { title: 'System Updates', width: 760, height: 620 },
  console: { title: 'Log Viewer', width: 1080, height: 660 },
  disks: { title: 'Disk Manager', width: 900, height: 620 },
  network: { title: 'Network Tools', width: 900, height: 600 },
  scheduler: { title: 'Scheduled Tasks', width: 860, height: 560 },
  kubernetes: { title: 'Kubernetes', width: 1080, height: 680 },
  music: { title: 'Music Player', width: 760, height: 600 },
  preview: { title: 'Image Viewer', width: 920, height: 640 },
  video: { title: 'Video Player', width: 960, height: 600 },
}

// Windows with a source-list sidebar run it full height; Terminal gets a slim title bar.
const WINDOW_VARIANT: Partial<Record<SystemWindowId, 'sidebar' | 'compact'>> = {
  files: 'sidebar',
  store: 'sidebar',
  settings: 'sidebar',
  sharing: 'sidebar',
  console: 'sidebar',
  disks: 'sidebar',
  scheduler: 'sidebar',
  kubernetes: 'sidebar',
  terminal: 'compact',
}

type MediaWindow = 'preview' | 'video' | 'music'
const MEDIA_WINDOW: Record<MediaKind, MediaWindow> = { image: 'preview', video: 'video', audio: 'music' }

const APP_WINDOW_SIZE = { width: 1040, height: 660 }
/** Apps shown in the Dock before the user pins any. */
const MAX_AUTO_DOCK = 8
const TOAST_MS = 6000
// Match the exit animations in app.css.
const LAUNCHER_EXIT_MS = 240
const SPOTLIGHT_EXIT_MS = 160

const appIdOf = (id: WindowId) => (id.startsWith('app:') ? id.slice(4) : null)

function initialFrame(id: WindowId, cascade: number): Frame {
  const size = appIdOf(id) ? APP_WINDOW_SIZE : SYSTEM_WINDOWS[id as SystemWindowId]
  const width = Math.min(size.width, window.innerWidth - 32)
  const height = Math.min(size.height, window.innerHeight - 160)
  return {
    x: Math.max(16, (window.innerWidth - width) / 2 + cascade * 28),
    y: Math.max(44, (window.innerHeight - height) / 2 - 40 + cascade * 28),
    width,
    height,
  }
}

export default function App() {
  const { stats, history } = useSystemStats()
  const { apps, busy, install, installCustom, uninstall, toggle } = useApps()
  const { settings, update } = useSettings()
  const { show } = useContextMenu()
  const [windows, setWindows] = useState<WindowState[]>([])
  const [launchpad, setLauncher] = useState(false)
  const [spotlight, setQuickSearch] = useState(false)
  const [driveSelected, setDriveSelected] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [storeCategory, setStoreCategory] = useState<StoreCategory>('All')
  const [editorRequest, setEditorRequest] = useState<OpenRequest | null>(null)
  const [powering, setPowering] = useState<'restart' | 'shutdown' | null>(null)
  const [shareRequest, setShareRequest] = useState<ShareRequest | null>(null)
  const [mediaRequests, setMediaRequests] = useState<Partial<Record<MediaWindow, MediaRequest>>>({})
  // Titles set by the windows themselves (the file a viewer shows).
  const [windowTitles, setWindowTitles] = useState<Partial<Record<WindowId, string>>>({})
  const setWindowTitle = useCallback(
    (id: WindowId, title: string) => setWindowTitles(t => (t[id] === title ? t : { ...t, [id]: title })),
    [],
  )
  const [editingWidgets, setEditingWidgets] = useState(false)
  const topZ = useRef(100)

  // Menus registered by window contents (see useAppMenus). Registering re-renders once so the
  // menu bar picks up the new titles; the builders themselves are read lazily.
  const menuBuilders = useRef(new Map<WindowId, MenuBuilder>())
  const [, bumpMenus] = useReducer((n: number) => n + 1, 0)
  const menuRegistry = useMemo<MenuRegistry>(
    () => ({
      register: (id, build) => {
        menuBuilders.current.set(id, build)
        bumpMenus()
      },
      unregister: (id, build) => {
        if (menuBuilders.current.get(id) !== build) return
        menuBuilders.current.delete(id)
        bumpMenus()
      },
    }),
    [],
  )

  // Failed actions (install, save, rename…) reject promises that callers fire and forget; surface
  // them here rather than wrapping every call site.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  useEffect(() => {
    let timer = 0
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = e.reason instanceof Error ? e.reason.message : String(e.reason)
      e.preventDefault()
      clearTimeout(timer)
      setToast({ id: Date.now(), message })
      timer = window.setTimeout(() => setToast(null), TOAST_MS)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  // Keyboard shortcuts belong to menu items: any shortcut shown in the frontmost app's
  // menu bar works while that app is in front. See the effect below `menuBarContent`.
  const menuContentRef = useRef<() => MenuBarContent>(() => ({ appName: '', appMenu: [], menus: [] }))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Already handled further down, e.g. by the code editor (Ctrl+C, or Ctrl+K chords).
      if (e.defaultPrevented) return
      // The terminal owns every key: Ctrl+K, Ctrl+P… mean something to the shell.
      if (e.target instanceof Element && e.target.closest('.xterm')) return
      const shortcut = shortcutOf(e)
      if (!shortcut) return
      if (isEditable(e.target) && TEXT_EDITING_KEYS.has(e.code) && !e.shiftKey) return
      const { appMenu, menus } = menuContentRef.current()
      const item = findShortcut([...appMenu, ...menus.flatMap(m => m.items)], shortcut)
      if (!item) return
      // Also stops the browser's own action for the keys (Ctrl+S save page, Ctrl+O open file…).
      e.preventDefault()
      if (!item.disabled) item.onSelect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openWindow = (id: WindowId) => {
    setLauncher(false)
    const z = ++topZ.current
    setWindows(ws =>
      ws.some(w => w.id === id)
        ? ws.map(w => (w.id === id ? { ...w, z, minimized: false, closing: false } : w))
        : [...ws, { id, z, minimized: false, maximized: false, frame: initialFrame(id, ws.length), nonce: 0 }],
    )
  }
  const openAppWindow = (app: InstalledApp) => openWindow(`app:${app.id}`)
  const openSettings = (section: SettingsSection) => {
    setSettingsSection(section)
    openWindow('settings')
  }
  const openInEditor = (path: string, kind: OpenRequest['kind'] = 'file') => {
    setEditorRequest({ path, kind, nonce: Date.now() })
    openWindow('code')
  }
  const openMedia = (path: string, kind: MediaKind) => {
    const id = MEDIA_WINDOW[kind]
    setMediaRequests(r => ({ ...r, [id]: { path, nonce: Date.now() } }))
    openWindow(id)
  }
  const openStore = (category: StoreCategory) => {
    setStoreCategory(category)
    openWindow('store')
  }
  const focusWindow = (id: WindowId) => {
    if (windows.find(w => w.id === id)?.z === topZ.current) return
    const z = ++topZ.current
    setWindows(ws => ws.map(w => (w.id === id ? { ...w, z } : w)))
  }
  const closeWindow = (id: WindowId) => setWindows(ws => ws.map(w => (w.id === id ? { ...w, closing: true } : w)))
  const removeWindow = (id: WindowId) => {
    setWindows(ws => ws.filter(w => w.id !== id || !w.closing))
    setWindowTitles(({ [id]: _, ...rest }) => rest)
    setMediaRequests(({ [id as MediaWindow]: _, ...rest }) => rest)
  }
  const minimizeWindow = (id: WindowId) =>
    setWindows(ws => ws.map(w => (w.id === id ? { ...w, minimized: true } : w)))
  const toggleZoom = (id: WindowId) =>
    setWindows(ws => ws.map(w => (w.id === id ? { ...w, maximized: !w.maximized } : w)))
  const reloadWindow = (id: WindowId) => setWindows(ws => ws.map(w => (w.id === id ? { ...w, nonce: w.nonce + 1 } : w)))
  const showDesktop = () => {
    setLauncher(false)
    setWindows(ws => ws.map(w => ({ ...w, minimized: true })))
  }

  const closeLauncher = useCallback(() => setLauncher(false), [])
  const launchpadPresence = usePresence(launchpad, LAUNCHER_EXIT_MS)
  const spotlightPresence = usePresence(spotlight, SPOTLIGHT_EXIT_MS)
  const closeQuickSearch = useCallback(() => setQuickSearch(false), [])

  const appFor = (id: WindowId) => {
    const appId = appIdOf(id)
    return appId ? apps.find(a => a.id === appId) : undefined
  }
  /** The app's name, for the menu bar. */
  const appNameOf = (id: WindowId) => (appIdOf(id) ? (appFor(id)?.name ?? 'App') : SYSTEM_WINDOWS[id as SystemWindowId].title)
  /** The window's own title: the document it shows, else the app's name. */
  const titleOf = (id: WindowId) => windowTitles[id] ?? appNameOf(id)

  // ----- Right-click menus -----

  // The Dock shows pinned apps; until the user pins any, it shows running apps with a web UI.
  // Native apps (outside Docker) can be many and odd; they join the Dock only when pinned.
  const autoDockIds = apps
    .filter(a => a.status === 'running' && a.port && a.source !== 'native')
    .slice(0, MAX_AUTO_DOCK)
    .map(a => a.id)
  const dockIds = settings.dockApps ?? autoDockIds
  const dockApps = dockIds.map(id => apps.find(a => a.id === id)).filter((a): a is InstalledApp => !!a)
  const togglePin = (id: string) =>
    update({ dockApps: dockIds.includes(id) ? dockIds.filter(d => d !== id) : [...dockIds, id] })

  // `extra` items come from where the menu opened (e.g. Launcher folders).
  const showAppMenu = (app: InstalledApp, anchor: MenuAnchor, extra: MenuItem[] = []) => {
    const windowId: WindowId = `app:${app.id}`
    const hasWindow = windows.some(w => w.id === windowId && !w.closing)
    show(
      anchor,
      appMenuItems(app, {
        busy: busy.has(app.id),
        onOpen: openAppWindow,
        onToggle: toggle,
        onUninstall: uninstall,
        onCloseWindow: hasWindow ? () => closeWindow(windowId) : undefined,
        pinned: dockIds.includes(app.id),
        onTogglePin: () => togglePin(app.id),
      }).concat(extra.length ? ['separator', ...extra] : []),
    )
  }

  const showSystemMenu = (id: SystemWindowId | 'launchpad', anchor: MenuAnchor, extra: MenuItem[] = []) => {
    if (id === 'launchpad') {
      show(anchor, [{ label: 'Open Launcher', icon: LayoutGrid, onSelect: () => setLauncher(true) }])
      return
    }
    const win = windows.find(w => w.id === id)
    const items: MenuItem[] = [{ label: win ? 'Show Window' : 'Open', icon: FolderOpen, onSelect: () => openWindow(id) }]
    if (win) {
      items.push(
        { label: 'Minimize', icon: Minus, disabled: win.minimized, onSelect: () => minimizeWindow(id) },
        'separator',
        { label: 'Close Window', icon: X, onSelect: () => closeWindow(id) },
      )
    }
    show(anchor, extra.length ? [...items, 'separator', ...extra] : items)
  }

  const startEditingWidgets = () => {
    setLauncher(false)
    update({ showWidgets: true })
    setEditingWidgets(true)
  }

  const showDesktopMenu = (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || isEditable(e.target)) return
    setDriveSelected(false)
    const dark = settings.theme === 'dark'
    // Widgets open their own menu (DesktopWidgets) and consume the event before it gets here.
    show(e, [
      { label: 'Open Files', icon: Folder, onSelect: () => openWindow('files') },
      { label: 'Open Terminal', icon: SquareTerminal, onSelect: () => openWindow('terminal') },
      { label: 'Open Code', icon: Braces, onSelect: () => openWindow('code') },
      'separator',
      { label: 'Change Wallpaper…', icon: Image, onSelect: () => openSettings('appearance') },
      { label: 'Dark Mode', icon: Moon, checked: dark, onSelect: () => update({ theme: dark ? 'light' : 'dark' }) },
      {
        label: 'Show Widgets',
        icon: LayoutDashboard,
        checked: settings.showWidgets,
        onSelect: () => update({ showWidgets: !settings.showWidgets }),
      },
      { label: 'Edit Widgets…', icon: LayoutTemplate, onSelect: startEditingWidgets },
      'separator',
      { label: 'Quick Search', icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: () => setQuickSearch(true) },
      { label: 'About This Server', icon: Info, onSelect: () => openSettings('general') },
    ])
  }

  const showDriveMenu = (e: MouseEvent<HTMLElement>) => {
    setDriveSelected(true)
    show(e, [
      { label: 'Open', icon: FolderOpen, onSelect: () => openWindow('files') },
      'separator',
      { label: 'Copy Path', icon: Copy, onSelect: () => void copyText('/DATA') },
    ])
  }

  // ----- Rendering -----

  // Windows still on screen; closing ones are only animating out.
  const liveWindows = windows.filter(w => !w.closing)
  const front = liveWindows
    .filter(w => !w.minimized)
    .reduce<WindowState | null>((top, w) => (!top || w.z > top.z ? w : top), null)
  const activeTitle = launchpad ? 'Launcher' : front ? appNameOf(front.id) : 'Desktop'

  // ----- Menu bar: changes with the frontmost app -----

  const menuBarContent = (): MenuBarContent => {
    const dark = settings.theme === 'dark'
    const viewItems: MenuItem[] = [
      { label: 'Dark Mode', icon: Moon, checked: dark, onSelect: () => update({ theme: dark ? 'light' : 'dark' }) },
      {
        label: 'Show Widgets',
        icon: LayoutDashboard,
        checked: settings.showWidgets,
        onSelect: () => update({ showWidgets: !settings.showWidgets }),
      },
      { label: 'Edit Widgets…', icon: LayoutTemplate, onSelect: startEditingWidgets },
      'separator',
      { label: 'Change Wallpaper…', icon: Image, onSelect: () => openSettings('appearance') },
    ]
    const goItems: MenuItem[] = [
      { label: 'Launcher', icon: LayoutGrid, onSelect: () => setLauncher(true) },
      'separator',
      ...SYSTEM_APPS.map(app => ({ label: app.label, onSelect: () => openWindow(app.id) })),
    ]

    const windowMenu: AppMenu = {
      label: 'Window',
      items: [
        { label: 'Minimize', icon: Minus, disabled: !front, onSelect: () => front && minimizeWindow(front.id) },
        {
          label: front?.maximized ? 'Exit Zoom' : 'Zoom',
          icon: front?.maximized ? Minimize2 : Maximize2,
          disabled: !front,
          onSelect: () => front && toggleZoom(front.id),
        },
        { label: 'Close Window', icon: X, disabled: !front, onSelect: () => front && closeWindow(front.id) },
        'separator',
        { label: 'Show Desktop', icon: Monitor, disabled: liveWindows.length === 0, onSelect: showDesktop },
        ...(liveWindows.length ? (['separator'] as MenuItem[]) : []),
        ...liveWindows.map(w => ({
          label: w.minimized ? `${titleOf(w.id)} (minimized)` : titleOf(w.id),
          checked: w.id === front?.id,
          onSelect: () => openWindow(w.id),
        })),
      ],
    }
    const helpMenu: AppMenu = {
      label: 'Help',
      items: [
        { label: 'Quick Search', icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: () => setQuickSearch(true) },
        { label: 'About TemanLabsOS', icon: Info, onSelect: () => openSettings('about') },
      ],
    }

    if (!front || launchpad) {
      return {
        appName: activeTitle,
        appMenu: [
          { label: 'About This Server', icon: Info, onSelect: () => openSettings('general') },
          { label: 'Settings…', icon: SettingsIcon, onSelect: () => openSettings('appearance') },
          'separator',
          { label: 'Quick Search', icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: () => setQuickSearch(true) },
        ],
        menus: [{ label: 'View', items: viewItems }, { label: 'Go', items: goItems }, windowMenu, helpMenu],
      }
    }

    const title = appNameOf(front.id)
    const hideQuit: MenuItem[] = [
      { label: `Hide ${title}`, icon: EyeOff, onSelect: () => minimizeWindow(front.id) },
      { label: `Quit ${title}`, icon: Power, onSelect: () => closeWindow(front.id) },
    ]

    const app = appFor(front.id)
    if (app) {
      const running = app.status === 'running'
      return {
        appName: title,
        appMenu: [
          { label: `About ${title}`, icon: Info, onSelect: () => openStore('Installed') },
          'separator',
          {
            label: running ? `Stop ${title}` : `Start ${title}`,
            icon: running ? Square : Play,
            disabled: busy.has(app.id) || app.status === 'installing',
            onSelect: () => toggle(app),
          },
          'separator',
          ...hideQuit,
        ],
        menus: [
          {
            label: 'View',
            items: [
              { label: 'Reload', icon: RotateCw, onSelect: () => reloadWindow(front.id) },
              { label: 'Open in New Tab', icon: ExternalLink, disabled: !running, onSelect: () => openInTab(app) },
              { label: 'Copy Address', icon: Link, disabled: !appUrl(app), onSelect: () => void copyText(appUrl(app) ?? '') },
            ],
          },
          windowMenu,
          helpMenu,
        ],
      }
    }

    return {
      appName: title,
      appMenu: [
        { label: `About ${title}`, icon: Info, onSelect: () => openSettings('about') },
        ...(front.id === 'settings'
          ? []
          : [{ label: 'Settings…', icon: SettingsIcon, onSelect: () => openSettings('appearance') }]),
        'separator',
        ...hideQuit,
      ],
      menus: [...(menuBuilders.current.get(front.id)?.() ?? []), windowMenu, helpMenu],
    }
  }

  menuContentRef.current = menuBarContent

  const renderWindow = (w: WindowState) => {
    const appId = appIdOf(w.id)
    if (appId) return <AppView key={w.nonce} app={appFor(w.id)} busy={busy.has(appId)} onToggle={toggle} />
    switch (w.id as SystemWindowId) {
      case 'store':
        return (
          <AppCenter
            apps={apps}
            busy={busy}
            category={storeCategory}
            onCategoryChange={setStoreCategory}
            onInstall={install}
            onInstallCustom={installCustom}
            onToggle={toggle}
            onUninstall={uninstall}
            onOpenApp={openAppWindow}
          />
        )
      case 'files':
        return (
          <Files
            onOpenFile={path => openInEditor(path)}
            onOpenFolder={path => openInEditor(path, 'folder')}
            onOpenMedia={openMedia}
            onShareFolder={path => {
              setShareRequest({ path, nonce: Date.now() })
              openWindow('sharing')
            }}
          />
        )
      case 'code':
        return <CodeEditor stats={stats} request={editorRequest} />
      case 'settings':
        return <Settings stats={stats} section={settingsSection} onSectionChange={setSettingsSection} />
      case 'terminal':
        return <Terminal onTitle={t => setWindowTitle('terminal', t)} />
      case 'preview':
        return <PhotoViewer request={mediaRequests.preview ?? null} onTitle={t => setWindowTitle('preview', t)} />
      case 'video':
        return <VideoPlayer request={mediaRequests.video ?? null} onTitle={t => setWindowTitle('video', t)} />
      case 'music':
        return <MusicPlayer request={mediaRequests.music ?? null} onTitle={t => setWindowTitle('music', t)} />
      case 'updates':
        return <SystemUpdates />
      case 'console':
        return <LogViewer />
      case 'disks':
        return <DiskManager />
      case 'network':
        return <NetworkTools />
      case 'scheduler':
        return <ScheduledTasks />
      case 'kubernetes':
        return <Kubernetes />
      case 'sharing':
        return <Sharing stats={stats} request={shareRequest} />
      case 'activity':
        return <SystemMonitor apps={apps} stats={stats} onOpenApp={openAppWindow} />
    }
  }

  const appChrome = (w: WindowState) => {
    const app = appFor(w.id)
    if (!app) return {}
    return {
      center: (
        <span className="url-pill">
          <Globe size={12} /> {app.port ? `${location.hostname}:${app.port}` : 'No web interface'}
        </span>
      ),
      actions: (
        <>
          <button className="icon-btn" onClick={() => reloadWindow(w.id)} aria-label="Reload">
            <RotateCw size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => openInTab(app)}
            disabled={app.status !== 'running'}
            aria-label="Open in new tab"
          >
            <ExternalLink size={14} />
          </button>
        </>
      ),
    }
  }

  return (
    <MenuRegistryContext.Provider value={menuRegistry}>
    {/* The browser's own context menu is replaced everywhere except in text fields. */}
    <div className="os" onContextMenu={e => !isEditable(e.target) && e.preventDefault()}>
      <Wallpaper />

      <main
        className="desktop"
        onPointerDown={e => {
          if (e.target !== e.currentTarget || e.button !== 0) return
          setDriveSelected(false)
          // Clicking empty desktop finishes editing widgets.
          setEditingWidgets(false)
        }}
        onContextMenu={showDesktopMenu}
      >
        {stats && settings.showWidgets && (
          <DesktopWidgets
            stats={stats}
            history={history}
            apps={apps}
            editing={editingWidgets}
            onEditingChange={setEditingWidgets}
            onOpenFiles={() => openWindow('files')}
            onLauncher={() => setLauncher(true)}
            onManageApps={() => openStore('Installed')}
          />
        )}
        <div className="desktop-icons">
          <button
            className={`desk-icon ${driveSelected ? 'is-selected' : ''}`}
            onClick={() => setDriveSelected(true)}
            onDoubleClick={() => openWindow('files')}
            onContextMenu={showDriveMenu}
            title="Double-click to open"
          >
            <AppIcon icon="drive" color={['#9aa6bd', '#4b5568']} size={64} />
            <span>DATA</span>
          </button>
        </div>
      </main>

      <div className="window-layer">
        {windows.map(w => (
          <Window
            key={w.id}
            id={w.id}
            title={titleOf(w.id)}
            frame={w.frame}
            z={w.z}
            minimized={w.minimized}
            maximized={w.maximized}
            closing={w.closing}
            active={w.id === front?.id}
            variant={WINDOW_VARIANT[w.id as SystemWindowId] ?? 'default'}
            {...appChrome(w)}
            onFocus={() => focusWindow(w.id)}
            onClose={() => closeWindow(w.id)}
            onClosed={() => removeWindow(w.id)}
            onMinimize={() => minimizeWindow(w.id)}
            onToggleZoom={() => toggleZoom(w.id)}
          >
            {renderWindow(w)}
          </Window>
        ))}
      </div>

      {launchpadPresence.mounted && (
        <Launcher
          closing={launchpadPresence.closing}
          apps={apps}
          onClose={closeLauncher}
          onOpenApp={openAppWindow}
          onOpenWindow={openWindow}
          onAppMenu={showAppMenu}
          onSystemMenu={showSystemMenu}
        />
      )}

      <Dock
        apps={[
          ...dockApps,
          // Apps with an open window appear in the Dock even when not kept there.
          ...apps.filter(a => !dockIds.includes(a.id) && liveWindows.some(w => w.id === `app:${a.id}`)),
        ]}
        openIds={liveWindows.map(w => w.id)}
        onLauncher={() => setLauncher(open => !open)}
        onOpenWindow={openWindow}
        onOpenApp={openAppWindow}
        onAppMenu={showAppMenu}
        onSystemMenu={showSystemMenu}
      />

      <MenuBar
        getContent={menuBarContent}
        cpu={stats?.cpu.usage}
        addresses={stats?.addresses}
        onOpenWindow={openWindow}
        onQuickSearch={() => setQuickSearch(true)}
        onPower={action => void api.power(action).then(() => setPowering(action))}
      />

      {powering && <PowerOverlay action={powering} />}

      {spotlightPresence.mounted && (
        <QuickSearch
          closing={spotlightPresence.closing}
          apps={apps}
          onClose={closeQuickSearch}
          onOpenApp={openAppWindow}
          onOpenWindow={openWindow}
          onLauncher={() => setLauncher(true)}
          onShowDesktop={showDesktop}
        />
      )}

      {toast && (
        <Glass radius={18} bezel={10} depth={10} blur={18} className="toast tint-panel" role="alert" key={toast.id}>
          <TriangleAlert size={16} />
          <span>{toast.message}</span>
          <button className="icon-btn" onClick={() => setToast(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </Glass>
      )}
    </div>
    </MenuRegistryContext.Provider>
  )
}
