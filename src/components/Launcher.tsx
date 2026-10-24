import { useEffect, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { Eye, EyeOff, FolderInput, FolderMinus, FolderOpen, FolderPlus, Pencil, Search, Ungroup } from 'lucide-react'
import type { InstalledApp } from '../api/types'
import { useContextMenu } from '../lib/contextMenu'
import { layoutFolders, moveTo, newFolder, renameFolder, ungroup, type FolderView } from '../lib/launchpadFolders'
import { useSettings } from '../lib/settings'
import { SYSTEM_APPS, UTILITY_IDS } from '../lib/systemApps'
import { AppIcon } from './AppIcon'
import type { MenuAnchor, MenuItem } from './ContextMenu'
import type { SystemWindowId, WindowId } from './Window'

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
  onOpenWindow: (id: WindowId) => void
  /** `extra` items (folders, hiding) are appended to the app's usual menu. */
  onAppMenu: (app: InstalledApp, anchor: MenuAnchor, extra?: MenuItem[]) => void
  onSystemMenu: (id: SystemWindowId, anchor: MenuAnchor, extra?: MenuItem[]) => void
}

const DRAG_TYPE = 'application/x-temanlabs-launchpad'
// How many app icons a folder tile previews.
const PREVIEW = 9

/** A sensible name for a folder made by dropping one app onto another. */
function suggestName(a?: Entry, b?: Entry) {
  if (!a?.app || !b?.app) return 'System'
  if (a.app.source === b.app.source && a.app.source === 'native') return 'Native Apps'
  if (a.app.source === b.app.source && a.app.source === 'casaos') return 'CasaOS'
  if (a.app.category === b.app.category && a.app.category) return a.app.category
  return 'Folder'
}

