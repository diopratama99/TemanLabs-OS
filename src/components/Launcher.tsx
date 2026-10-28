import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { Eye, EyeOff, FolderInput, FolderMinus, FolderPlus, LayoutGrid, MoreHorizontal, Pencil, Ungroup } from 'lucide-react'
import type { InstalledApp } from '../api/types'
import { useContextMenu } from '../lib/contextMenu'
import { layoutFolders, moveTo, newFolder, renameFolder, ungroup, type FolderView } from '../lib/launchpadFolders'
import { useSettings } from '../lib/settings'
import { currentAppId, MERGED_APPS, SYSTEM_APPS, UTILITY_IDS, type MergedId } from '../lib/systemApps'
import { AppIcon } from './AppIcon'
import type { MenuAnchor, MenuItem } from './ContextMenu'
import { Glass } from './Glass'
import type { SystemWindowId, WindowId } from './Window'
import { tr } from '../lib/i18n'
import { DRAG_GROUP_TYPE, DRAG_TYPE } from '../lib/dockDrag'

interface Entry {
  key: string
  name: string
  icon: string
  iconUrl?: string
  color: [string, string]
  app?: InstalledApp
  systemId?: SystemWindowId
  open: () => void
}

interface Props {
  /** Playing its exit animation. */
  closing?: boolean
  apps: InstalledApp[]
  onClose: () => void
  onOpenApp: (app: InstalledApp) => void
  onOpenWindow: (id: WindowId | MergedId) => void
  /** `extra` items (folders, hiding) are appended to the app's usual menu. */
  onAppMenu: (app: InstalledApp, anchor: MenuAnchor, extra?: MenuItem[]) => void
  onSystemMenu: (id: SystemWindowId, anchor: MenuAnchor, extra?: MenuItem[]) => void
}

// Apps in the "Recently used" row.
const RECENT = 7

/** A sensible name for a folder made by dropping one app onto another. */
function suggestName(a?: Entry, b?: Entry) {
  if (!a?.app || !b?.app) return 'System'
  if (a.app.source === b.app.source && a.app.source === 'native') return 'Native Apps'
  if (a.app.source === b.app.source && a.app.source === 'casaos') return 'CasaOS'
  if (a.app.category === b.app.category && a.app.category) return a.app.category
  return 'Folder'
}

/** One section of the Launcher: the built-in apps, a folder, or a category of installed apps. */
interface Group {
  id: string
  title: string
  keys: string[]
  folder?: FolderView
}

/**
 * The Launcher: a floating panel over the desktop. "All" shows the recently used apps, then every
 * app from A to Z; the tabs along the top show one section (built-in apps, a folder, a category).
 */
