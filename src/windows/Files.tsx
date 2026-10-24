import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  ArrowUpDown,
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  GalleryHorizontal,
  Image,
  LayoutGrid,
  List,
  Pencil,
  Play,
  RotateCw,
  Scissors,
  Share2,
  SquareCheck,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { FileEntry, FileKind } from '../api/types'
import type { MenuItem } from '../components/ContextMenu'
import { RenameField } from '../components/RenameField'
import { UploadsPanel } from '../components/UploadsPanel'
import { usePlaces } from '../hooks/usePlaces'
import { entriesFromDrop, itemsFromEntries, itemsFromInput, useUploads } from '../hooks/useUploads'
import { useAppMenus } from '../lib/appMenus'
import { useAuth } from '../lib/auth'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { setFileClipboard, useFileClipboard } from '../lib/fileClipboard'
import { isTextFile } from '../lib/fileTypes'
import { formatBytes, formatFileDate } from '../lib/format'
import type { MediaKind } from '../lib/media'
import { ancestors, displayName, joinPath, parentOf } from '../lib/paths'
import { DATA_ROOT, type Place } from '../lib/places'
import { MOD } from '../lib/platform'
import { useSettings, type FilesSortKey, type FilesView } from '../lib/settings'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

const KIND_ICON: Record<FileKind, LucideIcon> = {
  folder: Folder,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
  code: FileCode,
}

const KIND_COLOR: Record<FileKind, string> = {
  folder: '#3d9cf5',
  image: '#ff9f0a',
  video: '#bf5af2',
  audio: '#ff375f',
  document: '#8e8e93',
  archive: '#a2845e',
  code: '#30b0c7',
}

const KIND_NOUN: Record<FileKind, string> = {
  folder: 'Folder',
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  archive: 'archive',
  code: 'source file',
}

/** Kind column: "Folder", "JPEG image", "MP4 video"… */
function kindLabel(entry: FileEntry) {
  if (entry.kind === 'folder') return 'Folder'
  const dot = entry.name.lastIndexOf('.')
  const ext = dot > 0 ? entry.name.slice(dot + 1).toUpperCase() : ''
  const noun = KIND_NOUN[entry.kind]
  return ext ? `${ext === 'JPG' ? 'JPEG' : ext} ${noun}` : noun[0].toUpperCase() + noun.slice(1)
}

const VIEWS: { id: FilesView; label: string; icon: LucideIcon }[] = [
  { id: 'icons', label: 'as Icons', icon: LayoutGrid },
  { id: 'list', label: 'as List', icon: List },
  { id: 'gallery', label: 'as Gallery', icon: GalleryHorizontal },
]

const SORTS: { key: FilesSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'modified', label: 'Date Modified' },
  { key: 'size', label: 'Size' },
]

const ICON_SIZES = { min: 40, max: 144 }

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then the chosen order. */
function sortEntries(entries: FileEntry[], key: FilesSortKey, desc: boolean) {
  const value = (e: FileEntry) =>
    key === 'size' ? (e.size ?? 0) : key === 'modified' ? Date.parse(e.modified) || 0 : key === 'kind' ? kindLabel(e) : e.name
  return [...entries].sort((a, b) => {
    const folders = Number(b.kind === 'folder') - Number(a.kind === 'folder')
    if (folders) return folders
    const va = value(a)
    const vb = value(b)
    const order = typeof va === 'string' ? byName(va, vb as string) || byName(a.name, b.name) : va - (vb as number) || byName(a.name, b.name)
    return desc ? -order : order
  })
}

interface Props {
  /** Opens a text file in the code editor. */
  onOpenFile: (path: string) => void
  /** Opens a folder as the code editor's workspace. */
  onOpenFolder: (path: string) => void
  /** Opens a photo in Preview, a video in the player, or a song in Music. */
  onOpenMedia: (path: string, kind: MediaKind) => void
  /** Opens File Sharing with a new share for this folder. */
  onShareFolder: (path: string) => void
}

const isMedia = (entry: FileEntry): entry is FileEntry & { kind: MediaKind } =>
  entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'audio'

const OPEN_LABEL: Partial<Record<FileKind, string>> = {
  folder: 'Open',
  image: 'Open in Preview',
  video: 'Play in Video Player',
  audio: 'Play in Music',
}
const openLabel = (entry: FileEntry) => OPEN_LABEL[entry.kind] ?? (isTextFile(entry.name) ? 'Open in Code' : 'Open')