export function Launcher({ closing = false, apps, onClose, onOpenApp, onOpenWindow, onAppMenu, onSystemMenu }: Props) {
  const { settings, update } = useSettings()
  const { show } = useContextMenu()
  const [query, setQuery] = useState('')
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (openFolderId) setOpenFolderId(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, openFolderId])

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
  const openFolder = folders.find(f => f.id === openFolderId) ?? null

  const q = query.trim().toLowerCase()
  const iconSize = window.innerWidth < 720 ? 62 : 84

  // ----- Folder edits -----
  const move = (key: string, folderId: string | null) => update(s => moveTo(s, key, folderId, !!autoOf(key)))
  const group = (target: string, dragged: string) =>
    update(s => newFolder(s, [target, dragged], suggestName(byKey.get(target), byKey.get(dragged))))
  const setHidden = (key: string, hide: boolean) =>
    update(s => ({ hiddenApps: hide ? [...s.hiddenApps.filter(k => k !== key), key] : s.hiddenApps.filter(k => k !== key) }))

  const entryExtras = (entry: Entry): MenuItem[] => {
    const current = folderOf(entry.key)
    if (hidden.has(entry.key)) return [{ label: 'Show in Launcher', icon: Eye, onSelect: () => setHidden(entry.key, false) }]
    return [
      ...folders
        .filter(f => f !== current)
        .map(f => ({ label: `Move to “${f.name}”`, icon: FolderInput, onSelect: () => move(entry.key, f.id) })),
      { label: 'New Folder with This App', icon: FolderPlus, onSelect: () => update(s => newFolder(s, [entry.key], 'New Folder')) },
      ...(current ? [{ label: 'Remove from Folder', icon: FolderMinus, onSelect: () => move(entry.key, null) }] : []),
      { label: 'Hide from Launcher', icon: EyeOff, onSelect: () => setHidden(entry.key, true) },
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
      { label: 'Open', icon: FolderOpen, onSelect: () => setOpenFolderId(folder.id) },
      {
        label: 'Rename…',
        icon: Pencil,
        onSelect: () => {
          setOpenFolderId(folder.id)
          setRenaming(true)
        },
      },
      'separator',
      { label: 'Ungroup Folder', icon: Ungroup, onSelect: () => update(s => ungroup(s, folder, autoOf)) },
    ])
  }

  // ----- Drag and drop: onto an app makes a folder, onto a folder adds to it, onto the background takes it out -----
  const dragProps = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, key)
      e.dataTransfer.effectAllowed = 'move'
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
      setOpenFolderId(null)
    },
  }

  const appTile = (entry: Entry, inFolder: FolderView | null) => (
    <button
      key={entry.key}
      className={`lp-item ${entry.app && entry.app.status !== 'running' ? 'is-stopped' : ''} ${
        dragKey === entry.key ? 'is-dragging' : ''
      } ${dropKey === entry.key ? 'is-drop-target' : ''} ${hidden.has(entry.key) ? 'is-hidden' : ''}`}
      onClick={entry.open}
      onContextMenu={e => entryMenu(e, entry)}
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
      {entry.app && entry.app.status !== 'running' && (
        <span className="lp-status">{entry.app.status === 'installing' ? 'Installing…' : 'Stopped'}</span>
      )}
    </button>
  )

  const folderTile = (folder: FolderView) => (
    <button
      key={`folder:${folder.id}`}
      className={`lp-item lp-folder ${dropKey === `folder:${folder.id}` ? 'is-drop-target' : ''}`}
      onClick={() => setOpenFolderId(folder.id)}
      onContextMenu={e => folderMenu(e, folder)}
      {...dropProps(`folder:${folder.id}`, dragged => move(dragged, folder.id))}
    >
      <span className="lp-folder-icon" style={{ width: iconSize, height: iconSize, '--tile': `${iconSize}px` } as CSSProperties}>
        {folder.items.slice(0, PREVIEW).map(key => {
          const e = byKey.get(key)
          return e ? <AppIcon key={key} icon={e.icon} iconUrl={e.iconUrl} color={e.color} size={Math.round(iconSize * 0.2)} /> : null
        })}
      </span>
      <span className="lp-name">{folder.name}</span>
      <span className="lp-status">{folder.items.length} apps</span>
    </button>
  )

  const closeOnBackground = (e: MouseEvent<HTMLElement>) => e.target === e.currentTarget && onClose()
  const searchResults = q ? entries.filter(e => (showHidden || !hidden.has(e.key)) && e.name.toLowerCase().includes(q)) : []
  // System apps first, then folders, then everything else, as before folders existed.
  const looseEntries = loose.map(k => byKey.get(k)!).filter(Boolean)
  const hiddenEntries = showHidden ? entries.filter(e => hidden.has(e.key)) : []

  return (
    <div
      className={`launchpad ${closing ? 'is-closing' : ''} ${openFolder ? 'has-folder' : ''}`}
      onClick={closeOnBackground}
      {...backgroundDrop}
    >
      <label className="lp-search">
        <Search size={14} />
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" />
      </label>
      <div className="lp-grid" onClick={closeOnBackground}>
        {q ? (
          searchResults.map(e => appTile(e, null))
        ) : (
          <>
            {looseEntries.filter(e => e.systemId).map(e => appTile(e, null))}
            {folders.map(folderTile)}
            {looseEntries.filter(e => !e.systemId).map(e => appTile(e, null))}
            {hiddenEntries.map(e => appTile(e, null))}
          </>
        )}
      </div>
      {q && searchResults.length === 0 && <p className="lp-empty">No apps match “{query}”.</p>}
      {hidden.size > 0 && !q && (
        <button className="lp-hidden-toggle" onClick={() => setShowHidden(v => !v)}>
          {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
          {showHidden ? 'Hide hidden apps' : `Show ${hidden.size} hidden app${hidden.size > 1 ? 's' : ''}`}
        </button>
      )}

      {openFolder && (
        <div
          className="lp-folder-backdrop"
          onClick={e => {
            e.stopPropagation()
            if (e.target === e.currentTarget) {
              setOpenFolderId(null)
              setRenaming(false)
            }
          }}
          {...backgroundDrop}
        >
          <div
            className="lp-folder-panel"
            key={openFolder.id}
            // Dropping on the panel itself keeps the app in the folder.
            onDragOver={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {renaming ? (
              <input
                className="lp-folder-name"
                autoFocus
                defaultValue={openFolder.name}
                onBlur={e => {
                  const name = e.target.value.trim()
                  if (name) update(s => renameFolder(s, openFolder.id, name))
                  setRenaming(false)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setRenaming(false)
                  }
                }}
              />
            ) : (
              <button className="lp-folder-title" onClick={() => setRenaming(true)} title="Click to rename">
                {openFolder.name}
              </button>
            )}
            <div className="lp-folder-grid">
              {openFolder.items.map(key => {
                const e = byKey.get(key)
                return e ? appTile(e, openFolder) : null
              })}
            </div>
            <p className="lp-folder-hint">Drag an app out of the folder to take it out.</p>
          </div>
        </div>
      )}
    </div>
  )
}
