import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { defaultWidgets, normalizeWidgets, type WidgetConfig } from './widgets'
import { browserLanguage, tr, type Language } from './i18n'

export type Theme = 'light' | 'dark'

/** The colour of buttons, selections and switches. */
export type AccentColor = 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'graphite'
export const ACCENT_COLORS: { id: AccentColor; label: string; swatch: string }[] = [
  { id: 'blue', label: tr('Blue'), swatch: '#007aff' },
  { id: 'purple', label: tr('Purple'), swatch: '#a550a7' },
  { id: 'pink', label: tr('Pink'), swatch: '#f74f9e' },
  { id: 'red', label: tr('Red'), swatch: '#ff3b30' },
  { id: 'orange', label: tr('Orange'), swatch: '#ff9500' },
  { id: 'yellow', label: tr('Yellow'), swatch: '#ffcc00' },
  { id: 'green', label: tr('Green'), swatch: '#34c759' },
  { id: 'graphite', label: tr('Graphite'), swatch: '#8e8e93' },
]

/** How far Dock icons grow under the pointer. */
export type DockMagnification = 'off' | 'small' | 'medium' | 'large'
export const DOCK_SCALE: Record<DockMagnification, number> = { off: 1, small: 1.3, medium: 1.55, large: 1.85 }

/** What the menu bar shows on the right. */
export interface MenuBarPrefs {
  lanIp: boolean
  tailscaleIp: boolean
  cpu: boolean
  power: boolean
  network: boolean
  /** My Devices: wake or connect to the other computers. */
  devices: boolean
  date: boolean
  seconds: boolean
  hour12: boolean
}

/** A Launcher folder. Items are Launcher keys: a system app ID or `app:<id>`. */
export interface LauncherFolder {
  id: string
  name: string
  items: string[]
  /** Also collects every app of this kind the user hasn't placed elsewhere. */
  auto?: 'native' | 'utilities'
}

export const NATIVE_FOLDER: LauncherFolder = { id: 'native', name: 'Native Apps', items: [], auto: 'native' }
export const UTILITIES_FOLDER: LauncherFolder = { id: 'utilities', name: 'Utilities', items: [], auto: 'utilities' }

export interface Settings {
  theme: Theme
  /** Interface language; read at startup by lib/i18n.ts. */
  language: Language
  reduceTransparency: boolean
  refraction: boolean
  accent: AccentColor
  /** Animations cut to a minimum (windows, the Dock, panels). */
  reduceMotion: boolean
  dockMagnification: DockMagnification
  /** The Dock slides away and comes back when the pointer reaches the bottom edge. */
  dockAutohide: boolean
  /** The data drive's icon on the desktop. */
  showDesktopDrive: boolean
  menuBar: MenuBarPrefs
  /** Minutes without using the desktop before it locks; 0 never locks. */
  lockAfter: number
  wallpaper: number
  /** URL of the user's own photo (see /api/wallpapers); shown instead of the built-in wallpaper. */
  customWallpaper: string | null
  /** A tiny copy of that photo, shown blurred while the real one loads (after a hard refresh, on the lock screen). */
  customWallpaperPreview: { url: string; data: string } | null
  showWidgets: boolean
  /** Desktop widgets in display order. */
  widgets: WidgetConfig[]
  /** App IDs kept in the Dock, in order; null until the user pins or unpins anything. */
  dockApps: string[] | null
  /** Built-in apps kept in the Dock, in order; null keeps the default set (utilities stay out). */
  dockSystem: string[] | null
  launchpadFolders: LauncherFolder[]
  /** Native apps the user took out of the Native Apps folder (so it doesn't pull them back). */
  launchpadLoose: string[]
  /** Launcher keys hidden from the Launcher. */
  hiddenApps: string[]
  /** Launcher keys of the apps opened last, newest first ("Recently Used"). */
  recentApps: string[]
  /** Apps the user chose to show through the server's proxy (they didn't load directly). */
  proxiedApps: string[]
  /** Files: view (Icons / List / Gallery), icon size and sort order. */
  filesView: FilesView
  filesIconSize: number
  filesSort: { key: FilesSortKey; desc: boolean }
}