export function Files({ onOpenFile, onOpenFolder, onOpenMedia, onShareFolder }: Props) {
  const { root } = useAuth()
  const { favorites, locations } = usePlaces()
  const insideRoot = (p: string) => root === '/' || p === root || p.startsWith(`${root}/`)
  // Start in /DATA like CasaOS, even when the whole filesystem is browsable.
  const [history, setHistory] = useState(() => [insideRoot(DATA_ROOT) ? DATA_ROOT : root])
  const [index, setIndex] = useState(0)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const { show } = useContextMenu()
  const { settings, update } = useSettings()
  const clip = useFileClipboard()
  const view = settings.filesView
  const iconSize = settings.filesIconSize
  const sort = settings.filesSort
  const path = history[index]
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    api
      .listFiles(path)
      .then(list => {
        if (!alive) return
        setEntries(list)
        setLoadError(null)
      })
      .catch((err: Error) => {
        if (!alive) return
        setEntries([])
        setLoadError(err.message)
      })
    return () => {
      alive = false
    }
  }, [path, version])

  const refresh = () => setVersion(v => v + 1)
  const sorted = sortEntries(entries, sort.key, sort.desc)
  const fullPath = (name: string) => joinPath(path, name)
  const selectedEntries = sorted.filter(e => selected.has(e.name))
  const single = selectedEntries.length === 1 ? selectedEntries[0] : null

  const select = (names: string[], anchorName: string | null = names[0] ?? null) => {
    setSelected(new Set(names))
    setAnchor(anchorName)
  }

  // ----- Uploads: buttons, menus, and dragging files in from the computer -----
  // A big folder lands file by file; re-list at most once a second while it does.
  const refreshTimer = useRef(0)
  const refreshSoon = () => {
    if (refreshTimer.current) return
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = 0
      refresh()
    }, 1000)
  }
  const uploads = useUploads(refreshSoon)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  // "" = the open folder; a name = that subfolder; null = not dragging over.
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const isFileDrag = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')
  const dropInto = (e: DragEvent, dir: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const dropped = entriesFromDrop(e.dataTransfer)
    if (dropped.length) void itemsFromEntries(dropped).then(items => uploads.upload(dir, items))
    else uploads.upload(dir, itemsFromInput(e.dataTransfer.files))
  }
  const uploadItems: MenuItem[] = [
    { label: 'Upload Files…', icon: Upload, onSelect: () => fileInput.current?.click() },
    { label: 'Upload Folder…', icon: FolderPlus, onSelect: () => folderInput.current?.click() },
  ]

  // ----- Navigation and opening -----
  const navigate = (next: string) => {
    if (next === path) return
    setHistory(h => [...h.slice(0, index + 1), next])
    setIndex(i => i + 1)
    select([])
    setRenaming(null)
  }
  const step = (delta: number) => {
    setIndex(i => i + delta)
    select([])
    setRenaming(null)
  }
  const canOpen = (entry: FileEntry) => entry.kind === 'folder' || isMedia(entry) || isTextFile(entry.name)
  const openEntry = (entry: FileEntry) => {
    if (entry.kind === 'folder') navigate(fullPath(entry.name))
    else if (isMedia(entry)) onOpenMedia(fullPath(entry.name), entry.kind)
    else if (isTextFile(entry.name)) onOpenFile(fullPath(entry.name))
  }

  // ----- Edits -----
  const newFolder = async () => {
    const name = await api.createFolder(path)
    refresh()
    select([name])
    setRenaming(name)
  }
  const finishRename = async (from: string, value: string | null) => {
    setRenaming(null)
    const to = value?.trim()
    if (!to || to === from || to.includes('/') || entries.some(e => e.name === to)) return
    await api.renameEntry(path, from, to)
    select([to])
    refresh()
  }
  const remove = async (names: string[]) => {
    try {
      for (const name of names) await api.deleteEntry(path, name)
    } finally {
      select([])
      refresh()
    }
  }

  const copyItems = (cut: boolean) =>
    selectedEntries.length && setFileClipboard({ paths: selectedEntries.map(e => fullPath(e.name)), cut })
  const paste = async (into = path) => {
    if (!clip) return
    setWorking(`${clip.cut ? 'Moving' : 'Copying'} ${clip.paths.length} item${clip.paths.length > 1 ? 's' : ''}…`)
    try {
      const names = await api.copyEntries(clip.paths, into, clip.cut)
      if (clip.cut) setFileClipboard(null)
      if (into === path) select(names)
    } finally {
      setWorking(null)
      refresh()
    }
  }
  const duplicate = async () => {
    if (!selectedEntries.length) return
    setWorking('Duplicating…')
    try {
      select(await api.copyEntries(selectedEntries.map(e => fullPath(e.name)), path))
    } finally {
      setWorking(null)
      refresh()
    }
  }
  const clipCount = clip?.paths.length ?? 0
  const pasteLabel = clipCount ? `Paste ${clipCount === 1 ? 'Item' : `${clipCount} Items`}` : 'Paste'
  const isCut = (entry: FileEntry) => !!clip?.cut && clip.paths.includes(fullPath(entry.name))

  // ----- Menus -----
  const editItems = (): MenuItem[] => [
    { label: 'Cut', icon: Scissors, shortcut: `${MOD}X`, disabled: !selectedEntries.length, onSelect: () => copyItems(true) },
    { label: 'Copy', icon: Copy, shortcut: `${MOD}C`, disabled: !selectedEntries.length, onSelect: () => copyItems(false) },
    { label: pasteLabel, icon: ClipboardPaste, shortcut: `${MOD}V`, disabled: !clip, onSelect: () => void paste() },
    { label: 'Duplicate', icon: CopyPlus, shortcut: `${MOD}D`, disabled: !selectedEntries.length, onSelect: () => void duplicate() },
  ]

  const entryMenu = (e: MouseEvent, entry: FileEntry) => {
    // Right-clicking outside the selection selects just that item.
    const items = selected.has(entry.name) ? selectedEntries : [entry]
    if (!selected.has(entry.name)) select([entry.name])
    const many = items.length > 1
    const isFolder = entry.kind === 'folder' && !many
    show(e, [
      ...(many
        ? []
        : ([
            {
              label: openLabel(entry),
              icon: isFolder ? FolderOpen : Braces,
              disabled: !canOpen(entry),
              onSelect: () => openEntry(entry),
            },
            ...(isFolder
              ? [
                  { label: 'Open in Code', icon: Braces, onSelect: () => onOpenFolder(fullPath(entry.name)) },
                  { label: 'Share Folder…', icon: Share2, onSelect: () => onShareFolder(fullPath(entry.name)) },
                ]
              : []),
            ...(entry.kind === 'image'
              ? [
                  {
                    label: 'Set as Wallpaper',
                    icon: Image,
                    onSelect: async () => update({ customWallpaper: (await api.wallpaperFromFile(fullPath(entry.name))).url }),
                  },
                ]
              : []),
            'separator',
          ] as MenuItem[])),
      {
        label: many ? `Cut ${items.length} Items` : 'Cut',
        icon: Scissors,
        onSelect: () => setFileClipboard({ paths: items.map(i => fullPath(i.name)), cut: true }),
      },
      {
        label: many ? `Copy ${items.length} Items` : 'Copy',
        icon: Copy,
        onSelect: () => setFileClipboard({ paths: items.map(i => fullPath(i.name)), cut: false }),
      },
      ...(isFolder && clip
        ? [{ label: `${pasteLabel} Into Folder`, icon: ClipboardPaste, onSelect: () => void paste(fullPath(entry.name)) }]
        : []),
      { label: 'Duplicate', icon: CopyPlus, onSelect: () => void duplicate() },
      'separator',
      ...(many ? [] : [{ label: 'Rename', icon: Pencil, onSelect: () => setRenaming(entry.name) }]),
      { label: 'Copy Path', icon: Copy, onSelect: () => void copyText(items.map(i => fullPath(i.name)).join('\n')) },
      'separator',
      {
        label: many ? `Delete ${items.length} Items…` : 'Delete…',
        confirm: 'Click Again to Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => void remove(items.map(i => i.name)),
      },
    ])
  }

  const backgroundMenu = (e: MouseEvent) => {
    if (e.defaultPrevented) return
    select([])
    show(e, [
      { label: 'New Folder', icon: FolderPlus, onSelect: () => void newFolder() },
      ...uploadItems,
      'separator',
      { label: pasteLabel, icon: ClipboardPaste, disabled: !clip, onSelect: () => void paste() },
      'separator',
      ...viewItems(),
      'separator',
      { label: 'Open Folder in Code', icon: Braces, onSelect: () => onOpenFolder(path) },
      { label: 'Copy Path', icon: Copy, onSelect: () => void copyText(path) },
      { label: 'Refresh', icon: RotateCw, onSelect: refresh },
    ])
  }

  const setView = (v: FilesView) => update({ filesView: v })
  const setSort = (key: FilesSortKey) =>
    update(s => ({ filesSort: { key, desc: s.filesSort.key === key ? !s.filesSort.desc : key === 'modified' || key === 'size' } }))
  const setIconSize = (n: number) => update({ filesIconSize: Math.max(ICON_SIZES.min, Math.min(ICON_SIZES.max, n)) })
  const viewItems = (): MenuItem[] => VIEWS.map(v => ({ label: v.label, icon: v.icon, checked: view === v.id, onSelect: () => setView(v.id) }))
  const sortItems = (): MenuItem[] => [
    ...SORTS.map(s => ({ label: s.label, checked: sort.key === s.key, onSelect: () => update({ filesSort: { ...sort, key: s.key } }) })),
    'separator',
    { label: 'Ascending', checked: !sort.desc, onSelect: () => update({ filesSort: { ...sort, desc: false } }) },
    { label: 'Descending', checked: sort.desc, onSelect: () => update({ filesSort: { ...sort, desc: true } }) },
  ]

  useAppMenus(() => [
    {
      label: 'File',
      items: [
        { label: 'New Folder', icon: FolderPlus, onSelect: () => void newFolder() },
        ...uploadItems,
        'separator',
        {
          label: single ? openLabel(single) : 'Open',
          icon: FolderOpen,
          disabled: !single || !canOpen(single),
          onSelect: () => single && openEntry(single),
        },
        { label: 'Rename', icon: Pencil, disabled: !single, onSelect: () => single && setRenaming(single.name) },
        {
          label: selectedEntries.length > 1 ? `Delete ${selectedEntries.length} Items…` : 'Delete…',
          confirm: 'Click Again to Delete',
          icon: Trash2,
          danger: true,
          disabled: !selectedEntries.length,
          onSelect: () => void remove(selectedEntries.map(e => e.name)),
        },
        'separator',
        {
          label: 'Copy Path',
          icon: Copy,
          onSelect: () => void copyText(selectedEntries.length ? selectedEntries.map(e => fullPath(e.name)).join('\n') : path),
        },
      ],
    },
    {
      label: 'Edit',
      items: [
        ...editItems(),
        'separator',
        { label: 'Select All', icon: SquareCheck, shortcut: `${MOD}A`, onSelect: () => select(sorted.map(e => e.name)) },
      ],
    },
    {
      label: 'View',
      items: [
        ...viewItems(),
        'separator',
        ...sortItems(),
        'separator',
        { label: 'Bigger Icons', disabled: view !== 'icons', onSelect: () => setIconSize(iconSize + 16) },
        { label: 'Smaller Icons', disabled: view !== 'icons', onSelect: () => setIconSize(iconSize - 16) },
        'separator',
        { label: 'Refresh', icon: RotateCw, onSelect: refresh },
      ],
    },
    {
      label: 'Go',
      items: [
        { label: 'Back', icon: ChevronLeft, disabled: index === 0, onSelect: () => step(-1) },
        { label: 'Forward', icon: ChevronRight, disabled: index === history.length - 1, onSelect: () => step(1) },
        {
          label: 'Enclosing Folder',
          icon: FolderOpen,
          disabled: path === root,
          onSelect: () => navigate(parentOf(path)),
        },
        'separator',
        ...[...locations, ...favorites].map(place => ({
          label: place.label,
          icon: place.icon,
          checked: place.path === path,
          onSelect: () => navigate(place.path),
        })),
      ],
    },
  ])

  // ----- Selection with mouse and keyboard -----
  const clickEntry = (e: MouseEvent, entry: FileEntry) => {
    if (e.shiftKey && anchor) {
      const names = sorted.map(x => x.name)
      const [a, b] = [names.indexOf(anchor), names.indexOf(entry.name)].sort((x, y) => x - y)
      setSelected(new Set(names.slice(a, b + 1)))
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(entry.name)) next.delete(entry.name)
      else next.add(entry.name)
      setSelected(next)
      setAnchor(entry.name)
    } else {
      select([entry.name])
    }
  }

  // How many tiles fit in a row of the icon grid, for Up/Down.
  const columns = () => {
    const grid = scroller.current?.querySelector('.file-grid')
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1
  }

  const onKey = (e: KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).closest('input, textarea')) return
    const names = sorted.map(x => x.name)
    const current = anchor ? names.indexOf(anchor) : -1
    const move = (delta: number) => {
      e.preventDefault()
      const next = names[Math.max(0, Math.min(names.length - 1, current < 0 ? 0 : current + delta))]
      if (!next) return
      if (e.shiftKey && anchor) {
        const [a, b] = [names.indexOf(anchor), names.indexOf(next)].sort((x, y) => x - y)
        setSelected(new Set(names.slice(a, b + 1)))
      } else select([next])
      scroller.current?.querySelector(`[data-name="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    const across = view === 'icons' ? columns() : 1
    switch (e.key) {
      case 'ArrowRight':
        if (view !== 'list') move(1)
        break
      case 'ArrowLeft':
        if (view !== 'list') move(-1)
        break
      case 'ArrowDown':
        if (view !== 'gallery') move(across)
        break
      case 'ArrowUp':
        if (view !== 'gallery') move(-across)
        break
      case 'Enter':
        if (single) openEntry(single)
        break
      case 'F2':
        if (single) setRenaming(single.name)
        break
      case 'Delete':
        if (selectedEntries.length) void remove(selectedEntries.map(x => x.name))
        break
      case 'Escape':
        select([])
        break
    }
  }

  // Everything a tile, row or filmstrip cell does, in any view.
  const entryProps = (entry: FileEntry) => ({
    'data-name': entry.name,
    role: 'option',
    'aria-selected': selected.has(entry.name),
    title: entry.name,
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      clickEntry(e, entry)
    },
    onDoubleClick: () => openEntry(entry),
    onContextMenu: (e: MouseEvent) => entryMenu(e, entry),
    // Dropping onto a folder copies into that folder instead.
    ...(entry.kind === 'folder'
      ? {
          onDragOver: (e: DragEvent) => {
            if (!isFileDrag(e)) return
            e.preventDefault()
            e.stopPropagation()
            setDropTarget(entry.name)
          },
          onDragLeave: () => setDropTarget(''),
          onDrop: (e: DragEvent) => isFileDrag(e) && dropInto(e, fullPath(entry.name)),
        }
      : {}),
  })
  const stateClass = (entry: FileEntry) =>
    `${selected.has(entry.name) ? 'is-selected' : ''} ${dropTarget === entry.name ? 'is-drop' : ''} ${isCut(entry) ? 'is-cut' : ''}`

  const icon = (entry: FileEntry, box: number) => {
    const Icon = KIND_ICON[entry.kind]
    const color = KIND_COLOR[entry.kind]
    return (
      <FileThumb key={fullPath(entry.name)} entry={entry} path={fullPath(entry.name)} box={box}>
        <Icon size={Math.round(box * 0.72)} strokeWidth={box > 40 ? 1.2 : 1.6} color={color} fill={color} fillOpacity={0.16} />
      </FileThumb>
    )
  }
  const label = (entry: FileEntry) =>
    renaming === entry.name ? (
      <RenameField name={entry.name} onDone={value => void finishRename(entry.name, value)} />
    ) : (
      <span className="file-name">{entry.name}</span>
    )

  const placeButton = ({ path: p, label: text, icon: Icon }: Place) => (
    <button
      key={p}
      className={`sidebar-item ${p === path ? 'is-active' : ''}`}
      onClick={() => navigate(p)}
      title={p}
      onContextMenu={e =>
        show(e, [
          { label: 'Open', icon: FolderOpen, onSelect: () => navigate(p) },
          { label: 'Open in Code', icon: Braces, onSelect: () => onOpenFolder(p) },
          { label: 'Copy Path', icon: Copy, onSelect: () => void copyText(p) },
        ])
      }
    >
      <Icon size={15} /> {text}
    </button>
  )

  const listHeader = (key: FilesSortKey, text: string, className = '') => (
    <button className={`${className} ${sort.key === key ? 'is-sorted' : ''}`} onClick={() => setSort(key)}>
      {text}
      {sort.key === key && <ChevronDown size={12} className={sort.desc ? '' : 'flip'} />}
    </button>
  )

  const galleryItem = single ?? selectedEntries[0] ?? null
  // The gallery always shows something: the first item until one is chosen.
  useEffect(() => {
    if (view === 'gallery' && selected.size === 0 && sorted.length > 0) select([sorted[0].name])
  }, [view, sorted.length, selected.size])

  const content = () => {
    if (view === 'list') {
      return (
        <div className="file-list" role="listbox" aria-multiselectable>
          <div className="file-list-head">
            {listHeader('name', 'Name')}
            {listHeader('modified', 'Date Modified')}
            {listHeader('size', 'Size', 'is-num')}
            {listHeader('kind', 'Kind')}
          </div>
          {sorted.map(entry => (
            <div key={entry.name} className={`file-row ${stateClass(entry)}`} {...entryProps(entry)}>
              <span className="file-row-name">
                {icon(entry, 18)}
                {label(entry)}
              </span>
              <span>{formatFileDate(entry.modified)}</span>
              <span className="is-num">{entry.kind === 'folder' ? '--' : formatBytes(entry.size ?? 0)}</span>
              <span>{kindLabel(entry)}</span>
            </div>
          ))}
        </div>
      )
    }
    if (view === 'gallery') {
      return (
        <div className="file-gallery">
          <GalleryPreview entry={galleryItem} path={galleryItem ? fullPath(galleryItem.name) : ''} kind={galleryItem ? kindLabel(galleryItem) : ''} />
          <div className="file-strip" role="listbox">
            {sorted.map(entry => (
              <div key={entry.name} className={`file-strip-item ${stateClass(entry)}`} {...entryProps(entry)}>
                {icon(entry, 56)}
              </div>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div
        className="file-grid"
        role="listbox"
        aria-multiselectable
        style={{ '--icon': `${iconSize}px` } as CSSProperties}
      >
        {sorted.map(entry => (
          <div key={entry.name} className={`file ${stateClass(entry)}`} {...entryProps(entry)}>
            {icon(entry, iconSize)}
            {label(entry)}
          </div>
        ))}
      </div>
    )
  }

  const totalSize = selectedEntries.reduce((sum, e) => sum + (e.size ?? 0), 0)

  return (
    <div className="split">
      <aside className="sidebar">
        {favorites.length > 0 && <div className="sidebar-group">Favorites</div>}
        {favorites.map(placeButton)}
        {locations.length > 0 && <div className="sidebar-group">Locations</div>}
        {locations.map(placeButton)}
      </aside>

      <div
        className="files-main"
        onDragOver={e => {
          if (!isFileDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (dropTarget === null) setDropTarget('')
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
        }}
        onDrop={e => isFileDrag(e) && dropInto(e, path)}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={e => {
            uploads.upload(path, itemsFromInput(e.target.files))
            e.target.value = ''
          }}
        />
        <input
          ref={folderInput}
          type="file"
          hidden
          {...{ webkitdirectory: '' }}
          onChange={e => {
            uploads.upload(path, itemsFromInput(e.target.files))
            e.target.value = ''
          }}
        />
        {dropTarget === '' && (
          <div className="files-drop" aria-hidden>
            <Upload size={28} />
            <strong>Drop to copy into {displayName(path)}</strong>
          </div>
        )}
        <UploadsPanel jobs={uploads.jobs} busy={uploads.busy} onCancel={uploads.cancelAll} onClear={uploads.clear} />

        <WindowToolbar>
          <div className="tb-group">
            <button className="tb-btn" onClick={() => step(-1)} disabled={index === 0} aria-label="Back" title="Back">
              <ChevronLeft size={18} />
            </button>
            <button
              className="tb-btn"
              onClick={() => step(1)}
              disabled={index === history.length - 1}
              aria-label="Forward"
              title="Forward"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <ToolbarTitle title={displayName(path)} />
          <span className="tb-spacer" />
          <div className="tb-segmented tb-icons" role="radiogroup" aria-label="View">
            {VIEWS.map(v => (
              <button
                key={v.id}
                className={view === v.id ? 'is-active' : ''}
                onClick={() => setView(v.id)}
                aria-label={`View ${v.label}`}
                title={`View ${v.label}`}
              >
                <v.icon size={15} />
              </button>
            ))}
          </div>
          <div className="tb-group">
            <button
              className="tb-btn"
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect()
                show({ x: r.left, y: r.bottom + 6 }, sortItems())
              }}
              aria-label="Sort by"
              title="Sort By"
            >
              <ArrowUpDown size={15} />
            </button>
            <button
              className="tb-btn"
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect()
                show({ x: r.left, y: r.bottom + 6 }, uploadItems)
              }}
              aria-label="Upload"
              title="Upload files or a folder"
            >
              <Upload size={16} />
            </button>
            <button className="tb-btn" onClick={() => void newFolder()} aria-label="New folder" title="New Folder">
              <FolderPlus size={17} />
            </button>
          </div>
        </WindowToolbar>

        <div
          ref={scroller}
          className={`files-scroll is-${view}`}
          tabIndex={0}
          onKeyDown={onKey}
          onClick={() => select([])}
          onContextMenu={backgroundMenu}
        >
          {content()}
          {loadError ? (
            <p className="empty files-empty files-error">Can’t open this folder: {loadError}</p>
          ) : (
            entries.length === 0 && <p className="empty files-empty">This folder is empty.</p>
          )}
        </div>

        {/* Path bar (View → Show Path Bar). */}
        <div className="files-crumbs">
          {ancestors(path)
            .filter(crumb => insideRoot(crumb.path))
            .map((crumb, i, all) => (
              <span key={crumb.path}>
                <button onClick={() => navigate(crumb.path)} disabled={crumb.path === path}>
                  <Folder size={11} /> {crumb.name}
                </button>
                {i < all.length - 1 && <ChevronRight size={10} />}
              </span>
            ))}
        </div>
        <div className="statusbar">
          <span>
            {working ??
              (selectedEntries.length > 1
                ? `${selectedEntries.length} of ${entries.length} selected${totalSize ? ` · ${formatBytes(totalSize)}` : ''}`
                : `${entries.length} items`)}
          </span>
          {view === 'icons' ? (
            <input
              className="files-zoom"
              type="range"
              min={ICON_SIZES.min}
              max={ICON_SIZES.max}
              step={8}
              value={iconSize}
              onChange={e => setIconSize(Number(e.target.value))}
              aria-label="Icon size"
              title="Icon size"
            />
          ) : (
            <span>
              {single
                ? `${single.name}${single.size ? ` · ${formatBytes(single.size)}` : ''} · ${formatFileDate(single.modified)}`
                : clip
                  ? `${clip.paths.length} item${clip.paths.length > 1 ? 's' : ''} ${clip.cut ? 'to move' : 'copied'} · ${MOD}V to paste`
                  : 'Right-click for more options'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** The large preview of Gallery view: the photo itself, a playable video, or the item's details. */
function GalleryPreview({ entry, path, kind }: { entry: FileEntry | null; path: string; kind: string }) {
  if (!entry) return <div className="file-preview" />
  const Icon = KIND_ICON[entry.kind]
  return (
    <div className="file-preview">
      <div className="file-preview-stage" key={path}>
        {entry.kind === 'image' ? (
          <img src={api.rawFileUrl(path)} alt={entry.name} draggable={false} />
        ) : entry.kind === 'video' ? (
          <video src={api.rawFileUrl(path)} poster={api.thumbUrl(path, `${entry.size ?? 0}-${entry.modified}`) ?? undefined} controls preload="none" />
        ) : (
          <Icon size={120} strokeWidth={1} color={KIND_COLOR[entry.kind]} fill={KIND_COLOR[entry.kind]} fillOpacity={0.14} />
        )}
      </div>
      <div className="file-preview-info">
        <strong>{entry.name}</strong>
        <span>
          {kind}
          {entry.size ? ` · ${formatBytes(entry.size)}` : ''}
          {` · ${formatFileDate(entry.modified)}`}
        </span>
      </div>
    </div>
  )
}

/**
 * Photos and videos show a thumbnail (made on the server, only once it scrolls into view); the
 * kind's icon stays underneath until it loads, and if the file can't be previewed.
 */
function FileThumb({ entry, path, box, children }: { entry: FileEntry; path: string; box: number; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'broken'>('loading')
  const media = entry.kind === 'image' || entry.kind === 'video'
  const url = media ? api.thumbUrl(path, `${entry.size ?? 0}-${entry.modified}`) : null
  const style = { '--thumb': `${box}px` } as CSSProperties
  if (!url || state === 'broken') {
    return (
      <span className="file-thumb is-icon" style={style}>
        {children}
      </span>
    )
  }
  return (
    <span className={`file-thumb is-${state}`} style={style}>
      {state === 'loading' && children}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setState('ready')}
        onError={() => setState('broken')}
      />
      {entry.kind === 'video' && state === 'ready' && box >= 40 && (
        <i className="file-thumb-play" aria-hidden>
          <Play size={10} fill="currentColor" />
        </i>
      )}
    </span>
  )
}