export function Launcher({ closing = false, apps, onClose, onOpenApp, onOpenWindow, onAppMenu, onSystemMenu }: Props) {
  const { settings, update } = useSettings()
  const { show } = useContextMenu()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('all')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !renaming && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, renaming])

  const entries: Entry[] = [
    ...SYSTEM_APPS.map(app => ({
      key: app.id,
      name: app.label,
      icon: app.icon,
      color: app.color,
      systemId: app.id,
      open: () => onOpenWindow(app.id),
    })),
    ...apps.map(app => ({
      key: `app:${app.id}`,
      name: app.name,
      icon: app.icon,
      iconUrl: app.iconUrl,
      color: app.color,
      app,
      open: () => onOpenApp(app),
    })),
  ]
  const byKey = new Map(entries.map(e => [e.key, e]))
  const hidden = new Set(settings.hiddenApps)
  const autoOf = (key: string) =>
    byKey.get(key)?.app?.source === 'native' ? ('native' as const) : UTILITY_IDS.has(key) ? ('utilities' as const) : undefined
  const visibleKeys = entries.filter(e => !hidden.has(e.key)).map(e => e.key)
  const { folders, loose } = layoutFolders(settings, visibleKeys, autoOf)
  const folderOf = (key: string) => folders.find(f => f.items.includes(key))

  // ----- Sections -----
  const looseSystem = loose.filter(k => byKey.get(k)?.systemId)
  const byCategory = new Map<string, string[]>()
  for (const k of loose) {
    const app = byKey.get(k)?.app
    if (!app) continue
    const cat = app.category?.trim() || 'Other'
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), k])
  }
  const categories = [...byCategory.keys()].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : tr(a).localeCompare(tr(b))))
  const groups: Group[] = [
    ...(looseSystem.length ? [{ id: 'system', title: tr('System'), keys: looseSystem }] : []),
    ...folders.map(f => ({ id: `folder:${f.id}`, title: tr(f.name), keys: f.items, folder: f })),
    ...categories.map(c => ({ id: `cat:${c}`, title: tr(c), keys: byCategory.get(c)! })),
    ...(showHidden && hidden.size ? [{ id: 'hidden', title: tr('Hidden'), keys: [...hidden].filter(k => byKey.has(k)) }] : []),
  ]
  const activeTab = groups.some(g => g.id === tab) ? tab : 'all'
  const recent = [...new Set((settings.recentApps ?? []).map(currentAppId))].filter(k => byKey.has(k) && !hidden.has(k)).slice(0, RECENT)
  const everything = (showHidden ? entries.map(e => e.key) : visibleKeys).sort((a, b) => byKey.get(a)!.name.localeCompare(byKey.get(b)!.name))

  const q = query.trim().toLowerCase()
  // Searching finds apps since merged into others by their old names too.
  const merged: Entry[] = (Object.keys(MERGED_APPS) as MergedId[]).flatMap(id => {
    const into = SYSTEM_APPS.find(a => a.id === MERGED_APPS[id].into)
    return into ? [{ key: id, name: MERGED_APPS[id].label, icon: into.icon, color: into.color, open: () => onOpenWindow(id) }] : []
  })
  const results = q ? [...entries, ...merged].filter(e => (showHidden || !hidden.has(e.key)) && e.name.toLowerCase().includes(q)) : []
  const iconSize = window.innerWidth < 720 ? 52 : 54

  const launch = (entry: Entry) => {
    entry.open()
    onClose()
  }

  // ----- Folder edits -----
  const move = (key: string, folderId: string | null) => update(s => moveTo(s, key, folderId, !!autoOf(key)))
  const group = (target: string, dragged: string) =>
    update(s => newFolder(s, [target, dragged], suggestName(byKey.get(target), byKey.get(dragged))))
  const setHidden = (key: string, hide: boolean) =>
    update(s => ({ hiddenApps: hide ? [...s.hiddenApps.filter(k => k !== key), key] : s.hiddenApps.filter(k => k !== key) }))

  const entryExtras = (entry: Entry): MenuItem[] => {
    const current = folderOf(entry.key)
    if (hidden.has(entry.key)) return [{ label: tr('Show in Launcher'), icon: Eye, onSelect: () => setHidden(entry.key, false) }]
    return [
      ...folders
        .filter(f => f !== current)
        .map(f => ({ label: tr('Move to “{0}”', tr(f.name)), icon: FolderInput, onSelect: () => move(entry.key, f.id) })),
      { label: tr('New Folder with This App'), icon: FolderPlus, onSelect: () => update(s => newFolder(s, [entry.key], 'New Folder')) },
      ...(current ? [{ label: tr('Remove from Folder'), icon: FolderMinus, onSelect: () => move(entry.key, null) }] : []),
      { label: tr('Hide from Launcher'), icon: EyeOff, onSelect: () => setHidden(entry.key, true) },
    ]
  }

  const entryMenu = (e: MouseEvent, entry: Entry) => {
    e.preventDefault()
    e.stopPropagation()
    const at = { x: e.clientX, y: e.clientY }
    if (entry.app) onAppMenu(entry.app, at, entryExtras(entry))
    else if (entry.systemId) onSystemMenu(entry.systemId, at, entryExtras(entry))
  }

  const folderMenu = (e: MouseEvent, folder: FolderView) => {
    e.preventDefault()
    show(e, [
      { label: tr('Rename…'), icon: Pencil, onSelect: () => setRenaming(folder.id) },
      'separator',
      { label: tr('Ungroup Folder'), icon: Ungroup, onSelect: () => update(s => ungroup(s, folder, autoOf)) },
    ])
  }

  // ----- Drag and drop: onto an app makes a folder, onto a folder's section adds to it, onto
  // empty space takes it out, onto the Dock keeps it there. -----
  const dragProps = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, key)
      e.dataTransfer.setData(DRAG_GROUP_TYPE(key.startsWith('app:') ? 'apps' : 'system'), '1')
      e.dataTransfer.effectAllowed = 'copyMove'
      setDragKey(key)
    },
    onDragEnd: () => {
      setDragKey(null)
      setDropKey(null)
    },
  })
  const dropProps = (key: string, onDrop: (dragged: string) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragKey || dragKey === key) return
      e.preventDefault()
      e.stopPropagation()
      setDropKey(key)
    },
    onDragLeave: () => setDropKey(k => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const dragged = e.dataTransfer.getData(DRAG_TYPE)
      setDropKey(null)
      if (dragged && dragged !== key) onDrop(dragged)
    },
  })
  const backgroundDrop = {
    onDragOver: (e: DragEvent) => dragKey && e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const dragged = e.dataTransfer.getData(DRAG_TYPE)
      if (dragged && folderOf(dragged)) move(dragged, null)
    },
  }

  const tile = (entry: Entry, inFolder?: FolderView) => (
    <button
      key={entry.key}
      className={`lp-item ${entry.app && entry.app.status !== 'running' ? 'is-stopped' : ''} ${dragKey === entry.key ? 'is-dragging' : ''} ${
        dropKey === entry.key ? 'is-drop-target' : ''
      } ${hidden.has(entry.key) ? 'is-hidden' : ''}`}
      onClick={() => launch(entry)}
      onContextMenu={e => entryMenu(e, entry)}
      title={entry.name}
      {...dragProps(entry.key)}
      {...(inFolder
        ? dropProps(entry.key, dragged => move(dragged, inFolder.id))
        : dropProps(entry.key, dragged => {
            const target = folderOf(entry.key)
            if (target) move(dragged, target.id)
            else group(entry.key, dragged)
          }))}
    >
      <AppIcon icon={entry.icon} iconUrl={entry.iconUrl} color={entry.color} size={iconSize} />
      <span className="lp-name">{entry.name}</span>
      {entry.app && entry.app.status !== 'running' && <span className="lp-status">{entry.app.status === 'installing' ? tr('Installing…') : tr('Stopped')}</span>}
    </button>
  )

  const section = (g: Group, titled: boolean) => (
    <section
      key={g.id}
      className={`lp-section ${dropKey === g.id ? 'is-drop-target' : ''}`}
      {...(g.folder ? dropProps(g.id, dragged => move(dragged, g.folder!.id)) : {})}
    >
      {titled &&
        (g.folder && renaming === g.folder.id ? (
          <input
            className="lp-section-rename"
            autoFocus
            defaultValue={g.folder.name}
            onBlur={e => {
              const name = e.target.value.trim()
              if (name) update(s => renameFolder(s, g.folder!.id, name))
              setRenaming(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <h3
            className={`lp-section-title ${g.folder ? 'is-folder' : ''}`}
            onClick={() => g.folder && setRenaming(g.folder.id)}
            onContextMenu={e => g.folder && folderMenu(e, g.folder)}
            title={g.folder ? tr('Click to rename') : undefined}
          >
            {g.title}
          </h3>
        ))}
      <div className="lp-grid">
        {g.keys.map(k => {
          const e = byKey.get(k)
          return e ? tile(e, g.folder) : null
        })}
      </div>
    </section>
  )

  const more = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    show({ x: r.right - 230, y: r.bottom + 6 }, [
      {
        label: showHidden ? tr('Hide hidden apps') : tr('Show {0} hidden app{1}', hidden.size, hidden.size > 1 ? 's' : ''),
        icon: showHidden ? EyeOff : Eye,
        disabled: hidden.size === 0,
        onSelect: () => setShowHidden(v => !v),
      },
    ])
  }

  return (
    <div className={`launchpad ${closing ? 'is-closing' : ''}`} onClick={e => e.target === e.currentTarget && onClose()} {...backgroundDrop}>
      <Glass radius={30} bezel={18} depth={16} blur={26} className="lp-panel tint-panel" role="dialog" aria-label={tr('Launcher')}>
        <header className="lp-head">
          <LayoutGrid size={22} strokeWidth={1.8} />
          <input
            className="lp-query"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && results[0] && launch(results[0])}
            placeholder={tr('Apps')}
            aria-label={tr('Search apps')}
          />
          <button className="icon-btn lp-more" onClick={more} aria-label={tr('More')}>
            <MoreHorizontal size={18} />
          </button>
        </header>

        {!q && (
          <nav className="lp-tabs" aria-label={tr('Sections')}>
            <button className={activeTab === 'all' ? 'is-active' : ''} onClick={() => setTab('all')}>
              {tr('All')}
            </button>
            {groups.map(g => (
              <button key={g.id} className={activeTab === g.id ? 'is-active' : ''} onClick={() => setTab(g.id)} {...(g.folder ? dropProps(`tab:${g.id}`, dragged => move(dragged, g.folder!.id)) : {})}>
                {g.title}
              </button>
            ))}
          </nav>
        )}

        <div className="lp-scroll">
          {q ? (
            results.length ? (
              <div className="lp-grid lp-results">{results.map(e => tile(e))}</div>
            ) : (
              <p className="lp-empty">
                {tr('No apps match “')}
                {query}”.
              </p>
            )
          ) : activeTab === 'all' ? (
            <>
              {recent.length > 0 && (
                <>
                  <div className="lp-grid lp-recent" aria-label={tr('Recently Used')}>
                    {recent.map(k => tile(byKey.get(k)!))}
                  </div>
                  <hr className="lp-divider" />
                </>
              )}
              <div className="lp-grid">{everything.map(k => tile(byKey.get(k)!))}</div>
            </>
          ) : (
            groups.filter(g => g.id === activeTab).map(g => section(g, !!g.folder))
          )}
        </div>
      </Glass>
    </div>
  )
}
