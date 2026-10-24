import { useEffect, useState, type MouseEvent } from 'react'
import {
  Clock,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  Minus,
  RectangleHorizontal,
  ShoppingBag,
  SlidersHorizontal,
  Square,
  Trash2,
} from 'lucide-react'
import type { InstalledApp, SystemStats } from '../api/types'
import type { StatsHistory } from '../hooks/useSystemStats'
import { useWidgets } from '../hooks/useWidgets'
import { useContextMenu } from '../lib/contextMenu'
import { NOTE_COLORS, WIDGET_INFO, type WidgetConfig } from '../lib/widgets'
import type { MenuItem } from './ContextMenu'
import { Glass } from './Glass'
import { WidgetEditor } from './widgets/WidgetEditor'
import { WidgetGallery } from './widgets/WidgetGallery'
import { WidgetContent } from './widgets/WidgetViews'
import { tr } from '../lib/i18n'

// Read back on drop instead of from state, and ignores files or text dragged in from elsewhere.
const DRAG_TYPE = 'application/x-temanlabs-widget'

interface Props {
  stats: SystemStats
  history: StatsHistory
  apps: InstalledApp[]
  /** Layout editing mode (jiggle, remove, drag to reorder, gallery). */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onOpenFiles: () => void
  onLauncher: () => void
  onManageApps: () => void
}

