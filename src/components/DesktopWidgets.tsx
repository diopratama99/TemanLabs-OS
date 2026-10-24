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
import { WIDGET_INFO, type WidgetConfig } from '../lib/widgets'
import type { MenuItem } from './ContextMenu'
import { Glass } from './Glass'
import { WidgetEditor } from './widgets/WidgetEditor'
import { WidgetGallery } from './widgets/WidgetGallery'
import { WidgetContent } from './widgets/WidgetViews'

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
          { label: 'Analog', icon: Clock, checked: w.options.style === 'analog', onSelect: set({ style: 'analog' }) },
          { label: 'Digital', checked: w.options.style === 'digital', onSelect: set({ style: 'digital' }) },
          { label: 'Show Seconds', checked: w.options.seconds, onSelect: set({ seconds: !w.options.seconds }) },
        ]
      case 'cpu':
        return [
          { label: 'Show Temperature', checked: w.options.temperature, onSelect: set({ temperature: !w.options.temperature }) },
          { label: 'Show Usage Graph', checked: w.options.graph, onSelect: set({ graph: !w.options.graph }) },
        ]
      case 'memory':
        return [
          { label: 'Ring', checked: w.options.display === 'ring', onSelect: set({ display: 'ring' }) },
          { label: 'Bar', checked: w.options.display === 'bar', onSelect: set({ display: 'bar' }) },
          { label: 'Show Details', checked: w.options.details, onSelect: set({ details: !w.options.details }) },
        ]
      case 'apps':
        return [
          { label: 'Running Apps', checked: w.options.show === 'running', onSelect: set({ show: 'running' }) },
          { label: 'All Apps', checked: w.options.show === 'all', onSelect: set({ show: 'all' }) },
          { label: 'Show Icons', checked: w.options.icons, onSelect: set({ icons: !w.options.icons }) },
          'separator',
          { label: 'Open Launcher', icon: LayoutGrid, onSelect: onLauncher },
          { label: 'Manage Apps…', icon: ShoppingBag, onSelect: onManageApps },
        ]
      case 'storage': {
        const hidden = w.options.hidden
        return [
          { label: 'Show Used Space', checked: w.options.show === 'used', onSelect: set({ show: 'used' }) },
          { label: 'Show Free Space', checked: w.options.show === 'free', onSelect: set({ show: 'free' }) },
          'separator',
          ...stats.disks.map(disk => ({
            label: `${disk.name} (${disk.mount})`,
            checked: !hidden.includes(disk.mount),
            onSelect: set({
              hidden: hidden.includes(disk.mount) ? hidden.filter(m => m !== disk.mount) : [...hidden, disk.mount],
            }),
          })),
          'separator',
          { label: 'Open DATA in Files', icon: FolderOpen, onSelect: onOpenFiles },
        ]
      }
      case 'network':
        return [
          { label: 'Megabytes (MB/s)', checked: w.options.units === 'bytes', onSelect: set({ units: 'bytes' }) },
          { label: 'Megabits (Mbps)', checked: w.options.units === 'bits', onSelect: set({ units: 'bits' }) },
          { label: 'Show Traffic Graph', checked: w.options.graph, onSelect: set({ graph: !w.options.graph }) },
        ]
    }
  }

  const openMenu = (e: MouseEvent<HTMLElement>, w: WidgetConfig) => {
    const box = e.currentTarget.getBoundingClientRect()
    const info = WIDGET_INFO[w.type]
    show(e, [
      { label: `Edit "${info.name}"…`, icon: SlidersHorizontal, onSelect: () => setEditor({ id: w.id, anchor: box }) },
      'separator',
      { label: 'Small', icon: Square, checked: w.size === 'small', onSelect: () => setSize(w.id, 'small') },
      { label: 'Medium', icon: RectangleHorizontal, checked: w.size === 'medium', onSelect: () => setSize(w.id, 'medium') },
      'separator',
      ...optionItems(w),
      'separator',
      { label: 'Remove Widget', icon: Trash2, danger: true, onSelect: () => remove(w.id) },
      { label: editing ? 'Done Editing Widgets' : 'Edit Widgets…', icon: LayoutDashboard, onSelect: () => onEditingChange(!editing) },
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
            >
              <WidgetContent config={w} data={data} />
            </Glass>
            {editing && (
              <button className="widget-remove" onClick={() => remove(w.id)} aria-label={`Remove ${WIDGET_INFO[w.type].name} widget`}>
                <Minus size={12} strokeWidth={3.5} />
              </button>
            )}
          </div>
        ))}
        {editing && widgets.length === 0 && <div className="widget-placeholder">Add widgets from the gallery below.</div>}
      </div>

      {editing && <WidgetGallery onDone={() => onEditingChange(false)} />}
      {editor && editorConfig && (
        <WidgetEditor config={editorConfig} anchor={editor.anchor} disks={stats.disks} onClose={() => setEditor(null)} />
      )}
    </>
  )
}