export type FilesView = 'icons' | 'list' | 'gallery'
export type FilesSortKey = 'name' | 'kind' | 'modified' | 'size'

type UADataNavigator = Navigator & { userAgentData?: { brands: { brand: string }[] } }

// SVG filters inside backdrop-filter (the refraction effect) only render in Chromium browsers.
export const supportsRefraction = !!(navigator as UADataNavigator).userAgentData?.brands.some(
  b => b.brand === 'Chromium',
)

const STORAGE_KEY = 'temanlabs.settings'

export const DEFAULT_MENU_BAR: MenuBarPrefs = { lanIp: true, tailscaleIp: true, cpu: true, power: true, network: true, devices: true, date: true, seconds: false, hour12: false }

function loadSettings(): Settings {
  const defaults: Settings = {
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    language: browserLanguage(),
    reduceTransparency: false,
    refraction: supportsRefraction,
    accent: 'blue',
    reduceMotion: false,
    dockMagnification: 'medium',
    dockAutohide: false,
    showDesktopDrive: true,
    menuBar: { ...DEFAULT_MENU_BAR },
    lockAfter: 0,
    wallpaper: 0,
    customWallpaper: null,
    customWallpaperPreview: null,
    showWidgets: true,
    widgets: defaultWidgets(),
    dockApps: null,
    dockSystem: null,
    launchpadFolders: [UTILITIES_FOLDER, NATIVE_FOLDER],
    launchpadLoose: [],
    hiddenApps: [],
    recentApps: [],
    proxiedApps: [],
    filesView: 'icons',
    filesIconSize: 64,
    filesSort: { key: 'name', desc: false },
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaults
    const parsed = JSON.parse(saved)
    const list = <T,>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) ? value : fallback)
    return {
      ...defaults,
      ...parsed,
      widgets: 'widgets' in parsed ? normalizeWidgets(parsed.widgets) : defaults.widgets,
      // Items added since the settings were saved keep their defaults.
      menuBar: { ...DEFAULT_MENU_BAR, ...(parsed.menuBar ?? {}) },
      launchpadFolders: withAutoFolders(
        list<LauncherFolder>(parsed.launchpadFolders, defaults.launchpadFolders).filter(
          f => f && typeof f.id === 'string' && Array.isArray(f.items),
        ),
      ),
      launchpadLoose: list<string>(parsed.launchpadLoose, []),
      hiddenApps: list<string>(parsed.hiddenApps, []),
    }
  } catch {
    return defaults
  }
}

/** Saved settings from before a built-in folder existed get it added once. */
function withAutoFolders(folders: LauncherFolder[]) {
  const missing = [UTILITIES_FOLDER, NATIVE_FOLDER].filter(f => !folders.some(x => x.auto === f.auto))
  return [...missing, ...folders]
}

type SettingsPatch = Partial<Settings> | ((current: Settings) => Partial<Settings>)

interface SettingsContextValue {
  settings: Settings
  /** Merge a patch; pass a function when the patch depends on the current settings. */
  update: (patch: SettingsPatch) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.reduceTransparency = settings.reduceTransparency ? 'on' : 'off'
    root.dataset.refraction = settings.refraction && supportsRefraction ? 'on' : 'off'
    root.dataset.accent = settings.accent
    root.dataset.reduceMotion = settings.reduceMotion ? 'on' : 'off'
    root.dataset.dockAutohide = settings.dockAutohide ? 'on' : 'off'
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage can be unavailable (private mode); settings then last for this session only.
    }
  }, [settings])

  const update = (patch: SettingsPatch) =>
    setSettings(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error(tr('useSettings must be used inside SettingsProvider'))
  return ctx
}