export function DesktopWidgets({
  stats,
  history,
  apps,
  editing,
  onEditingChange,
  onOpenFiles,
  onLauncher,
  onManageApps,
}: Props) {
  const { widgets, setSize, setOptions, remove, move } = useWidgets()
  const { show } = useContextMenu()
  const [editor, setEditor] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const editorConfig = editor && widgets.find(w => w.id === editor.id)

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onEditingChange(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onEditingChange])

  /** Quick per-type settings, so common changes don't need the editor. */
  const optionItems = (w: WidgetConfig): MenuItem[] => {
    const set = (patch: Record<string, unknown>) => () => setOptions(w.id, patch)
    switch (w.type) {
      case 'clock':
        return [
          { label: tr('Analog'), icon: Clock, checked: w.options.style === 'analog', onSelect: set({ style: 'analog' }) },
          { label: tr('Digital'), checked: w.options.style === 'digital', onSelect: set({ style: 'digital' }) },
          { label: tr('Show Seconds'), checked: w.options.seconds, onSelect: set({ seconds: !w.options.seconds }) },
        ]
      case 'cpu':
        return [
          { label: tr('Show Temperature'), checked: w.options.temperature, onSelect: set({ temperature: !w.options.temperature }) },
          { label: tr('Show Usage Graph'), checked: w.options.graph, onSelect: set({ graph: !w.options.graph }) },
        ]
      case 'memory':
        return [
          { label: tr('Ring'), checked: w.options.display === 'ring', onSelect: set({ display: 'ring' }) },
          { label: tr('Bar'), checked: w.options.display === 'bar', onSelect: set({ display: 'bar' }) },
          { label: tr('Show Details'), checked: w.options.details, onSelect: set({ details: !w.options.details }) },
        ]
      case 'apps':
        return [
          { label: tr('Running Apps'), checked: w.options.show === 'running', onSelect: set({ show: 'running' }) },
          { label: tr('All Apps'), checked: w.options.show === 'all', onSelect: set({ show: 'all' }) },
          { label: tr('Show Icons'), checked: w.options.icons, onSelect: set({ icons: !w.options.icons }) },
          'separator',
          { label: tr('Open Launcher'), icon: LayoutGrid, onSelect: onLauncher },
          { label: tr('Manage Apps…'), icon: ShoppingBag, onSelect: onManageApps },
        ]
      case 'storage': {
        const hidden = w.options.hidden
        return [
          { label: tr('Show Used Space'), checked: w.options.show === 'used', onSelect: set({ show: 'used' }) },
          { label: tr('Show Free Space'), checked: w.options.show === 'free', onSelect: set({ show: 'free' }) },
          'separator',
          ...stats.disks.filter(disk => !disk.cloud).map(disk => ({
            label: `${disk.name} (${disk.mount})`,
            checked: !hidden.includes(disk.mount),
            onSelect: set({
              hidden: hidden.includes(disk.mount) ? hidden.filter(m => m !== disk.mount) : [...hidden, disk.mount],
            }),
          })),
          'separator',
          { label: tr('Open DATA in Files'), icon: FolderOpen, onSelect: onOpenFiles },
        ]
      }
      case 'network':
        return [
          { label: tr('Megabytes (MB/s)'), checked: w.options.units === 'bytes', onSelect: set({ units: 'bytes' }) },
          { label: tr('Megabits (Mbps)'), checked: w.options.units === 'bits', onSelect: set({ units: 'bits' }) },
          { label: tr('Show Traffic Graph'), checked: w.options.graph, onSelect: set({ graph: !w.options.graph }) },
        ]
      case 'note':
        return NOTE_COLORS.map(c => ({ label: c.label, checked: w.options.color === c.id, onSelect: set({ color: c.id }) }))
      case 'todo':
        return [
          { label: tr('Hide Finished Items'), checked: w.options.hideDone, onSelect: set({ hideDone: !w.options.hideDone }) },
          {
            label: tr('Clear Finished Items'),
            disabled: !w.options.items.some(i => i.done),
            onSelect: set({ items: w.options.items.filter(i => !i.done) }),
          },
        ]
      case 'calendar':
        return [
          { label: tr('Week Starts on Monday'), checked: w.options.weekStart === 'monday', onSelect: set({ weekStart: 'monday' }) },
          { label: tr('Week Starts on Sunday'), checked: w.options.weekStart === 'sunday', onSelect: set({ weekStart: 'sunday' }) },
        ]
      case 'power':
        return [
          { label: tr('Show Graph'), checked: w.options.graph, onSelect: set({ graph: !w.options.graph }) },
          { label: tr('Show Breakdown'), checked: w.options.parts, onSelect: set({ parts: !w.options.parts }) },
        ]
      case 'server':
        return [{ label: tr('Show Load'), checked: w.options.load, onSelect: set({ load: !w.options.load }) }]
    }
  }

  const openMenu = (e: MouseEvent<HTMLElement>, w: WidgetConfig) => {
    const box = e.currentTarget.getBoundingClientRect()
    const info = WIDGET_INFO[w.type]
    show(e, [
      { label: tr('Edit "{0}"…', info.name), icon: SlidersHorizontal, onSelect: () => setEditor({ id: w.id, anchor: box }) },
      'separator',
      { label: tr('Small'), icon: Square, checked: w.size === 'small', onSelect: () => setSize(w.id, 'small') },
      { label: tr('Medium'), icon: RectangleHorizontal, checked: w.size === 'medium', onSelect: () => setSize(w.id, 'medium') },
      'separator',
      ...optionItems(w),
      'separator',
      { label: tr('Remove Widget'), icon: Trash2, danger: true, onSelect: () => remove(w.id) },
      { label: editing ? tr('Done Editing Widgets') : tr('Edit Widgets…'), icon: LayoutDashboard, onSelect: () => onEditingChange(!editing) },
    ])
  }

  const data = { stats, history, apps }

  return (
    <>
      <div className={`widgets ${editing ? 'is-editing' : ''}`}>
        {widgets.map(w => (
          <div
            key={w.id}
            className={`widget-slot widget-slot-${w.size} ${dragId === w.id ? 'is-dragging' : ''}`}
            draggable={editing}
            onDragStart={e => {
              setDragId(w.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(DRAG_TYPE, w.id)
            }}
            onDragOver={e => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
            onDrop={e => {
              const id = e.dataTransfer.getData(DRAG_TYPE)
              if (!id) return
              e.preventDefault()
              move(id, w.id)
              setDragId(null)
            }}
            onDragEnd={() => setDragId(null)}
            onContextMenu={e => openMenu(e, w)}
          >
            <Glass
              radius={26}
              bezel={24}
              depth={28}
              blur={12}
              className={`widget widget-${w.size} widget-${w.type}`}
              data-widget={w.type}
              data-color={w.type === 'note' ? w.options.color : undefined}
            >
              {/* While rearranging, widgets are pictures to drag, not things to type in. */}
              <WidgetContent config={w} data={data} onOptions={editing ? undefined : patch => setOptions(w.id, patch)} />
            </Glass>
            {editing && (
              <button className="widget-remove" onClick={() => remove(w.id)} aria-label={tr('Remove {0} widget', WIDGET_INFO[w.type].name)}>
                <Minus size={12} strokeWidth={3.5} />
              </button>
            )}
          </div>
        ))}
        {editing && widgets.length === 0 && <div className="widget-placeholder">{tr('Add widgets from the gallery below.')}</div>}
      </div>

      {editing && <WidgetGallery onDone={() => onEditingChange(false)} />}
      {editor && editorConfig && (
        <WidgetEditor config={editorConfig} anchor={editor.anchor} disks={stats.disks} onClose={() => setEditor(null)} />
      )}
    </>
  )
}
