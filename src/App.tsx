import { tr } from './lib/i18n'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent } from 'react'
import {
  Braces,
  Copy,
  EyeOff,
  ExternalLink,
  Folder,
  FolderOpen,
  Trash2,
  Globe,
  Image,
  Info,
  LayoutDashboard,
  ClipboardPaste,
  FolderPlus,
  Redo2,
  Scissors,
  TextSelect,
  Undo2,
  HardDrive,
  Keyboard,
  LayoutGrid,
  PanelBottom,
  LayoutTemplate,
  Link,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Pin,
  PinOff,
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
import { api, ApiError } from './api'
import { usePlaces } from './hooks/usePlaces'
import { DATA_ROOT, TRASH_PLACE } from './lib/places'
import type { Device, InstalledApp } from './api/types'
import { AppIcon } from './components/AppIcon'
import type { MenuAnchor, MenuItem } from './components/ContextMenu'
import { DesktopWidgets } from './components/DesktopWidgets'
import { Dock } from './components/Dock'
import { Glass } from './components/Glass'
import { Launcher } from './components/Launcher'
import { MenuBar, QUICK_SEARCH_SHORTCUT, type MenuBarContent } from './components/MenuBar'
import { QuickSearch } from './components/QuickSearch'
import { Wallpaper } from './components/Wallpaper'
import { Window, type Frame, type SystemWindowId, type WindowId, type SnapZone } from './components/Window'
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
import { SYSTEM_APPS, VIEWER_APPS } from './lib/systemApps'
import { AppCenter, type StoreCategory } from './windows/AppCenter'
import { SystemMonitor } from './windows/SystemMonitor'
import { Sharing, type ShareRequest } from './windows/Sharing'
import { PowerOverlay } from './components/PowerOverlay'
import { AppSettings, type SettingsRequest } from './components/AppSettings'
import { useAppUpdates } from './hooks/useAppUpdates'
import { useSystemBadges } from './hooks/useSystemBadges'
import { LogViewer } from './windows/LogViewer'
import { DiskManager } from './windows/DiskManager'
import { NetworkTools } from './windows/NetworkTools'
import { ScheduledTasks } from './windows/ScheduledTasks'
import { SystemUpdates } from './windows/SystemUpdates'
import { Kubernetes } from './windows/Kubernetes'
import { MusicPlayer } from './windows/MusicPlayer'
import { PhotoViewer } from './windows/PhotoViewer'
import { VideoPlayer } from './windows/VideoPlayer'
import { Remux } from './windows/Remux'
import { Commands } from './windows/Commands'
import { Devices } from './windows/Devices'
import { RemoteScreen } from './windows/RemoteScreen'
import { FileInfo } from './components/FileInfo'
import { AppView } from './windows/AppView'
import { CodeEditor, type OpenRequest } from './windows/CodeEditor'
import { Files } from './windows/Files'
import { Settings, type SettingsSection } from './windows/Settings'
import { AboutServer } from './windows/AboutServer'
import { WindowErrorBoundary } from './components/WindowErrorBoundary'
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
  /** Snapped into part of the desktop. */
  snap?: SnapZone | null
  /** Covering the whole screen (the green button). */
  fullscreen?: boolean
}

