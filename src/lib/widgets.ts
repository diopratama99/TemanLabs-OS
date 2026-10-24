import { Boxes, Clock, Cpu, HardDrive, MemoryStick, Network, type LucideIcon } from 'lucide-react'

export type WidgetType = 'clock' | 'cpu' | 'memory' | 'apps' | 'storage' | 'network'
export type WidgetSize = 'small' | 'medium'

export interface WidgetOptions {
  clock: { style: 'analog' | 'digital'; seconds: boolean; hour24: boolean; /** '' = the browser's zone */ timeZone: string }
  cpu: { temperature: boolean; graph: boolean }
  memory: { display: 'ring' | 'bar'; details: boolean }
  apps: { show: 'running' | 'all'; icons: boolean }
  storage: { show: 'used' | 'free'; /** Mount points left out of the widget. */ hidden: string[] }
  network: { units: 'bytes' | 'bits'; graph: boolean }
}

/** One widget on the desktop. A union over types, so `options` is typed by `type`. */
export type WidgetConfig = {
  [T in WidgetType]: { id: string; type: T; size: WidgetSize; options: WidgetOptions[T] }
}[WidgetType]

interface WidgetInfo<T extends WidgetType> {
  name: string
  description: string
  icon: LucideIcon
  defaultSize: WidgetSize
  defaults: WidgetOptions[T]
}

export const WIDGET_INFO: { [T in WidgetType]: WidgetInfo<T> } = {
  clock: {
    name: 'Clock',
    description: 'Analog or digital time, in any time zone.',
    icon: Clock,
    defaultSize: 'small',
    defaults: { style: 'analog', seconds: true, hour24: true, timeZone: '' },
  },
  cpu: {
    name: 'CPU',
    description: 'Processor usage, temperature and recent load.',
    icon: Cpu,
    defaultSize: 'small',
    defaults: { temperature: true, graph: true },
  },
  memory: {
    name: 'Memory',
    description: 'How much RAM is in use.',
    icon: MemoryStick,
    defaultSize: 'small',
    defaults: { display: 'ring', details: true },
  },
  apps: {
    name: 'Apps',
    description: 'Installed apps and which ones are running.',
    icon: Boxes,
    defaultSize: 'small',
    defaults: { show: 'running', icons: true },
  },
  storage: {
    name: 'Storage',
    description: 'Used and free space on each disk.',
    icon: HardDrive,
    defaultSize: 'medium',
    defaults: { show: 'used', hidden: [] },
  },
  network: {
    name: 'Network',
    description: 'Live download and upload speed.',
    icon: Network,
    defaultSize: 'medium',
    defaults: { units: 'bytes', graph: true },
  },
}

export const WIDGET_TYPES = Object.keys(WIDGET_INFO) as WidgetType[]

export const TIME_ZONES: { id: string; label: string }[] = [
  { id: '', label: 'Local time' },
  { id: 'Asia/Jakarta', label: 'Jakarta (WIB)' },
  { id: 'Asia/Makassar', label: 'Makassar (WITA)' },
  { id: 'Asia/Jayapura', label: 'Jayapura (WIT)' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Amsterdam', label: 'Amsterdam' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'UTC', label: 'UTC' },
]

let created = 0

export function createWidget(type: WidgetType, size?: WidgetSize): WidgetConfig {
  const info = WIDGET_INFO[type]
  return {
    id: `${type}-${Date.now().toString(36)}-${created++}`,
    type,
    size: size ?? info.defaultSize,
    options: structuredClone(info.defaults),
  } as WidgetConfig
}

const DEFAULT_LAYOUT: WidgetType[] = ['clock', 'cpu', 'storage', 'memory', 'apps', 'network']

export const defaultWidgets = () => DEFAULT_LAYOUT.map(type => createWidget(type))

/** Drops unknown types and fills in options added since the layout was saved. */
export function normalizeWidgets(value: unknown): WidgetConfig[] {
  if (!Array.isArray(value)) return defaultWidgets()
  return value
    .filter((w): w is WidgetConfig => !!w && typeof w === 'object' && (w as WidgetConfig).type in WIDGET_INFO)
    .map(w => ({
      ...w,
      size: w.size === 'medium' ? 'medium' : 'small',
      options: { ...WIDGET_INFO[w.type].defaults, ...w.options },
    }) as WidgetConfig)
}
