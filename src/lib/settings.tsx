import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { defaultWidgets, normalizeWidgets, type WidgetConfig } from './widgets'

export type Theme = 'light' | 'dark'

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
  reduceTransparency: boolean
  refraction: boolean
  wallpaper: number
  /** URL of the user's own photo (see /api/wallpapers); shown instead of the built-in wallpaper. */
  customWallpaper: string | null
  showWidgets: boolean
  /** Desktop widgets in display order. */
  widgets: WidgetConfig[]
  /** App IDs kept in the Dock, in order; null until the user pins or unpins anything. */
  dockApps: string[] | null
  launchpadFolders: LauncherFolder[]
  /** Native apps the user took out of the Native Apps folder (so it doesn't pull them back). */
  launchpadLoose: string[]
  /** Launcher keys hidden from the Launcher. */
  hiddenApps: string[]
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

function loadSettings(): Settings {
  const defaults: Settings = {
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    reduceTransparency: false,
    refraction: supportsRefraction,
    wallpaper: 0,
    customWallpaper: null,
    showWidgets: true,
    widgets: defaultWidgets(),
    dockApps: null,
    launchpadFolders: [UTILITIES_FOLDER, NATIVE_FOLDER],
    launchpadLoose: [],
    hiddenApps: [],
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
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
