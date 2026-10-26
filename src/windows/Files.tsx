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
  Clock,
  AppWindow,
  ArrowRightLeft,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  GalleryHorizontal,
  Image,
  Inbox,
  Info,
  LayoutGrid,
  Link2,
  List,
  Music,
  Pencil,
  Play,
  RotateCw,
  Scissors,
  Share2,
  SquareCheck,
  Tag,
  Trash2,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { FileEntry, FileKind, TagColor, TrashItem } from '../api/types'
import type { MenuItem } from '../components/ContextMenu'
import { RenameField } from '../components/RenameField'
import { ShareLinkSheet } from '../components/ShareLinkSheet'
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
import { DATA_ROOT, RECENTS_PLACE, TRASH_PLACE, type Place } from '../lib/places'
import { MOD } from '../lib/platform'
import { useSettings, type FilesSortKey, type FilesView } from '../lib/settings'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { tr } from '../lib/i18n'
import { useMobileBack } from '../lib/mobileBack'
import { SHELL } from '../lib/shell'
import { KIND_COLOR, KIND_ICON } from '../lib/fileKinds'


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
  { id: 'icons', label: tr('as Icons'), icon: LayoutGrid },
  { id: 'list', label: tr('as List'), icon: List },
  { id: 'gallery', label: tr('as Gallery'), icon: GalleryHorizontal },
]

const SORTS: { key: FilesSortKey; label: string }[] = [
  { key: 'name', label: tr('Name') },
  { key: 'kind', label: tr('Kind') },
  { key: 'modified', label: tr('Date Modified') },
  { key: 'size', label: tr('Size') },
]

const ICON_SIZES = { min: 40, max: 144 }

export const TAGS: { id: TagColor; label: string; color: string }[] = [
  { id: 'red', label: tr('Red'), color: '#ff453a' },
  { id: 'orange', label: tr('Orange'), color: '#ff9f0a' },
  { id: 'yellow', label: tr('Yellow'), color: '#ffd60a' },
  { id: 'green', label: tr('Green'), color: '#30d158' },
  { id: 'blue', label: tr('Blue'), color: '#0a84ff' },
  { id: 'purple', label: tr('Purple'), color: '#bf5af2' },
  { id: 'gray', label: tr('Gray'), color: '#98989d' },
]
const TAG_COLOR = Object.fromEntries(TAGS.map(t => [t.id, t.color])) as Record<TagColor, string>
const TAG_PREFIX = 'tag:'

/** Which list a path is: a folder (null), Recents, the Trash, or everything with one tag. */
const virtualOf = (p: string) => (p === RECENTS_PLACE ? 'recents' : p === TRASH_PLACE ? 'trash' : p.startsWith(TAG_PREFIX) ? 'tag' : null)
const placeTitle = (p: string) =>
  p === RECENTS_PLACE ? tr('Recents') : p === TRASH_PLACE ? tr('Trash') : p.startsWith(TAG_PREFIX) ? (TAGS.find(t => p === TAG_PREFIX + t.id)?.label ?? '') : displayName(p)

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
  /** Opens a video or sound file in Remux, to change its format. */
  onConvert: (path: string) => void
  /** Get Info: a window about one file or folder. */
  onGetInfo: (path: string) => void
  /** Go here (from the desktop's Go menu); a new nonce goes again. */
  open?: { path: string; nonce: number } | null
}

const isMedia = (entry: FileEntry): entry is FileEntry & { kind: MediaKind } =>
  entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'audio'

const OPEN_LABEL: Partial<Record<FileKind, string>> = {
  folder: tr('Open'),
  image: tr('Open in Image Viewer'),
  video: tr('Play in Video Player'),
  audio: tr('Play in Music Player'),
}
const openLabel = (entry: FileEntry) => OPEN_LABEL[entry.kind] ?? (isTextFile(entry.name) ? 'Open in Code' : 'Open')

