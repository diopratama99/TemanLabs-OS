import { Boxes, CalendarDays, Clock, Cpu, HardDrive, ListChecks, MemoryStick, Network, Server, StickyNote, Zap, type LucideIcon } from 'lucide-react'
import { tr } from './i18n'

export type WidgetType = 'clock' | 'cpu' | 'memory' | 'apps' | 'storage' | 'network' | 'note' | 'todo' | 'calendar' | 'power' | 'server'

export type NoteColor = 'yellow' | 'pink' | 'green' | 'blue' | 'purple' | 'gray'
export const NOTE_COLORS: { id: NoteColor; label: string }[] = [
  { id: 'yellow', label: tr('Yellow') },
  { id: 'pink', label: tr('Pink') },
  { id: 'green', label: tr('Green') },
  { id: 'blue', label: tr('Blue') },
  { id: 'purple', label: tr('Purple') },
  { id: 'gray', label: tr('Gray') },
]

export interface TodoItem {
  id: string
  text: string
  done: boolean
}
export type WidgetSize = 'small' | 'medium'

export interface WidgetOptions {
  clock: { style: 'analog' | 'digital'; seconds: boolean; hour24: boolean; /** '' = the browser's zone */ timeZone: string }
  cpu: { temperature: boolean; graph: boolean }
  memory: { display: 'ring' | 'bar'; details: boolean }
  apps: { show: 'running' | 'all'; icons: boolean }
  storage: { show: 'used' | 'free'; /** Mount points left out of the widget. */ hidden: string[] }
  network: { units: 'bytes' | 'bits'; graph: boolean }
  /** Notes are kept in this browser, with the rest of the desktop layout. */
  note: { text: string; color: NoteColor }
  todo: { title: string; items: TodoItem[]; hideDone: boolean }
  calendar: { weekStart: 'monday' | 'sunday' }
  power: { graph: boolean; parts: boolean }
  server: { load: boolean }
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
    name: tr('Clock'),
    description: tr('Analog or digital time, in any time zone.'),
    icon: Clock,
    defaultSize: 'small',
    defaults: { style: 'analog', seconds: true, hour24: true, timeZone: '' },
  },
  cpu: {
    name: 'CPU',
    description: tr('Processor usage, temperature and recent load.'),
    icon: Cpu,
    defaultSize: 'small',
    defaults: { temperature: true, graph: true },
  },
  memory: {
    name: tr('Memory'),
    description: tr('How much RAM is in use.'),
    icon: MemoryStick,
    defaultSize: 'small',
    defaults: { display: 'ring', details: true },
  },
  apps: {
    name: tr('Apps'),
    description: tr('Installed apps and which ones are running.'),
    icon: Boxes,
    defaultSize: 'small',
    defaults: { show: 'running', icons: true },
  },
  storage: {
    name: tr('Storage'),
    description: tr('Used and free space on each disk.'),
    icon: HardDrive,
    defaultSize: 'medium',
    defaults: { show: 'used', hidden: [] },
  },
  network: {
    name: tr('Network'),
    description: tr('Live download and upload speed.'),
    icon: Network,
    defaultSize: 'medium',
    defaults: { units: 'bytes', graph: true },
  },
  note: {
    name: tr('Sticky Note'),
    description: tr('A note to write on, right on the desktop.'),
    icon: StickyNote,
    defaultSize: 'small',
    defaults: { text: '', color: 'yellow' },
  },
  todo: {
    name: tr('To-do'),
    description: tr('A checklist: add things, tick them off.'),
    icon: ListChecks,
    defaultSize: 'small',
    defaults: { title: tr('To-do'), items: [], hideDone: false },
  },
  calendar: {
    name: tr('Calendar'),
    description: tr('Today’s date, or the whole month.'),
    icon: CalendarDays,
    defaultSize: 'small',
    defaults: { weekStart: 'monday' },
  },
  power: {
    name: tr('Power'),
    description: tr('How many watts the server draws right now.'),
    icon: Zap,
    defaultSize: 'small',
    defaults: { graph: true, parts: true },
  },
  server: {
    name: tr('Server'),
    description: tr('Name, system, uptime and load.'),
    icon: Server,
    defaultSize: 'small',
    defaults: { load: true },
  },
}

export const WIDGET_TYPES = Object.keys(WIDGET_INFO) as WidgetType[]

export const TIME_ZONES: { id: string; label: string }[] = [
  { id: '', label: tr('Local time') },
  { id: 'Asia/Jakarta', label: tr('Jakarta (WIB)') },
  { id: 'Asia/Makassar', label: tr('Makassar (WITA)') },
  { id: 'Asia/Jayapura', label: tr('Jayapura (WIT)') },
  { id: 'Asia/Singapore', label: tr('Singapore') },
  { id: 'Asia/Tokyo', label: tr('Tokyo') },
  { id: 'Australia/Sydney', label: tr('Sydney') },
  { id: 'Europe/London', label: tr('London') },
  { id: 'Europe/Amsterdam', label: tr('Amsterdam') },
  { id: 'America/New_York', label: tr('New York') },
  { id: 'America/Los_Angeles', label: tr('Los Angeles') },
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