const SYSTEM_WINDOWS: Record<SystemWindowId, { title: string; width: number; height: number }> = {
  store: { title: tr('App Center'), width: 940, height: 600 },
  files: { title: tr('Files'), width: 820, height: 520 },
  code: { title: tr('Code'), width: 1120, height: 700 },
  settings: { title: tr('Settings'), width: 860, height: 690 },
  terminal: { title: tr('Terminal'), width: 680, height: 420 },
  activity: { title: tr('System Monitor'), width: 980, height: 600 },
  sharing: { title: tr('File Sharing'), width: 900, height: 600 },
  updates: { title: tr('System Updates'), width: 760, height: 620 },
  console: { title: tr('Log Viewer'), width: 1080, height: 660 },
  disks: { title: tr('Disk Manager'), width: 900, height: 620 },
  network: { title: tr('Network Tools'), width: 900, height: 600 },
  scheduler: { title: tr('Scheduled Tasks'), width: 860, height: 560 },
  kubernetes: { title: tr('Kubernetes'), width: 1080, height: 680 },
  music: { title: tr('Music Player'), width: 760, height: 600 },
  preview: { title: tr('Image Viewer'), width: 920, height: 640 },
  video: { title: tr('Video Player'), width: 960, height: 600 },
  remux: { title: tr('Remux'), width: 980, height: 640 },
  commands: { title: tr('Commands'), width: 1040, height: 680 },
  devices: { title: tr('Devices'), width: 900, height: 600 },
  about: { title: tr('About This Server'), width: 300, height: 430 },
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
  // A slim title bar for windows with nothing in it but their title.
  terminal: 'compact',
  video: 'compact',
  code: 'compact',
  music: 'compact',
  remux: 'compact',
  devices: 'compact',
  about: 'compact',
  commands: 'sidebar',
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
/** Get Info windows: one per file, "info:<path>". */
const infoPathOf = (id: WindowId) => (id.startsWith('info:') ? id.slice(5) : null)
const INFO_WINDOW_SIZE = { width: 330, height: 600 }
/** Remote screens: one per device, "remote:<device id>". */
const remoteIdOf = (id: WindowId) => (id.startsWith('remote:') ? id.slice(7) : null)
const REMOTE_WINDOW_SIZE = { width: 1280, height: 820 }

function initialFrame(id: WindowId, cascade: number): Frame {
  const size = appIdOf(id) ? APP_WINDOW_SIZE : infoPathOf(id) ? INFO_WINDOW_SIZE : remoteIdOf(id) ? REMOTE_WINDOW_SIZE : SYSTEM_WINDOWS[id as SystemWindowId]
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
  const { apps, busy, install, installCustom, uninstall, toggle, refresh: refreshApps } = useApps()
  const appUpdates = useAppUpdates()
  const systemBadges = useSystemBadges()
  const [settingsRequest, setSettingsRequest] = useState<SettingsRequest | null>(null)
  const openAppSettings = (app: InstalledApp, options: { tab?: 'terminal'; update?: boolean } = {}) =>
    setSettingsRequest({ app, ...options, nonce: Date.now() })
  const { settings, update } = useSettings()
  // Folders for the desktop's Go menu.
  const places = usePlaces()
  const { show } = useContextMenu()
  const [windows, setWindows] = useState<WindowState[]>([])
  // The devices whose screens are open (their windows are "remote:<id>").
  const [remoteDevices, setRemoteDevices] = useState<Record<string, Device>>({})
  const [launchpad, setLauncher] = useState(false)
  const [spotlight, setQuickSearch] = useState(false)
  const [driveSelected, setDriveSelected] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [storeCategory, setStoreCategory] = useState<StoreCategory>('All')
  const [editorRequest, setEditorRequest] = useState<OpenRequest | null>(null)
  const [powering, setPowering] = useState<'restart' | 'shutdown' | null>(null)
  const [shareRequest, setShareRequest] = useState<ShareRequest | null>(null)
  const [remuxRequest, setRemuxRequest] = useState<MediaRequest | null>(null)
  // A command from Commands, to put on the Terminal's prompt.
  const [terminalInput, setTerminalInput] = useState<{ text: string; nonce: number } | null>(null)
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
      // Requests turned away by the lock screen aren't errors to report.
      if (e.reason instanceof ApiError && e.reason.status === 423) {
        e.preventDefault()
        return
      }
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

  // App health: a note when an app stops answering, and when it's back.
  const healthSeen = useRef<Record<string, string>>({})
  useEffect(() => {
    let timer = 0
    const check = () =>
      api.appHealth().then(list => {
        const before = healthSeen.current
        for (const h of list) {
          const name = apps.find(a => a.id === h.id)?.name
          const was = before[h.id]
          if (name && was && was !== h.status) {
            const message =
              h.status === 'down'
                ? h.autoRestart
                  ? tr('{0} isn’t responding. TemanLabsOS is restarting it.', name)
                  : tr('{0} isn’t responding.', name)
                : was === 'down' && h.status === 'up'
                  ? tr('{0} is responding again.', name)
                  : null
            if (message) {
              clearTimeout(timer)
              setToast({ id: Date.now(), message })
              timer = window.setTimeout(() => setToast(null), TOAST_MS)
            }
          }
        }
        healthSeen.current = Object.fromEntries(list.map(h => [h.id, h.status]))
      }, () => {})
    void check()
    const poll = setInterval(check, 60_000)
    return () => {
      clearInterval(poll)
      clearTimeout(timer)
    }
  }, [apps])

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
      if (!item.disabled) item.onSelect?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openWindow = (id: WindowId) => {
    setLauncher(false)
    // The Launcher's "Recently Used": its keys are a built-in app's id or "app:<id>", as window ids are.
    if (id.startsWith('app:') || SYSTEM_APPS.some(a => a.id === id))
      update(s => (s.recentApps?.[0] === id ? {} : { recentApps: [id, ...(s.recentApps ?? []).filter(k => k !== id)].slice(0, 16) }))
    const z = ++topZ.current
    setWindows(ws =>
      ws.some(w => w.id === id)
        ? ws.map(w => (w.id === id ? { ...w, z, minimized: false, closing: false } : w))
        : [...ws, { id, z, minimized: false, maximized: false, frame: initialFrame(id, ws.length), nonce: 0 }],
    )
  }
  const openAppWindow = (app: InstalledApp) => openWindow(`app:${app.id}`)
  const [filesOpen, setFilesOpen] = useState<{ path: string; nonce: number } | null>(null)
  // The text field the desktop's Edit menu works on: the last one with the keyboard.
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) lastField.current = e.target
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
  const openFilesAt = (path: string) => {
    setFilesOpen({ path, nonce: Date.now() })
    openWindow('files')
  }
  const openRemote = (device: Device) => {
    setRemoteDevices(m => ({ ...m, [device.id]: device }))
    openWindow(`remote:${device.id}`)
  }
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
    setWindows(ws => ws.map(w => (w.id === id ? { ...w, maximized: !(w.maximized || w.snap), snap: null, fullscreen: false } : w)))
  const snapWindow = (id: WindowId, zone: SnapZone | null) =>
    setWindows(ws =>
      ws.map(w => (w.id === id ? { ...w, maximized: zone === 'fill', snap: zone === 'fill' ? null : zone, fullscreen: false } : w)),
    )
  const toggleFullscreen = (id: WindowId) => setWindows(ws => ws.map(w => (w.id === id ? { ...w, fullscreen: !w.fullscreen } : w)))
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
  const appNameOf = (id: WindowId) =>
    appIdOf(id)
      ? (appFor(id)?.name ?? 'App')
      : infoPathOf(id)
        ? SYSTEM_WINDOWS.files.title
        : remoteIdOf(id)
          ? SYSTEM_WINDOWS.devices.title
          : SYSTEM_WINDOWS[id as SystemWindowId].title
  /** The window's own title: the document it shows, else the app's name. */
  const titleOf = (id: WindowId) => windowTitles[id] ?? remoteDevices[remoteIdOf(id) ?? '']?.name ?? appNameOf(id)

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
  // Built-in apps: the main ones by default; utilities (Remux, Disk Manager…) once pinned.
  const dockSystemIds = settings.dockSystem ?? SYSTEM_APPS.filter(a => a.dock !== false).map(a => a.id)
  const toggleSystemPin = (id: string) =>
    update({ dockSystem: dockSystemIds.includes(id) ? dockSystemIds.filter(d => d !== id) : [...dockSystemIds, id] })
  /** Puts id at index in a list (moving it if it's there already). */
  const placeAt = (list: string[], id: string, index: number) => {
    const rest = list.filter(x => x !== id)
    rest.splice(Math.min(index, rest.length), 0, id)
    return rest
  }
  /** An app dragged from the Launcher onto the Dock, at a place among its group (Launcher keys: "app:<id>" or a built-in app's id). */
  const pinDropped = (key: string, index: number) => {
    if (key.startsWith('app:')) {
      const id = key.slice(4)
      if (apps.some(a => a.id === id)) update({ dockApps: placeAt(dockIds, id, index) })
    } else if ([...SYSTEM_APPS, ...VIEWER_APPS].some(a => a.id === key)) {
      update({ dockSystem: placeAt(dockSystemIds, key, index) })
    }
  }

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
        onSettings: openAppSettings,
        updateAvailable: appUpdates.available(app.id),
        onCloseWindow: hasWindow ? () => closeWindow(windowId) : undefined,
        pinned: dockIds.includes(app.id),
        onTogglePin: () => togglePin(app.id),
      }).concat(extra.length ? ['separator', ...extra] : []),
    )
  }

  const showSystemMenu = (id: SystemWindowId | 'launchpad', anchor: MenuAnchor, extra: MenuItem[] = []) => {
    if (id === 'launchpad') {
      show(anchor, [{ label: tr('Open Launcher'), icon: LayoutGrid, onSelect: () => setLauncher(true) }])
      return
    }
    const win = windows.find(w => w.id === id)
    const pinned = dockSystemIds.includes(id)
    const items: MenuItem[] = [
      { label: win ? tr('Show Window') : tr('Open'), icon: FolderOpen, onSelect: () => openWindow(id) },
      { label: pinned ? tr('Remove from Dock') : tr('Keep in Dock'), icon: pinned ? PinOff : Pin, onSelect: () => toggleSystemPin(id) },
    ]
    if (win) {
      items.push(
        'separator',
        { label: tr('Minimize'), icon: Minus, disabled: win.minimized, onSelect: () => minimizeWindow(id) },
        { label: tr('Close Window'), icon: X, onSelect: () => closeWindow(id) },
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
      { label: tr('Open Files'), icon: Folder, onSelect: () => openWindow('files') },
      { label: tr('Open Terminal'), icon: SquareTerminal, onSelect: () => openWindow('terminal') },
      { label: tr('Open Code'), icon: Braces, onSelect: () => openWindow('code') },
      'separator',
      { label: tr('Get Info'), icon: Info, onSelect: () => openWindow(`info:${DATA_ROOT}`) },
      { label: tr('Change Wallpaper…'), icon: Image, onSelect: () => openSettings('wallpaper') },
      { label: tr('Edit Widgets…'), icon: LayoutTemplate, onSelect: startEditingWidgets },
      'separator',
      {
        label: tr('Show Widgets'),
        icon: LayoutDashboard,
        checked: settings.showWidgets,
        onSelect: () => update({ showWidgets: !settings.showWidgets }),
      },
      { label: tr('Show Data Drive'), icon: HardDrive, checked: settings.showDesktopDrive, onSelect: () => update({ showDesktopDrive: !settings.showDesktopDrive }) },
      { label: tr('Dark Mode'), icon: Moon, checked: dark, onSelect: () => update({ theme: dark ? 'light' : 'dark' }) },
      { label: tr('Desktop & Dock Settings…'), icon: PanelBottom, onSelect: () => openSettings('dock') },
      'separator',
      { label: tr('Quick Search'), icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: () => setQuickSearch(true) },
      { label: tr('About This Server'), icon: Info, onSelect: () => openWindow('about') },
    ])
  }

  const showDriveMenu = (e: MouseEvent<HTMLElement>) => {
    setDriveSelected(true)
    show(e, [
      { label: tr('Open'), icon: FolderOpen, onSelect: () => openWindow('files') },
      'separator',
      { label: tr('Copy Path'), icon: Copy, onSelect: () => void copyText('/DATA') },
    ])
  }

  // ----- Rendering -----

  // Windows still on screen; closing ones are only animating out.
  const liveWindows = windows.filter(w => !w.closing)
  const front = liveWindows
    .filter(w => !w.minimized)
    .reduce<WindowState | null>((top, w) => (!top || w.z > top.z ? w : top), null)
  const activeTitle = launchpad ? tr('Launcher') : front ? appNameOf(front.id) : tr('Desktop')

  // ----- Full screen: the front window covers the screen -----
  // The menu bar and the Dock slide away (they come back while the pointer is at the top or
  // bottom edge), and the browser goes full screen too.
  const fullscreenFront = !!front?.fullscreen && !launchpad
  const [reveal, setReveal] = useState<'top' | 'bottom' | null>(null)
  useEffect(() => {
    const root = document.documentElement
    if (fullscreenFront) root.dataset.fullscreen = 'on'
    else delete root.dataset.fullscreen
    if (fullscreenFront && !document.fullscreenElement) void root.requestFullscreen?.().catch(() => {})
    if (!fullscreenFront && document.fullscreenElement === root) void document.exitFullscreen().catch(() => {})
    if (!fullscreenFront) setReveal(null)
  }, [fullscreenFront])
  useEffect(() => {
    if (reveal) document.documentElement.dataset.reveal = reveal
    else delete document.documentElement.dataset.reveal
  }, [reveal])
  const dockHides = fullscreenFront || settings.dockAutohide
  useEffect(() => {
    if (!dockHides) setReveal(null)
  }, [dockHides])
  useEffect(() => {
    if (!dockHides) return
    const move = (e: PointerEvent) => {
      const h = window.innerHeight
      setReveal(r => {
        if (fullscreenFront && e.clientY <= 2) return 'top'
        if (e.clientY >= h - 2) return 'bottom'
        // Stay out while the pointer is on what came out (or a menu opened from it).
        if (r === 'top' && (e.clientY < 48 || document.querySelector('.menu'))) return r
        if (r === 'bottom' && e.clientY > h - 120) return r
        return null
      })
    }
    // Esc (or the browser's own control) left full screen: so does the window.
    const left = () => {
      if (!document.fullscreenElement && front) setWindows(ws => ws.map(w => (w.id === front.id ? { ...w, fullscreen: false } : w)))
    }
    window.addEventListener('pointermove', move)
    document.addEventListener('fullscreenchange', left)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('fullscreenchange', left)
    }
  }, [dockHides, fullscreenFront, front?.id])

  // ----- Menu bar: changes with the frontmost app -----

  const menuBarContent = (): MenuBarContent => {
    const dark = settings.theme === 'dark'
    const fileItems: MenuItem[] = [
      { label: tr('New Files Window'), icon: Folder, onSelect: () => openWindow('files') },
      { label: tr('New Terminal'), icon: SquareTerminal, onSelect: () => openWindow('terminal') },
      { label: tr('New Code Window'), icon: Braces, onSelect: () => openWindow('code') },
      'separator',
      { label: tr('New Folder in {0}', DATA_ROOT), icon: FolderPlus, onSelect: () => openFilesAt(DATA_ROOT) },
      { label: tr('Get Info'), icon: Info, onSelect: () => openWindow(`info:${DATA_ROOT}`) },
      'separator',
      { label: tr('Close Window'), icon: X, disabled: !front, onSelect: () => front && closeWindow(front.id) },
    ]
    const field = lastField.current?.isConnected && !lastField.current.disabled ? lastField.current : null
    const selected = !!field && field.selectionStart !== field.selectionEnd
    // execCommand is the only way to undo, cut or copy in a field the way typing does.
    const inField = (command: string) => () => {
      field?.focus()
      document.execCommand(command)
    }
    const editItems: MenuItem[] = [
      { label: tr('Undo'), icon: Undo2, disabled: !field, onSelect: inField('undo') },
      { label: tr('Redo'), icon: Redo2, disabled: !field, onSelect: inField('redo') },
      'separator',
      { label: tr('Cut'), icon: Scissors, disabled: !selected, onSelect: inField('cut') },
      { label: tr('Copy'), icon: Copy, disabled: !selected, onSelect: inField('copy') },
      {
        label: tr('Paste'),
        icon: ClipboardPaste,
        // Reading the clipboard needs a secure page (https or localhost).
        disabled: !field || !window.isSecureContext || !navigator.clipboard?.readText,
        onSelect: () => {
          if (!field) return
          void navigator.clipboard.readText().then(text => {
            field.focus()
            document.execCommand('insertText', false, text)
          })
        },
      },
      { label: tr('Select All'), icon: TextSelect, disabled: !field, onSelect: () => field && (field.focus(), field.select()) },
      'separator',
      { label: tr('Quick Search'), icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: () => setQuickSearch(true) },
    ]
    const viewItems: MenuItem[] = [
      { label: tr('Dark Mode'), icon: Moon, checked: dark, onSelect: () => update({ theme: dark ? 'light' : 'dark' }) },
      {
        label: tr('Show Widgets'),
        icon: LayoutDashboard,
        checked: settings.showWidgets,
        onSelect: () => update({ showWidgets: !settings.showWidgets }),
      },
      { label: tr('Edit Widgets…'), icon: LayoutTemplate, onSelect: startEditingWidgets },
      { label: tr('Show Data Drive'), icon: HardDrive, checked: settings.showDesktopDrive, onSelect: () => update({ showDesktopDrive: !settings.showDesktopDrive }) },
      'separator',
      { label: tr('Hide the Dock Automatically'), icon: PanelBottom, checked: settings.dockAutohide, onSelect: () => update({ dockAutohide: !settings.dockAutohide }) },
      { label: tr('Change Wallpaper…'), icon: Image, onSelect: () => openSettings('wallpaper') },
      { label: tr('Desktop & Dock Settings…'), icon: SettingsIcon, onSelect: () => openSettings('dock') },
    ]
    const goItems: MenuItem[] = [
      ...places.favorites.map(p => ({ label: p.label, icon: p.icon, onSelect: () => openFilesAt(p.path) })),
      ...(places.locations.length ? (['separator'] as MenuItem[]) : []),
      ...places.locations.map(p => ({ label: p.label, icon: p.icon, onSelect: () => openFilesAt(p.path) })),
      'separator',
      { label: tr('Launcher'), icon: LayoutGrid, onSelect: () => setLauncher(true) },
      {
        label: tr('Apps'),
        icon: LayoutGrid,
        submenu: SYSTEM_APPS.map(app => ({ label: app.label, onSelect: () => openWindow(app.id) })),
      },
      { label: tr('Devices'), icon: Monitor, onSelect: () => openWindow('devices') },
      { label: tr('Network Tools'), icon: Link, onSelect: () => openWindow('network') },
    ]

    const windowMenu: AppMenu = {
      label: tr('Window'),
      items: [
        { label: tr('Minimize'), icon: Minus, disabled: !front, onSelect: () => front && minimizeWindow(front.id) },
        {
          label: front?.maximized ? tr('Exit Zoom') : tr('Zoom'),
          icon: front?.maximized ? Minimize2 : Maximize2,
          disabled: !front,
          onSelect: () => front && toggleZoom(front.id),
        },
        { label: tr('Close Window'), icon: X, disabled: !front, onSelect: () => front && closeWindow(front.id) },
        'separator',
        { label: tr('Show Desktop'), icon: Monitor, disabled: liveWindows.length === 0, onSelect: showDesktop },
        ...(liveWindows.length ? (['separator'] as MenuItem[]) : []),
        ...liveWindows.map(w => ({
          label: w.minimized ? tr('{0} (minimized)', titleOf(w.id)) : titleOf(w.id),
          checked: w.id === front?.id,
          onSelect: () => openWindow(w.id),
        })),
      ],
    }
    const helpMenu: AppMenu = {
      label: tr('Help'),
      items: [
        { label: tr('Quick Search'), icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: () => setQuickSearch(true) },
        { label: tr('Keyboard Shortcuts'), icon: Keyboard, onSelect: () => openSettings('keyboard') },
        { label: tr('Commands'), icon: SquareTerminal, onSelect: () => openWindow('commands') },
        'separator',
        { label: tr('About TemanLabsOS'), icon: Info, onSelect: () => openSettings('about') },
      ],
    }

    if (!front || launchpad) {
      return {
        appName: activeTitle,
        appMenu: [
          { label: tr('About This Server'), icon: Info, onSelect: () => openWindow('about') },
          { label: tr('Settings…'), icon: SettingsIcon, onSelect: () => openSettings('general') },
          'separator',
          { label: tr('Quick Search'), icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: () => setQuickSearch(true) },
        ],
        menus: [{ label: tr('File'), items: fileItems }, { label: tr('Edit'), items: editItems }, { label: tr('View'), items: viewItems }, { label: tr('Go'), items: goItems }, windowMenu, helpMenu],
      }
    }

    const title = appNameOf(front.id)
    const hideQuit: MenuItem[] = [
      { label: tr('Hide {0}', title), icon: EyeOff, onSelect: () => minimizeWindow(front.id) },
      { label: tr('Quit {0}', title), icon: Power, onSelect: () => closeWindow(front.id) },
    ]

    const app = appFor(front.id)
    if (app) {
      const running = app.status === 'running'
      return {
        appName: title,
        appMenu: [
          { label: tr('About {0}', title), icon: Info, onSelect: () => openStore('Installed') },
          'separator',
          {
            label: running ? tr('Stop {0}', title) : tr('Start {0}', title),
            icon: running ? Square : Play,
            disabled: busy.has(app.id) || app.status === 'installing',
            onSelect: () => toggle(app),
          },
          'separator',
          ...hideQuit,
        ],
        menus: [
          {
            label: tr('View'),
            items: [
              { label: tr('Reload'), icon: RotateCw, onSelect: () => reloadWindow(front.id) },
              { label: tr('Open in New Tab'), icon: ExternalLink, disabled: !running, onSelect: () => openInTab(app) },
              { label: tr('Copy Address'), icon: Link, disabled: !appUrl(app), onSelect: () => void copyText(appUrl(app) ?? '') },
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
        { label: tr('About {0}', title), icon: Info, onSelect: () => openSettings('about') },
        ...(front.id === 'settings'
          ? []
          : [{ label: tr('Settings…'), icon: SettingsIcon, onSelect: () => openSettings('general') }]),
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
    const infoPath = infoPathOf(w.id)
    if (infoPath) return <FileInfo path={infoPath} onTitle={t => setWindowTitle(w.id, t)} />
    const remote = remoteDevices[remoteIdOf(w.id) ?? '']
    if (remote) return <RemoteScreen device={remote} active={w.id === front?.id} />
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
            onSettings={openAppSettings}
            onInstalled={() => void refreshApps()}
            updates={appUpdates}
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
            onConvert={path => {
              setRemuxRequest({ path, nonce: Date.now() })
              openWindow('remux')
            }}
            onGetInfo={path => openWindow(`info:${path}`)}
            open={filesOpen}
          />
        )
      case 'code':
        return <CodeEditor stats={stats} request={editorRequest} />
      case 'settings':
        return (
          <Settings
            stats={stats}
            section={settingsSection}
            onSectionChange={setSettingsSection}
            onOpenWindow={openWindow}
            onPower={action => void api.power(action).then(() => setPowering(action))}
            onEditWidgets={() => {
              // The desktop has to be visible to arrange widgets.
              minimizeWindow('settings')
              startEditingWidgets()
            }}
            appUpdates={appUpdates.count}
            onOpenAppUpdates={() => openStore('Updates')}
            apps={apps}
            appActions={{
              busy,
              onOpen: openAppWindow,
              onToggle: toggle,
              onUninstall: uninstall,
              onSettings: openAppSettings,
              updateAvailable: appUpdates.available,
              onOpenStore: () => openStore('All'),
              onRefresh: () => void refreshApps(),
            }}
          />
        )
      case 'terminal':
        return <Terminal onTitle={t => setWindowTitle('terminal', t)} input={terminalInput} onFindCommand={() => openWindow('commands')} />
      case 'preview':
        return <PhotoViewer request={mediaRequests.preview ?? null} onTitle={t => setWindowTitle('preview', t)} />
      case 'video':
        return (
          <VideoPlayer
            request={mediaRequests.video ?? null}
            onTitle={t => setWindowTitle('video', t)}
            onConvert={path => {
              setRemuxRequest({ path, nonce: Date.now() })
              openWindow('remux')
            }}
          />
        )
      case 'devices':
        return <Devices onConnect={openRemote} />
      case 'about':
        return <AboutServer stats={stats} onMoreInfo={() => openSettings('about')} />
      case 'commands':
        return (
          <Commands
            onRun={text => {
              setTerminalInput({ text, nonce: Date.now() })
              openWindow('terminal')
            }}
          />
        )
      case 'remux':
        return <Remux request={remuxRequest} onPlay={openMedia} />
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
          <Globe size={12} /> {app.port ? `${location.hostname}:${app.port}` : tr('No web interface')}
        </span>
      ),
      actions: (
        <>
          <button className="icon-btn" onClick={() => reloadWindow(w.id)} aria-label={tr('Reload')}>
            <RotateCw size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => openInTab(app)}
            disabled={app.status !== 'running'}
            aria-label={tr('Open in new tab')}
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
        <div className="desktop-icons" hidden={!settings.showDesktopDrive}>
          <button
            className={`desk-icon ${driveSelected ? 'is-selected' : ''}`}
            onClick={() => setDriveSelected(true)}
            onDoubleClick={() => openWindow('files')}
            onContextMenu={showDriveMenu}
            title={tr('Double-click to open')}
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
            snap={w.snap ?? null}
            fullscreen={!!w.fullscreen}
            onSnap={zone => snapWindow(w.id, zone)}
            onToggleFullscreen={() => toggleFullscreen(w.id)}
            closing={w.closing}
            active={w.id === front?.id}
            variant={appIdOf(w.id) || infoPathOf(w.id) || remoteIdOf(w.id) ? 'compact' : (WINDOW_VARIANT[w.id as SystemWindowId] ?? 'default')}
            {...appChrome(w)}
            onFocus={() => focusWindow(w.id)}
            onClose={() => closeWindow(w.id)}
            onClosed={() => removeWindow(w.id)}
            onMinimize={() => minimizeWindow(w.id)}
            onToggleZoom={() => toggleZoom(w.id)}
          >
            <WindowErrorBoundary key={w.nonce}>{renderWindow(w)}</WindowErrorBoundary>
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
        pinnedApps={dockIds}
        systemIds={dockSystemIds}
        // A remote screen counts as Devices being open.
        openIds={liveWindows.map(w => (remoteIdOf(w.id) ? 'devices' : w.id))}
        onDropApp={pinDropped}
        onReorder={(group, ids) => update(group === 'apps' ? { dockApps: ids } : { dockSystem: ids })}
        onRemove={(group, id) => (group === 'apps' ? togglePin(id) : toggleSystemPin(id))}
        onLauncher={() => setLauncher(open => !open)}
        onOpenWindow={openWindow}
        onOpenApp={openAppWindow}
        onAppMenu={showAppMenu}
        onSystemMenu={showSystemMenu}
        onTrash={() => openFilesAt(TRASH_PLACE)}
        onTrashMenu={anchor =>
          show(anchor, [
            { label: tr('Open'), icon: FolderOpen, onSelect: () => openFilesAt(TRASH_PLACE) },
            { label: tr('Empty Trash'), confirm: tr('Click Again to Empty'), icon: Trash2, danger: true, onSelect: () => void api.emptyTrash() },
          ])
        }
        badges={{ store: appUpdates.count, settings: systemBadges.release ? 1 : 0, updates: systemBadges.packages }}
      />

      <MenuBar
        getContent={menuBarContent}
        cpu={stats?.cpu.usage}
        power={stats?.power}
        addresses={stats?.addresses}
        stats={stats}
        history={history}
        onOpenWindow={openWindow}
        onOpenSettings={openSettings}
        onQuickSearch={() => setQuickSearch(true)}
        onConnectDevice={openRemote}
        onPower={action => void api.power(action).then(() => setPowering(action))}
      />

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
          <button className="icon-btn" onClick={() => setToast(null)} aria-label={tr('Dismiss')}>
            <X size={14} />
          </button>
        </Glass>
      )}
    </div>
    </MenuRegistryContext.Provider>
  )
}