export function Files({ onOpenFile, onOpenFolder, onOpenMedia, onShareFolder, onConvert, onGetInfo, open }: Props) {
  const { root, home } = useAuth()
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
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  // Share Link… / Request Files… is open for this item.
  const [shareFor, setShareFor] = useState<{ path: string; name: string; upload: boolean } | null>(null)
  const { show } = useContextMenu()
  const { settings, update } = useSettings()
  const clip = useFileClipboard()
  const view = settings.filesView
  const iconSize = settings.filesIconSize
  const sort = settings.filesSort
  const path = history[index]
  const scroller = useRef<HTMLDivElement>(null)

  // The folder the entries belong to: until the new one arrives the old list isn't shown,
  // so a slow folder (a cloud drive, a sleeping disk) never appears under another's name.
  const [listed, setListed] = useState<string | null>(null)
  const virtual = virtualOf(path)
  const [trashItems, setTrashItems] = useState<TrashItem[]>([])
  useEffect(() => {
    let alive = true
    const load =
      path === RECENTS_PLACE
        ? api.recentFiles()
        : path === TRASH_PLACE
          ? api.trash().then(items => {
              if (alive) setTrashItems(items)
              return items.map((t): FileEntry => ({ name: t.name, kind: t.kind, size: t.size, modified: t.deleted, path: TRASH_PLACE + t.id }))
            })
          : path.startsWith(TAG_PREFIX)
            ? api.taggedFiles(path.slice(TAG_PREFIX.length) as TagColor)
            : api.listFiles(path)
    load
      .then(list => {
        if (!alive) return
        setEntries(list)
        setListed(path)
        setLoadError(null)
      })
      .catch((err: Error) => {
        if (!alive) return
        // A server without /DATA opens at home (or the root) instead of on an error.
        if (path === DATA_ROOT && history.length === 1) {
          const start = home && insideRoot(home) ? home : root
          if (start !== DATA_ROOT) return setHistory([start])
        }
        setEntries([])
        setListed(path)
        setLoadError(err.message)
      })
    return () => {
      alive = false
    }
  }, [path, version])

  // Tags of every file, for the dots beside names.
  const [tags, setTags] = useState<Record<string, TagColor[]>>({})
  const loadTags = () => api.fileTags().then(setTags, () => {})
  useEffect(() => {
    void loadTags()
  }, [version])

  const refresh = () => setVersion(v => v + 1)
  const loading = listed !== path
  // Recents keep the order they were opened in.
  const sorted = loading ? [] : virtual === 'recents' ? entries : sortEntries(entries, sort.key, sort.desc)
  // Files listed away from their folder (Recents, a tag, the Trash) carry their own path, and
  // names can repeat there, so selection goes by path for them.
  const keyOf = (e: FileEntry) => e.path ?? e.name
  const pathOf = (e: FileEntry): string => e.path ?? joinPath(path, e.name)
  const selectedEntries = sorted.filter(e => selected.has(keyOf(e)))
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
    { label: tr('Upload Files…'), icon: Upload, onSelect: () => fileInput.current?.click() },
    { label: tr('Upload Folder…'), icon: FolderPlus, onSelect: () => folderInput.current?.click() },
  ]

  // ----- Navigation and opening -----
  const navigate = (next: string) => {
    if (next === path) return
    setHistory(h => [...h.slice(0, index + 1), next])
    setIndex(i => i + 1)
    select([])
    setRenaming(null)
  }
  // Each request moves the window once (effects can run twice in development).
  const handledOpen = useRef(0)
  useEffect(() => {
    if (!open || handledOpen.current === open.nonce) return
    handledOpen.current = open.nonce
    navigate(open.path)
  }, [open?.nonce])
  const step = (delta: number) => {
    setIndex(i => i + delta)
    select([])
    setRenaming(null)
  }
  // On a phone, its back button goes back through the folders first.
  useMobileBack(() => {
    if (index === 0) return false
    step(-1)
    return true
  })
  const canOpen = (entry: FileEntry) => virtual !== 'trash' && (entry.kind === 'folder' || isMedia(entry) || isTextFile(entry.name))
  const opened = (p: string) => void api.addRecentFile(p).catch(() => {})
  const openEntry = (entry: FileEntry) => {
    if (!canOpen(entry)) return
    const p = pathOf(entry)
    if (entry.kind === 'folder') return navigate(p)
    opened(p)
    if (isMedia(entry)) onOpenMedia(p, entry.kind)
    else onOpenFile(p)
  }
  /** Shows a file from Recents or a tag in its folder, selected. */
  const showInFolder = (entry: FileEntry) => {
    navigate(parentOf(pathOf(entry)))
    select([entry.name])
  }
  // Open With ▸: every app that can show the file, the one double-click uses first. Code takes
  // anything that isn't media, and SVG pictures (the server turns away binary and very large
  // files). A .ts video is media here, though .ts is also TypeScript's extension.
  const openWith = (entry: FileEntry): MenuItem[] => {
    const p = pathOf(entry)
    const apps: { label: string; icon: LucideIcon; open: () => void; isDefault: boolean }[] = []
    if (entry.kind === 'image') apps.push({ label: tr('Image Viewer'), icon: Image, open: () => onOpenMedia(p, 'image'), isDefault: true })
    if (entry.kind === 'video' || entry.kind === 'audio') {
      apps.push({ label: tr('Video Player'), icon: Film, open: () => onOpenMedia(p, 'video'), isDefault: entry.kind === 'video' })
      apps.push({ label: tr('Music Player'), icon: Music, open: () => onOpenMedia(p, 'audio'), isDefault: entry.kind === 'audio' })
    }
    if (!isMedia(entry) || (entry.kind === 'image' && isTextFile(entry.name)))
      apps.push({ label: tr('Code'), icon: Braces, open: () => onOpenFile(p), isDefault: !isMedia(entry) && isTextFile(entry.name) })
    if (entry.kind === 'video' || entry.kind === 'audio') apps.push({ label: tr('Remux'), icon: ArrowRightLeft, open: () => onConvert(p), isDefault: false })
    const first = apps.filter(a => a.isDefault)
    const rest = apps.filter(a => !a.isDefault)
    const item = (a: (typeof apps)[number]): MenuItem => ({
      label: a.isDefault ? tr('{0} (default)', a.label) : a.label,
      icon: a.icon,
      onSelect: () => {
        opened(p)
        a.open()
      },
    })
    return [...first.map(item), ...(first.length && rest.length ? (['separator'] as MenuItem[]) : []), ...rest.map(item)]
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
  const remove = async (items: FileEntry[], forever = false) => {
    try {
      if (virtual === 'trash') for (const e of items) await api.deleteFromTrash(e.path!.slice(TRASH_PLACE.length))
      else if (forever) for (const e of items) await api.deleteEntry(parentOf(pathOf(e)), e.name)
      else await api.moveToTrash(items.map(pathOf))
    } finally {
      select([])
      refresh()
    }
  }
  const putBack = async (items: FileEntry[]) => {
    try {
      await api.putBack(items.map(e => e.path!.slice(TRASH_PLACE.length)))
    } finally {
      select([])
      refresh()
    }
  }
  const emptyTrash = async () => {
    try {
      await api.emptyTrash()
    } finally {
      select([])
      refresh()
    }
  }
  const toggleTag = async (items: FileEntry[], tag: TagColor) => {
    const all = items.every(i => tags[pathOf(i)]?.includes(tag))
    for (const i of items) {
      const now = tags[pathOf(i)] ?? []
      await api.setFileTags([pathOf(i)], all ? now.filter(t => t !== tag) : [...now.filter(t => t !== tag), tag])
    }
    await loadTags()
    if (virtual === 'tag') refresh()
  }
  const tagItems = (items: FileEntry[]): MenuItem[] =>
    TAGS.map(t => ({ label: t.label, color: t.color, checked: items.every(i => tags[pathOf(i)]?.includes(t.id)), onSelect: () => void toggleTag(items, t.id) }))
  const trashLabel = (n: number) => (n > 1 ? tr('Move {0} Items to Trash', n) : tr('Move to Trash'))
  const deleteNowLabel = (n: number) => (n > 1 ? tr('Delete {0} Items Immediately…', n) : tr('Delete Immediately…'))

  const copyItems = (cut: boolean) =>
    selectedEntries.length && setFileClipboard({ paths: selectedEntries.map(e => pathOf(e)), cut })
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
      select(await api.copyEntries(selectedEntries.map(e => pathOf(e)), path))
    } finally {
      setWorking(null)
      refresh()
    }
  }
  const clipCount = clip?.paths.length ?? 0
  const pasteLabel = clipCount ? `Paste ${clipCount === 1 ? 'Item' : `${clipCount} Items`}` : 'Paste'
  const isCut = (entry: FileEntry) => !!clip?.cut && clip.paths.includes(pathOf(entry))

  // ----- Menus -----
  const editItems = (): MenuItem[] => [
    { label: tr('Cut'), icon: Scissors, shortcut: `${MOD}X`, disabled: !selectedEntries.length, onSelect: () => copyItems(true) },
    { label: tr('Copy'), icon: Copy, shortcut: `${MOD}C`, disabled: !selectedEntries.length, onSelect: () => copyItems(false) },
    { label: pasteLabel, icon: ClipboardPaste, shortcut: `${MOD}V`, disabled: !clip, onSelect: () => void paste() },
    { label: tr('Duplicate'), icon: CopyPlus, shortcut: `${MOD}D`, disabled: !selectedEntries.length, onSelect: () => void duplicate() },
  ]

  const entryMenu = (e: MouseEvent, entry: FileEntry) => {
    // Right-clicking outside the selection selects just that item.
    const items = selected.has(keyOf(entry)) ? selectedEntries : [entry]
    if (!selected.has(keyOf(entry))) select([keyOf(entry)])
    const many = items.length > 1
    const isFolder = entry.kind === 'folder' && !many
    if (virtual === 'trash') {
      const from = trashItems.find(t => TRASH_PLACE + t.id === entry.path)?.from
      return show(e, [
        { label: many ? tr('Put Back {0} Items', items.length) : tr('Put Back'), icon: Undo2, onSelect: () => void putBack(items) },
        ...(!many && from ? [{ label: tr('Copy Original Location'), icon: Copy, onSelect: () => void copyText(from) }] : []),
        'separator',
        { label: deleteNowLabel(items.length), confirm: tr('Click Again to Delete'), icon: Trash2, danger: true, onSelect: () => void remove(items) },
      ])
    }
    show(e, [
      ...(many
        ? []
        : ([
            {
              label: openLabel(entry),
              icon: isFolder ? FolderOpen : entry.kind === 'image' ? Image : entry.kind === 'video' || entry.kind === 'audio' ? Play : Braces,
              disabled: !canOpen(entry),
              onSelect: () => openEntry(entry),
            },
            ...(entry.kind !== 'folder' ? [{ label: tr('Open With'), icon: AppWindow, submenu: openWith(entry) }] : []),
            { label: tr('Get Info'), icon: Info, onSelect: () => onGetInfo(pathOf(entry)) },
            ...(virtual ? [{ label: tr('Show in Enclosing Folder'), icon: FolderOpen, onSelect: () => showInFolder(entry) }] : []),
            { label: tr('Share Link…'), icon: Link2, onSelect: () => setShareFor({ path: pathOf(entry), name: entry.name, upload: false }) },
            ...(isFolder
              ? [
                  { label: tr('Request Files…'), icon: Inbox, onSelect: () => setShareFor({ path: pathOf(entry), name: entry.name, upload: true }) },
                  { label: tr('Open in Code'), icon: Braces, onSelect: () => onOpenFolder(pathOf(entry)) },
                  { label: tr('Share Folder…'), icon: Share2, onSelect: () => onShareFolder(pathOf(entry)) },
                ]
              : []),
            ...(entry.kind === 'image'
              ? [
                  {
                    label: tr('Set as Wallpaper'),
                    icon: Image,
                    onSelect: async () => update({ customWallpaper: (await api.wallpaperFromFile(pathOf(entry))).url }),
                  },
                ]
              : []),
            'separator',
          ] as MenuItem[])),
      {
        label: many ? tr('Cut {0} Items', items.length) : tr('Cut'),
        icon: Scissors,
        onSelect: () => setFileClipboard({ paths: items.map(i => pathOf(i)), cut: true }),
      },
      {
        label: many ? tr('Copy {0} Items', items.length) : tr('Copy'),
        icon: Copy,
        onSelect: () => setFileClipboard({ paths: items.map(i => pathOf(i)), cut: false }),
      },
      ...(isFolder && clip
        ? [{ label: tr('{0} Into Folder', pasteLabel), icon: ClipboardPaste, onSelect: () => void paste(pathOf(entry)) }]
        : []),
      ...(virtual ? [] : [{ label: tr('Duplicate'), icon: CopyPlus, onSelect: () => void duplicate() }]),
      'separator',
      ...(many || virtual ? [] : [{ label: tr('Rename'), icon: Pencil, onSelect: () => setRenaming(entry.name) }]),
      { label: tr('Copy Path'), icon: Copy, onSelect: () => void copyText(items.map(i => pathOf(i)).join('\n')) },
      { label: tr('Tags'), icon: Tag, submenu: tagItems(items) },
      'separator',
      { label: trashLabel(items.length), icon: Trash2, onSelect: () => void remove(items) },
      {
        label: deleteNowLabel(items.length),
        confirm: tr('Click Again to Delete'),
        icon: Trash2,
        danger: true,
        onSelect: () => void remove(items, true),
      },
    ])
  }

  const backgroundMenu = (e: MouseEvent) => {
    if (e.defaultPrevented) return
    select([])
    if (virtual) {
      return show(e, [
        ...(virtual === 'trash'
          ? ([
              { label: tr('Empty Trash'), confirm: tr('Click Again to Empty'), icon: Trash2, danger: true, disabled: !entries.length, onSelect: () => void emptyTrash() },
              'separator',
            ] as MenuItem[])
          : []),
        ...viewItems(),
        'separator',
        { label: tr('Refresh'), icon: RotateCw, onSelect: refresh },
      ])
    }
    show(e, [
      { label: tr('New Folder'), icon: FolderPlus, onSelect: () => void newFolder() },
      ...uploadItems,
      'separator',
      { label: pasteLabel, icon: ClipboardPaste, disabled: !clip, onSelect: () => void paste() },
      'separator',
      ...viewItems(),
      'separator',
      { label: tr('Share Link…'), icon: Link2, onSelect: () => setShareFor({ path, name: displayName(path), upload: false }) },
      { label: tr('Request Files…'), icon: Inbox, onSelect: () => setShareFor({ path, name: displayName(path), upload: true }) },
      'separator',
      { label: tr('Open Folder in Code'), icon: Braces, onSelect: () => onOpenFolder(path) },
      { label: tr('Get Info'), icon: Info, onSelect: () => onGetInfo(path) },
      { label: tr('Copy Path'), icon: Copy, onSelect: () => void copyText(path) },
      { label: tr('Refresh'), icon: RotateCw, onSelect: refresh },
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
    { label: tr('Ascending'), checked: !sort.desc, onSelect: () => update({ filesSort: { ...sort, desc: false } }) },
    { label: tr('Descending'), checked: sort.desc, onSelect: () => update({ filesSort: { ...sort, desc: true } }) },
  ]

  useAppMenus(() => [
    {
      label: tr('File'),
      items: [
        { label: tr('New Folder'), icon: FolderPlus, disabled: !!virtual, onSelect: () => void newFolder() },
        ...uploadItems.map(i => (i === 'separator' ? i : { ...i, disabled: !!virtual })),
        'separator',
        {
          label: single ? openLabel(single) : tr('Open'),
          icon: FolderOpen,
          disabled: !single || !canOpen(single),
          onSelect: () => single && openEntry(single),
        },
        { label: tr('Get Info'), icon: Info, disabled: !!virtual && !single, onSelect: () => onGetInfo(single ? pathOf(single) : path) },
        { label: tr('Rename'), icon: Pencil, disabled: !single || !!virtual, onSelect: () => single && setRenaming(single.name) },
        ...(virtual === 'trash'
          ? ([
              { label: tr('Put Back'), icon: Undo2, disabled: !selectedEntries.length, onSelect: () => void putBack(selectedEntries) },
              { label: tr('Empty Trash'), confirm: tr('Click Again to Empty'), icon: Trash2, danger: true, disabled: !entries.length, onSelect: () => void emptyTrash() },
            ] as MenuItem[])
          : ([
              { label: trashLabel(selectedEntries.length), icon: Trash2, disabled: !selectedEntries.length, onSelect: () => void remove(selectedEntries) },
              { label: tr('Tags'), icon: Tag, disabled: !selectedEntries.length, submenu: tagItems(selectedEntries) },
            ] as MenuItem[])),
        {
          label: deleteNowLabel(selectedEntries.length),
          confirm: tr('Click Again to Delete'),
          icon: Trash2,
          danger: true,
          disabled: !selectedEntries.length,
          onSelect: () => void remove(selectedEntries, true),
        },
        'separator',
        {
          label: tr('Copy Path'),
          icon: Copy,
          onSelect: () => void copyText(selectedEntries.length ? selectedEntries.map(e => pathOf(e)).join('\n') : path),
        },
      ],
    },
    {
      label: tr('Edit'),
      items: [
        ...editItems(),
        'separator',
        { label: tr('Select All'), icon: SquareCheck, shortcut: `${MOD}A`, onSelect: () => select(sorted.map(keyOf)) },
      ],
    },
    {
      label: tr('View'),
      items: [
        ...viewItems(),
        'separator',
        ...sortItems(),
        'separator',
        { label: tr('Bigger Icons'), disabled: view !== 'icons', onSelect: () => setIconSize(iconSize + 16) },
        { label: tr('Smaller Icons'), disabled: view !== 'icons', onSelect: () => setIconSize(iconSize - 16) },
        'separator',
        { label: tr('Refresh'), icon: RotateCw, onSelect: refresh },
      ],
    },
    {
      label: tr('Go'),
      items: [
        { label: tr('Back'), icon: ChevronLeft, disabled: index === 0, onSelect: () => step(-1) },
        { label: tr('Forward'), icon: ChevronRight, disabled: index === history.length - 1, onSelect: () => step(1) },
        {
          label: tr('Enclosing Folder'),
          icon: FolderOpen,
          disabled: path === root,
          onSelect: () => navigate(parentOf(path)),
        },
        'separator',
        { label: tr('Recents'), icon: Clock, checked: path === RECENTS_PLACE, onSelect: () => navigate(RECENTS_PLACE) },
        ...[...locations, ...favorites].map(place => ({
          label: place.label,
          icon: place.icon,
          checked: place.path === path,
          onSelect: () => navigate(place.path),
        })),
        { label: tr('Trash'), icon: Trash2, checked: path === TRASH_PLACE, onSelect: () => navigate(TRASH_PLACE) },
      ],
    },
  ])

  // ----- Selection with mouse and keyboard -----
  const clickEntry = (e: MouseEvent, entry: FileEntry) => {
    if (e.shiftKey && anchor) {
      const names = sorted.map(keyOf)
      const [a, b] = [names.indexOf(anchor), names.indexOf(keyOf(entry))].sort((x, y) => x - y)
      setSelected(new Set(names.slice(a, b + 1)))
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(keyOf(entry))) next.delete(keyOf(entry))
      else next.add(keyOf(entry))
      setSelected(next)
      setAnchor(keyOf(entry))
    } else {
      select([keyOf(entry)])
    }
  }

  // How many tiles fit in a row of the icon grid, for Up/Down.
  const columns = () => {
    const grid = scroller.current?.querySelector('.file-grid')
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1
  }

  const onKey = (e: KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).closest('input, textarea')) return
    const names = sorted.map(keyOf)
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
      case 'Backspace':
        if (selectedEntries.length && (e.key === 'Delete' || e.metaKey || e.ctrlKey)) void remove(selectedEntries)
        break
      case 'Escape':
        select([])
        break
    }
  }

  // Everything a tile, row or filmstrip cell does, in any view.
  const entryProps = (entry: FileEntry) => ({
    'data-name': keyOf(entry),
    role: 'option',
    'aria-selected': selected.has(keyOf(entry)),
    title: entry.name,
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      // A finger opens with one tap, as phones do; choosing several is in the long-press menu.
      if (SHELL === 'mobile' && !e.shiftKey && !e.metaKey && !e.ctrlKey && selected.size <= 1) {
        select([keyOf(entry)])
        openEntry(entry)
        return
      }
      clickEntry(e, entry)
    },
    onDoubleClick: () => openEntry(entry),
    onContextMenu: (e: MouseEvent) => entryMenu(e, entry),
    // Dropping onto a folder copies into that folder instead.
    ...(entry.kind === 'folder' && !virtual
      ? {
          onDragOver: (e: DragEvent) => {
            if (!isFileDrag(e)) return
            e.preventDefault()
            e.stopPropagation()
            setDropTarget(entry.name)
          },
          onDragLeave: () => setDropTarget(''),
          onDrop: (e: DragEvent) => isFileDrag(e) && dropInto(e, pathOf(entry)),
        }
      : {}),
  })
  const stateClass = (entry: FileEntry) =>
    `${selected.has(keyOf(entry)) ? 'is-selected' : ''} ${dropTarget === entry.name ? 'is-drop' : ''} ${isCut(entry) ? 'is-cut' : ''}`

  const icon = (entry: FileEntry, box: number) => {
    const Icon = KIND_ICON[entry.kind]
    const color = KIND_COLOR[entry.kind]
    return (
      <FileThumb key={pathOf(entry)} entry={entry} path={pathOf(entry)} box={box}>
        <Icon size={Math.round(box * 0.72)} strokeWidth={box > 40 ? 1.2 : 1.6} color={color} fill={color} fillOpacity={0.16} />
      </FileThumb>
    )
  }
  const label = (entry: FileEntry) =>
    renaming === entry.name ? (
      <RenameField name={entry.name} onDone={value => void finishRename(entry.name, value)} />
    ) : (
      <span className="file-name">
        {entry.name}
        {!!tags[pathOf(entry)]?.length && (
          <span className="file-tags" aria-label={tags[pathOf(entry)].join(', ')}>
            {tags[pathOf(entry)].map(t => (
              <i key={t} style={{ background: TAG_COLOR[t] }} />
            ))}
          </span>
        )}
      </span>
    )

  const placeButton = ({ path: p, label: text, icon: Icon }: Place) => (
    <button
      key={p}
      className={`sidebar-item ${p === path ? 'is-active' : ''}`}
      onClick={() => navigate(p)}
      title={p}
      onContextMenu={e =>
        show(
          e,
          p === TRASH_PLACE
            ? [
                { label: tr('Open'), icon: FolderOpen, onSelect: () => navigate(p) },
                { label: tr('Empty Trash'), confirm: tr('Click Again to Empty'), icon: Trash2, danger: true, onSelect: () => void emptyTrash() },
              ]
            : virtualOf(p)
              ? [{ label: tr('Open'), icon: FolderOpen, onSelect: () => navigate(p) }]
              : [
                  { label: tr('Open'), icon: FolderOpen, onSelect: () => navigate(p) },
                  { label: tr('Open in Code'), icon: Braces, onSelect: () => onOpenFolder(p) },
                  { label: tr('Copy Path'), icon: Copy, onSelect: () => void copyText(p) },
                ],
        )
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
    if (view === 'gallery' && selected.size === 0 && sorted.length > 0) select([keyOf(sorted[0])])
  }, [view, sorted.length, selected.size])

  const content = () => {
    if (view === 'list') {
      return (
        <div className="file-list" role="listbox" aria-multiselectable>
          <div className="file-list-head">
            {listHeader('name', 'Name')}
            {listHeader('modified', virtual === 'trash' ? tr('Date Deleted') : virtual === 'recents' ? tr('Date Opened') : tr('Date Modified'))}
            {listHeader('size', 'Size', 'is-num')}
            {listHeader('kind', 'Kind')}
          </div>
          {sorted.map(entry => (
            <div key={keyOf(entry)} className={`file-row ${stateClass(entry)}`} {...entryProps(entry)}>
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
          <GalleryPreview entry={galleryItem} path={galleryItem ? pathOf(galleryItem) : ''} kind={galleryItem ? kindLabel(galleryItem) : ''} />
          <div className="file-strip" role="listbox">
            {sorted.map(entry => (
              <div key={keyOf(entry)} className={`file-strip-item ${stateClass(entry)}`} {...entryProps(entry)}>
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
          <div key={keyOf(entry)} className={`file ${stateClass(entry)}`} {...entryProps(entry)}>
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
        <div className="sidebar-group">{tr('Favorites')}</div>
        {placeButton({ path: RECENTS_PLACE, label: tr('Recents'), icon: Clock })}
        {favorites.map(placeButton)}
        <div className="sidebar-group">{tr('Locations')}</div>
        {locations.map(placeButton)}
        {placeButton({ path: TRASH_PLACE, label: tr('Trash'), icon: Trash2 })}
        <div className="sidebar-group">{tr('Tags')}</div>
        {TAGS.map(t => (
          <button key={t.id} className={`sidebar-item ${path === TAG_PREFIX + t.id ? 'is-active' : ''}`} onClick={() => navigate(TAG_PREFIX + t.id)}>
            <i className="sidebar-tag" style={{ background: t.color }} /> {t.label}
          </button>
        ))}
      </aside>

      <div
        className="files-main"
        onDragOver={e => {
          if (!isFileDrag(e) || virtual) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (dropTarget === null) setDropTarget('')
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
        }}
        onDrop={e => isFileDrag(e) && !virtual && dropInto(e, path)}
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
            <strong>{tr('Drop to copy into')} {displayName(path)}</strong>
          </div>
        )}
        <UploadsPanel jobs={uploads.jobs} busy={uploads.busy} onCancel={uploads.cancelAll} onClear={uploads.clear} />

        <WindowToolbar>
          <div className="tb-group files-nav">
            <button className="tb-btn" onClick={() => step(-1)} disabled={index === 0} aria-label={tr('Back')} title={tr('Back')}>
              <ChevronLeft size={18} />
            </button>
            <button
              className="tb-btn"
              onClick={() => step(1)}
              disabled={index === history.length - 1}
              aria-label={tr('Forward')}
              title={tr('Forward')}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <ToolbarTitle title={placeTitle(path)} />
          <span className="tb-spacer" />
          <div className="tb-segmented tb-icons" role="radiogroup" aria-label={tr('View')}>
            {VIEWS.map(v => (
              <button
                key={v.id}
                className={view === v.id ? 'is-active' : ''}
                onClick={() => setView(v.id)}
                aria-label={tr('View {0}', v.label)}
                title={tr('View {0}', v.label)}
              >
                <v.icon size={15} />
              </button>
            ))}
          </div>
          {virtual === 'trash' && (
            <button
              className={`tb-btn tb-text ${confirmEmpty ? 'is-danger' : ''}`}
              disabled={!entries.length}
              onClick={() => {
                if (!confirmEmpty) return setConfirmEmpty(true)
                setConfirmEmpty(false)
                void emptyTrash()
              }}
              onBlur={() => setConfirmEmpty(false)}
            >
              {confirmEmpty ? tr('Empty Trash?') : tr('Empty')}
            </button>
          )}
          <div className="tb-group">
            <button
              className="tb-btn"
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect()
                show({ x: r.left, y: r.bottom + 6 }, sortItems())
              }}
              aria-label={tr('Sort by')}
              title={tr('Sort By')}
            >
              <ArrowUpDown size={15} />
            </button>
            {!virtual && (
              <>
                <button
                  className="tb-btn"
                  onClick={e => {
                    const r = e.currentTarget.getBoundingClientRect()
                    show({ x: r.left, y: r.bottom + 6 }, uploadItems)
                  }}
                  aria-label={tr('Upload')}
                  title={tr('Upload files or a folder')}
                >
                  <Upload size={16} />
                </button>
                <button className="tb-btn" onClick={() => void newFolder()} aria-label={tr('New folder')} title={tr('New Folder')}>
                  <FolderPlus size={17} />
                </button>
              </>
            )}
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
          {loading ? (
            <p className="empty files-empty files-loading">{tr('Loading…')}</p>
          ) : loadError ? (
            <p className="empty files-empty files-error">{tr('Can’t open this folder:')} {loadError}</p>
          ) : (
            entries.length === 0 && (
              <p className="empty files-empty">
                {virtual === 'trash'
                  ? tr('The Trash is empty.')
                  : virtual === 'recents'
                    ? tr('Files you open show up here.')
                    : virtual === 'tag'
                      ? tr('Nothing has this tag yet. Right-click a file → Tags.')
                      : tr('This folder is empty.')}
              </p>
            )
          )}
        </div>

        {/* Path bar (View → Show Path Bar). */}
        <div className="files-crumbs">
          {(virtual ? [] : ancestors(path))
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
        {shareFor && <ShareLinkSheet {...shareFor} onClose={() => setShareFor(null)} />}
        <div className="statusbar">
          <span>
            {working ??
              (virtual === 'trash' && selectedEntries.length <= 1
                ? single
                  ? tr('From {0}', trashItems.find(t => TRASH_PLACE + t.id === single.path)?.from ?? '')
                  : tr('Items in the Trash are deleted after 30 days.')
                : selectedEntries.length > 1
                ? tr('{0} of {1} selected{2}', selectedEntries.length, entries.length, totalSize ? ` · ${formatBytes(totalSize)}` : '')
                : tr('{0} items', entries.length))}
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
              aria-label={tr('Icon size')}
              title={tr('Icon size')}
            />
          ) : (
            <span>
              {single
                ? `${single.name}${single.size ? ` · ${formatBytes(single.size)}` : ''} · ${formatFileDate(single.modified)}`
                : clip
                  ? tr('{0} item{1} {2} · {3}V to paste', clip.paths.length, clip.paths.length > 1 ? 's' : '', clip.cut ? tr('to move') : tr('copied'), MOD)
                  : tr('Right-click for more options')}
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
  const media = (entry.kind === 'image' || entry.kind === 'video') && !path.startsWith(TRASH_PLACE)
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
