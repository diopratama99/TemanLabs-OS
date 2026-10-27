import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AtSign,
  Blocks,
  ChevronRight,
  ClipboardPaste,
  Command,
  Copy,
  Ellipsis,
  Eye,
  FileInput,
  FilePlus,
  FileSearch,
  Files as FilesIcon,
  FolderOpen,
  FolderX,
  Hash,
  Map as MapIcon,
  PanelBottom,
  PanelBottomDashed,
  PanelLeft,
  PanelLeftDashed,
  PanelRight,
  PanelRightDashed,
  Redo2,
  Replace,
  Save,
  Scissors,
  Search,
  Server,
  SquareTerminal,
  TextCursorInput,
  Undo2,
  Upload,
  WandSparkles,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { SystemStats } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import type { MenuItem } from '../components/ContextMenu'
import { useAppMenus } from '../lib/appMenus'
import { Explorer } from '../components/code/Explorer'
import { FileTypeIcon } from '../components/code/FileTypeIcon'
import { OpenDialog } from '../components/code/OpenDialog'
import { QuickOpen } from '../components/code/QuickOpen'
import { SearchPanel } from '../components/code/SearchPanel'
import { ExtensionsPanel } from '../components/code/ExtensionsPanel'
import { DEFAULT_EXTENSIONS, markdownPage, prettierSupports, type ExtensionSettings } from '../components/code/editorExtensions'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { languageFor } from '../lib/fileTypes'
import { joinPath, nameOf, parentOf } from '../lib/paths'
import { DATA_ROOT } from '../lib/places'
import { ALT, MOD, SHIFT } from '../lib/platform'
import { useSettings } from '../lib/settings'
import { CODE_APP } from '../lib/systemApps'
import { Terminal } from './Terminal'
import { tr } from '../lib/i18n'
import { SHELL } from '../lib/shell'
import { WindowToolbar } from '../lib/windowChrome'

const MonacoView = lazy(() => import('../components/code/MonacoView'))

const ROOT = DATA_ROOT
const MAX_RECENT = 6
const MAX_HISTORY = 50
const NOTICE_MS = 3500
const SUGGESTED = [
  '/DATA/Projects/README.md',
  '/DATA/Projects/temanlabs-site/app.js',
  '/DATA/AppData/jellyfin/docker-compose.yml',
]

interface Tab {
  path: string
  /** Text as last read from or written to the server. */
  saved: string
  /** Current text in the editor. */
  value: string
}

type Panel = 'explorer' | 'search' | 'extensions'
type CloseChoice = 'save' | 'discard' | 'cancel'

// Lives outside the component so closing the window keeps open tabs and unsaved edits.
const session = {
  tabs: [] as Tab[],
  active: null as string | null,
  /** Workspace folder shown in the Explorer; null after Close Folder. */
  root: ROOT as string | null,
  // On a phone the Explorer would cover the file; it opens from the activity bar.
  panel: (SHELL === 'mobile' ? null : 'explorer') as Panel | null,
  lastPanel: 'explorer' as Panel,
  terminal: false,
  expanded: new Set([ROOT]) as Set<string>,
  recent: [] as string[],
  recentFolders: [] as string[],
  wordWrap: false,
  minimap: true,
}

export interface OpenRequest {
  path: string
  /** A folder becomes the workspace; a file opens in a tab. */
  kind: 'file' | 'folder'
  nonce: number
}

// Shared helpers handle "/" (a file at /x has dir "/", not "").
const dirOf = parentOf
const isDirty = (tab: Tab) => tab.value !== tab.saved

interface Props {
  stats: SystemStats | null
  /** Set from outside (e.g. Files) to open a file or folder; a new nonce re-triggers the same path. */
  request: OpenRequest | null
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

// The layout and extensions are remembered in this browser, like VS Code's own.
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null
      ? fallback
      : ({
          ...(typeof fallback === 'object' ? fallback : {}),
          ...JSON.parse(raw),
        } as T)
  } catch {
    return fallback
  }
}
function readNumber(key: string, fallback: number) {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // Not remembered; fine.
  }
}

const SIDEBAR_WIDTH = 248
const SIDEBAR_MIN = 170
const SIDEBAR_MAX = 560
// Dragged narrower than this, the sidebar closes (it opens again from the activity bar).
const SIDEBAR_SNAP = 110
const TERMINAL_HEIGHT = 230
const TERMINAL_MIN = 90

/** A drag on a sash (the thin handle between two areas); onMove gets how far it went. */
function dragSash(e: ReactPointerEvent, onMove: (dx: number, dy: number) => void, onEnd?: () => void) {
  if (e.button !== 0) return
  e.preventDefault()
  const x = e.clientX
  const y = e.clientY
  document.body.classList.add('is-sash-dragging')
  const move = (ev: PointerEvent) => onMove(ev.clientX - x, ev.clientY - y)
  const up = () => {
    document.body.classList.remove('is-sash-dragging')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onEnd?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

export function CodeEditor({ stats, request }: Props) {
  const { settings } = useSettings()
  const { show } = useContextMenu()
  const [tabs, setTabs] = useState(session.tabs)
  const [active, setActive] = useState(session.active)
  const [panel, setPanel] = useState(session.panel)
  const [terminal, setTerminal] = useState(session.terminal)
  const [expanded, setExpanded] = useState(session.expanded)
  const [recent, setRecent] = useState(session.recent)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [closing, setClosing] = useState<string[] | null>(null)
  const [revealTick, setRevealTick] = useState(0)
  const [wordWrap, setWordWrap] = useState(session.wordWrap)
  const [minimap, setMinimap] = useState(session.minimap)
  /** Bumped when files change outside the Explorer (e.g. File → New File) so it reloads. */
  const [treeVersion, setTreeVersion] = useState(0)
  const [root, setRoot] = useState(session.root)
  const [recentFolders, setRecentFolders] = useState(session.recentFolders)
  const [dialog, setDialog] = useState<'file' | 'folder' | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef(0)
  const [extensions, setExtensionsState] = useState<ExtensionSettings>(() => readStored('code.extensions', DEFAULT_EXTENSIONS))
  const setExtensions = (next: ExtensionSettings) => {
    setExtensionsState(next)
    store('code.extensions', next)
  }
  const [sidebarWidth, setSidebarWidth] = useState(() => readNumber('code.sidebarWidth', SIDEBAR_WIDTH))
  const [terminalHeight, setTerminalHeight] = useState(() => readNumber('code.terminalHeight', TERMINAL_HEIGHT))
  const [preview, setPreview] = useState(false)
  const [previewPage, setPreviewPage] = useState('')
  // The open file's indentation and line endings, as the editor has them.
  const [format, setFormat] = useState({
    tabSize: 2,
    insertSpaces: true,
    eol: 'LF',
  })
  const [dragTab, setDragTab] = useState<string | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  const uploadInput = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const pendingReveal = useRef<{ line: number; column: number } | null>(null)
  // Callbacks registered with Monaco outlive a render, so they read state through this ref.
  const latest = useRef({ tabs, active, extensions })
  latest.current = { tabs, active, extensions }

  useEffect(() => {
    Object.assign(session, {
      tabs,
      active,
      root,
      panel,
      terminal,
      expanded,
      recent,
      recentFolders,
      wordWrap,
      minimap,
    })
    if (panel) session.lastPanel = panel
  }, [tabs, active, root, panel, terminal, expanded, recent, recentFolders, wordWrap, minimap])

  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  /** Brief message in the status bar, e.g. after an upload. */
  const flash = (message: string) => {
    clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }

  // Dispose the Monaco models of closed tabs, so reopening a file reads it fresh.
  const openPaths = useRef(tabs.map(t => t.path))
  useEffect(() => {
    const current = new Set(tabs.map(t => t.path))
    const monaco = monacoRef.current
    for (const path of openPaths.current) {
      if (!current.has(path)) monaco?.editor.getModel(monaco.Uri.parse(path))?.dispose()
    }
    openPaths.current = [...current]
    if (current.size === 0) editorRef.current = null
  }, [tabs])

  const openFile = useCallback(async (path: string, at?: { line: number; column: number }) => {
    if (!languageFor(nameOf(path))) return
    pendingReveal.current = at ?? null
    if (!latest.current.tabs.some(t => t.path === path)) {
      const text = await api.readFile(path)
      setTabs(ts => (ts.some(t => t.path === path) ? ts : [...ts, { path, saved: text, value: text }]))
    }
    setActive(path)
    setRecent(r => [path, ...r.filter(p => p !== path)].slice(0, MAX_RECENT))
    setRevealTick(t => t + 1)
  }, [])

  // Back and Forward step through the files shown, as VS Code's do (reopening a closed one).
  const nav = useRef({ list: [] as string[], at: -1 })
  const [, setNavTick] = useState(0)
  useEffect(() => {
    const n = nav.current
    if (!active || n.list[n.at] === active) return
    n.list = [...n.list.slice(0, n.at + 1), active].slice(-MAX_HISTORY)
    n.at = n.list.length - 1
    setNavTick(t => t + 1)
  }, [active])
  const canBack = nav.current.at > 0
  const canForward = nav.current.at < nav.current.list.length - 1
  const step = (by: number) => {
    const n = nav.current
    const path = n.list[n.at + by]
    if (!path) return
    n.at += by
    setNavTick(t => t + 1)
    openFile(path).catch(() => flash(tr('{0} is no longer there', nameOf(path))))
  }

  const openFolder = useCallback((path: string) => {
    setRoot(path)
    setExpanded(new Set([path]))
    setPanel('explorer')
    setRecentFolders(r => [path, ...r.filter(p => p !== path)].slice(0, MAX_RECENT))
  }, [])

  const closeFolder = () => setRoot(null)

  useEffect(() => {
    if (!request) return
    if (request.kind === 'folder') openFolder(request.path)
    else void openFile(request.path)
  }, [request, openFile, openFolder])

  /** Uploads files from the user's computer into `dir` and opens the text ones. */
  const uploadFiles = async (dir: string, picked: File[]) => {
    const names: string[] = []
    for (const file of picked) names.push(await api.uploadFile(dir, file))
    setExpanded(e => new Set(e).add(dir))
    setTreeVersion(v => v + 1)
    const openable = names.filter(name => languageFor(name))
    for (const name of openable) await openFile(joinPath(dir, name))
    flash(`Uploaded ${names.length} file${names.length === 1 ? '' : 's'} to ${dir}`)
  }

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragging(false)
    void uploadFiles(root ?? ROOT, [...e.dataTransfer.files])
  }

  const applyReveal = () => {
    const editor = editorRef.current
    const at = pendingReveal.current
    if (!editor || !at) return
    pendingReveal.current = null
    editor.revealLineInCenter(at.line)
    editor.setPosition({ lineNumber: at.line, column: at.column })
    editor.focus()
  }
  useEffect(() => applyReveal(), [active, revealTick])

  const save = useCallback(async (path?: string) => {
    const { tabs, active, extensions } = latest.current
    let tab = tabs.find(t => t.path === (path ?? active))
    if (!tab || !isDirty(tab)) return
    // Format on Save: through the open editor (so it can be undone), for the file in front.
    const editor = editorRef.current
    const model = editor?.getModel()
    if (
      extensions.prettier &&
      extensions.formatOnSave &&
      editor &&
      model &&
      model.uri.path === tab.path &&
      prettierSupports(model.getLanguageId(), tab.path)
    ) {
      try {
        await editor.getAction('editor.action.formatDocument')?.run()
        const formatted = model.getValue()
        tab = { ...tab, value: formatted }
        setTabs(ts => ts.map(t => (t.path === tab!.path ? { ...t, value: formatted } : t)))
      } catch {
        // A file Prettier can't parse is saved as it is.
      }
    }
    const { value } = tab
    await api.writeFile(tab.path, value)
    setTabs(ts => ts.map(t => (t.path === tab.path ? { ...t, saved: value } : t)))
  }, [])

  const closeTabs = (paths: string[]) => {
    const { tabs, active } = latest.current
    if (active && paths.includes(active)) {
      const remaining = tabs.filter(t => !paths.includes(t.path))
      const index = tabs.findIndex(t => t.path === active)
      setActive(remaining[Math.min(index, remaining.length - 1)]?.path ?? null)
    }
    setTabs(ts => ts.filter(t => !paths.includes(t.path)))
  }

  /** Closes tabs, asking first when any of them has unsaved changes. */
  const requestClose = (paths: string[]) => {
    if (latest.current.tabs.some(t => paths.includes(t.path) && isDirty(t))) setClosing(paths)
    else closeTabs(paths)
  }

  const resolveClose = async (choice: CloseChoice) => {
    const paths = closing
    setClosing(null)
    if (!paths || choice === 'cancel') return
    if (choice === 'save') for (const path of paths) await save(path)
    closeTabs(paths)
  }

  const saveAll = async () => {
    for (const tab of latest.current.tabs.filter(isDirty)) await save(tab.path)
  }

  /** Creates an untitled file next to the active one (or in the workspace) and opens it. */
  const newFile = async () => {
    const dir = active ? dirOf(active) : (root ?? ROOT)
    const name = await api.createFile(dir)
    setExpanded(e => new Set(e).add(dir))
    setTreeVersion(v => v + 1)
    await openFile(joinPath(dir, name))
  }

  /** Runs a Monaco action (or a core command such as undo) on the open editor. */
  const runEditor = (id: string) => () => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const action = editor.getAction(id)
    if (action) void action.run()
    else editor.trigger('menubar', id, null)
  }

  const togglePanel = (p: Panel) => setPanel(current => (current === p ? null : p))
  const toggleSidebar = () => setPanel(current => (current ? null : session.lastPanel))

  /** Shows a folder in the Explorer, with the folders down to it opened. */
  const revealFolder = (dir: string) => {
    if (!root || (dir !== root && !dir.startsWith(`${root}/`))) return
    setExpanded(e => {
      const next = new Set(e)
      for (let p = dir; ; p = parentOf(p)) {
        next.add(p)
        if (p === root || p.length <= root.length) break
      }
      return next
    })
    setPanel('explorer')
  }

  useAppMenus(() => {
    const noEditor = !activeTab
    const editorItem = (label: string, id: string, extra: Partial<Extract<MenuItem, object>> = {}): MenuItem => ({
      label,
      disabled: noEditor,
      onSelect: runEditor(id),
      ...extra,
    })
    return [
      {
        label: tr('File'),
        items: [
          {
            label: tr('New File'),
            icon: FilePlus,
            onSelect: () => void newFile(),
          },
          'separator',
          {
            label: tr('Open File…'),
            icon: FileInput,
            shortcut: `${MOD}O`,
            onSelect: () => setDialog('file'),
          },
          {
            label: tr('Open Folder…'),
            icon: FolderOpen,
            onSelect: () => setDialog('folder'),
          },
          {
            label: tr('Go to File…'),
            icon: FileSearch,
            shortcut: `${MOD}P`,
            onSelect: () => setQuickOpen(true),
          },
          {
            label: tr('Upload from Computer…'),
            icon: Upload,
            onSelect: () => uploadInput.current?.click(),
          },
          'separator',
          {
            label: tr('Save'),
            icon: Save,
            shortcut: `${MOD}S`,
            disabled: !activeTab || !isDirty(activeTab),
            onSelect: () => void save(),
          },
          {
            label: tr('Save All'),
            disabled: dirtyCount === 0,
            onSelect: () => void saveAll(),
          },
          'separator',
          {
            label: tr('Close Editor'),
            icon: X,
            disabled: noEditor,
            onSelect: () => active && requestClose([active]),
          },
          {
            label: tr('Close All Editors'),
            disabled: tabs.length === 0,
            onSelect: () => requestClose(tabs.map(t => t.path)),
          },
          {
            label: tr('Close Folder'),
            icon: FolderX,
            disabled: !root,
            onSelect: closeFolder,
          },
        ],
      },
      {
        label: tr('Edit'),
        items: [
          editorItem('Undo', 'undo', { icon: Undo2, shortcut: `${MOD}Z` }),
          editorItem('Redo', 'redo', {
            icon: Redo2,
            shortcut: `${MOD}${SHIFT}Z`,
          }),
          'separator',
          editorItem('Cut', 'editor.action.clipboardCutAction', {
            icon: Scissors,
            shortcut: `${MOD}X`,
          }),
          editorItem('Copy', 'editor.action.clipboardCopyAction', {
            icon: Copy,
            shortcut: `${MOD}C`,
          }),
          editorItem('Paste', 'editor.action.clipboardPasteAction', {
            icon: ClipboardPaste,
            shortcut: `${MOD}V`,
            disabled: noEditor || !navigator.clipboard?.readText,
          }),
          'separator',
          editorItem('Find', 'actions.find', {
            icon: Search,
            shortcut: `${MOD}F`,
          }),
          editorItem('Replace', 'editor.action.startFindReplaceAction', {
            icon: Replace,
            shortcut: `${MOD}H`,
          }),
          {
            label: tr('Find in Files'),
            icon: FileSearch,
            shortcut: `${MOD}${SHIFT}F`,
            onSelect: () => setPanel('search'),
          },
          'separator',
          editorItem('Toggle Line Comment', 'editor.action.commentLine', {
            icon: Hash,
            shortcut: `${MOD}/`,
          }),
          editorItem('Format Document', 'editor.action.formatDocument', {
            icon: WandSparkles,
            shortcut: `${SHIFT}${ALT}F`,
          }),
        ],
      },
      {
        label: tr('Selection'),
        items: [
          editorItem('Select All', 'editor.action.selectAll', {
            shortcut: `${MOD}A`,
          }),
          editorItem('Expand Selection', 'editor.action.smartSelect.expand', {
            shortcut: `${SHIFT}${ALT}→`,
          }),
          editorItem('Shrink Selection', 'editor.action.smartSelect.shrink', {
            shortcut: `${SHIFT}${ALT}←`,
          }),
          'separator',
          editorItem('Add Cursor Above', 'editor.action.insertCursorAbove'),
          editorItem('Add Cursor Below', 'editor.action.insertCursorBelow'),
          editorItem('Add Next Occurrence', 'editor.action.addSelectionToNextFindMatch', { shortcut: `${MOD}D` }),
          editorItem('Select All Occurrences', 'editor.action.selectHighlights', { shortcut: `${MOD}${SHIFT}L` }),
        ],
      },
      {
        label: tr('View'),
        items: [
          editorItem('Command Palette…', 'editor.action.quickCommand', {
            icon: Command,
            shortcut: `${MOD}${SHIFT}P`,
          }),
          'separator',
          {
            label: tr('Explorer'),
            icon: FilesIcon,
            shortcut: `${MOD}B`,
            checked: panel === 'explorer',
            onSelect: () => togglePanel('explorer'),
          },
          {
            label: tr('Search'),
            icon: Search,
            checked: panel === 'search',
            onSelect: () => togglePanel('search'),
          },
          {
            label: tr('Extensions'),
            icon: Blocks,
            checked: panel === 'extensions',
            onSelect: () => togglePanel('extensions'),
          },
          {
            label: tr('Terminal'),
            icon: SquareTerminal,
            shortcut: `${MOD}\``,
            checked: terminal,
            onSelect: () => setTerminal(t => !t),
          },
          'separator',
          {
            label: tr('Word Wrap'),
            icon: WrapText,
            checked: wordWrap,
            onSelect: () => setWordWrap(w => !w),
          },
          {
            label: tr('Minimap'),
            icon: MapIcon,
            checked: minimap,
            onSelect: () => setMinimap(m => !m),
          },
          {
            label: tr('Preview'),
            icon: Eye,
            checked: preview,
            disabled: !canPreview,
            onSelect: () => setPreview(p => !p),
          },
          'separator',
          editorItem('Zoom In', 'editor.action.fontZoomIn', {
            icon: ZoomIn,
            shortcut: `${MOD}+`,
          }),
          editorItem('Zoom Out', 'editor.action.fontZoomOut', {
            icon: ZoomOut,
            shortcut: `${MOD}-`,
          }),
          editorItem('Reset Zoom', 'editor.action.fontZoomReset'),
        ],
      },
      {
        label: tr('Go'),
        items: [
          {
            label: tr('Go to File…'),
            icon: FileSearch,
            shortcut: `${MOD}P`,
            onSelect: () => setQuickOpen(true),
          },
          editorItem('Go to Line…', 'editor.action.gotoLine', {
            icon: ArrowDownToLine,
          }),
          editorItem('Go to Symbol…', 'editor.action.quickOutline', {
            icon: AtSign,
          }),
          editorItem('Go to Definition', 'editor.action.revealDefinition', {
            shortcut: 'F12',
          }),
          editorItem('Go to Bracket', 'editor.action.jumpToBracket'),
          'separator',
          {
            label: tr('Back'),
            icon: ArrowLeft,
            shortcut: `${ALT}←`,
            disabled: !canBack,
            onSelect: () => step(-1),
          },
          {
            label: tr('Forward'),
            icon: ArrowRight,
            shortcut: `${ALT}→`,
            disabled: !canForward,
            onSelect: () => step(1),
          },
          'separator',
          editorItem('Next Problem', 'editor.action.marker.next', {
            shortcut: `${ALT}F8`,
          }),
        ],
      },
      {
        label: tr('Terminal'),
        items: [
          {
            label: terminal ? tr('Hide Terminal') : tr('Show Terminal'),
            icon: SquareTerminal,
            shortcut: `${MOD}\``,
            onSelect: () => setTerminal(t => !t),
          },
        ],
      },
    ]
  })

  const handleRenamed = (from: string, to: string) => {
    const remap = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
    setTabs(ts => ts.map(t => ({ ...t, path: remap(t.path) })))
    nav.current.list = nav.current.list.map(remap)
    setActive(a => a && remap(a))
    setRecent(r => r.map(remap))
  }

  const handleDeleted = (path: string) => {
    const gone = (p: string) => p === path || p.startsWith(`${path}/`)
    const n = nav.current
    n.at -= n.list.slice(0, n.at + 1).filter(gone).length
    n.list = n.list.filter(p => !gone(p))
    closeTabs(latest.current.tabs.filter(t => gone(t.path)).map(t => t.path))
    setRecent(r => r.filter(p => !gone(p)))
  }

  const openEditorMenu = (editor: Monaco.editor.IStandaloneCodeEditor, e: Monaco.editor.IEditorMouseEvent) => {
    e.event.preventDefault()
    // Like VS Code: right-clicking outside the selection moves the cursor there first.
    const position = e.target.position
    const selection = editor.getSelection()
    if (position && selection && !selection.containsPosition(position)) editor.setPosition(position)
    const hasSelection = !editor.getSelection()?.isEmpty()
    const run = (id: string) => () => {
      editor.focus()
      void editor.getAction(id)?.run()
    }
    show({ x: e.event.browserEvent.clientX, y: e.event.browserEvent.clientY }, [
      {
        label: tr('Cut'),
        icon: Scissors,
        shortcut: `${MOD}X`,
        disabled: !hasSelection,
        onSelect: run('editor.action.clipboardCutAction'),
      },
      {
        label: tr('Copy'),
        icon: Copy,
        shortcut: `${MOD}C`,
        disabled: !hasSelection,
        onSelect: run('editor.action.clipboardCopyAction'),
      },
      {
        label: tr('Paste'),
        icon: ClipboardPaste,
        shortcut: `${MOD}V`,
        disabled: !navigator.clipboard?.readText,
        onSelect: run('editor.action.clipboardPasteAction'),
      },
      'separator',
      {
        label: tr('Find'),
        icon: Search,
        shortcut: `${MOD}F`,
        onSelect: run('actions.find'),
      },
      {
        label: tr('Replace'),
        icon: Replace,
        shortcut: `${MOD}H`,
        onSelect: run('editor.action.startFindReplaceAction'),
      },
      {
        label: tr('Change All Occurrences'),
        icon: TextCursorInput,
        onSelect: run('editor.action.changeAll'),
      },
      {
        label: tr('Toggle Line Comment'),
        icon: Hash,
        shortcut: `${MOD}/`,
        onSelect: run('editor.action.commentLine'),
      },
      {
        label: tr('Format Document'),
        icon: WandSparkles,
        shortcut: `${SHIFT}${ALT}F`,
        disabled: !editor.getAction('editor.action.formatDocument')?.isSupported(),
        onSelect: run('editor.action.formatDocument'),
      },
      'separator',
      {
        label: tr('Command Palette…'),
        icon: Command,
        shortcut: 'F1',
        onSelect: run('editor.action.quickCommand'),
      },
    ])
  }

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
    editor.onDidChangeCursorPosition(e => setCursor({ line: e.position.lineNumber, column: e.position.column }))
    // What the status bar says about the file: the editor detects it from the text.
    let watched: Monaco.IDisposable | null = null
    const readFormat = () => {
      const model = editor.getModel()
      watched?.dispose()
      if (!model) return
      const read = () => {
        const o = model.getOptions()
        setFormat({
          tabSize: o.tabSize,
          insertSpaces: o.insertSpaces,
          eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF',
        })
      }
      read()
      watched = model.onDidChangeOptions(read)
    }
    readFormat()
    editor.onDidChangeModel(readFormat)
    editor.onContextMenu(e => openEditorMenu(editor, e))
    applyReveal()
    editor.focus()
  }

  const tabMenu = (e: MouseEvent, tab: Tab) => {
    const index = tabs.findIndex(t => t.path === tab.path)
    show(e, [
      { label: tr('Close'), icon: X, onSelect: () => requestClose([tab.path]) },
      {
        label: tr('Close Others'),
        disabled: tabs.length < 2,
        onSelect: () => requestClose(tabs.filter(t => t.path !== tab.path).map(t => t.path)),
      },
      {
        label: tr('Close to the Right'),
        disabled: index === tabs.length - 1,
        onSelect: () => requestClose(tabs.slice(index + 1).map(t => t.path)),
      },
      {
        label: tr('Close Saved'),
        onSelect: () => requestClose(tabs.filter(t => !isDirty(t)).map(t => t.path)),
      },
      {
        label: tr('Close All'),
        onSelect: () => requestClose(tabs.map(t => t.path)),
      },
      'separator',
      {
        label: tr('Save'),
        icon: Save,
        shortcut: `${MOD}S`,
        disabled: !isDirty(tab),
        onSelect: () => void save(tab.path),
      },
      {
        label: tr('Copy Path'),
        icon: Copy,
        onSelect: () => void copyText(tab.path),
      },
    ])
  }

  const moreMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    show({ x: r.left, y: r.bottom + 4 }, [
      {
        label: tr('Close All'),
        onSelect: () => requestClose(tabs.map(t => t.path)),
      },
      {
        label: tr('Close Saved'),
        onSelect: () => requestClose(tabs.filter(t => !isDirty(t)).map(t => t.path)),
      },
      {
        label: tr('Close Others'),
        disabled: tabs.length < 2,
        onSelect: () => requestClose(tabs.filter(t => t.path !== active).map(t => t.path)),
      },
      'separator',
      {
        label: tr('Word Wrap'),
        icon: WrapText,
        checked: wordWrap,
        onSelect: () => setWordWrap(w => !w),
      },
      {
        label: tr('Minimap'),
        icon: MapIcon,
        checked: minimap,
        onSelect: () => setMinimap(m => !m),
      },
      {
        label: tr('Preview'),
        icon: Eye,
        checked: preview,
        disabled: !canPreview,
        onSelect: () => setPreview(p => !p),
      },
      'separator',
      {
        label: tr('Format Document'),
        icon: WandSparkles,
        shortcut: `${SHIFT}${ALT}F`,
        onSelect: runEditor('editor.action.formatDocument'),
      },
      {
        label: tr('Reveal in Explorer'),
        icon: FilesIcon,
        disabled: !active || !root || !active.startsWith(`${root}/`),
        onSelect: () => active && revealFolder(dirOf(active)),
      },
      {
        label: tr('Copy Path'),
        icon: Copy,
        disabled: !active,
        onSelect: () => active && void copyText(active),
      },
    ])
  }

  const activeTab = tabs.find(t => t.path === active) ?? null
  const language = activeTab ? languageFor(nameOf(activeTab.path)) : null
  const previewKind =
    language?.id === 'markdown' && extensions.markdownPreview
      ? 'markdown'
      : language?.id === 'html' && /\.html?$/i.test(activeTab?.path ?? '') && extensions.htmlPreview
        ? 'html'
        : null
  const canPreview = !!previewKind
  const showPreview = preview && canPreview
  const previewSource = showPreview ? activeTab?.value : undefined
  useEffect(() => {
    if (previewSource === undefined) return
    let alive = true
    const timer = window.setTimeout(() => {
      if (previewKind === 'html') setPreviewPage(previewSource)
      else void markdownPage(previewSource, settings.theme === 'dark').then(page => alive && setPreviewPage(page))
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [previewSource, previewKind, settings.theme])

  // Sashes: drag the sidebar's edge (narrow enough and it closes) and the terminal's top.
  const resizeSidebar = (e: ReactPointerEvent) => {
    const start = sidebarWidth
    let width = start
    dragSash(
      e,
      dx => {
        width = start + dx
        if (width < SIDEBAR_SNAP) setPanel(null)
        else {
          setPanel(p => p ?? session.lastPanel)
          setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))
        }
      },
      () => width >= SIDEBAR_SNAP && store('code.sidebarWidth', String(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))),
    )
  }
  const resizeTerminal = (e: ReactPointerEvent) => {
    const start = terminalHeight
    const room = (mainRef.current?.clientHeight ?? 600) - 120
    let height = start
    dragSash(
      e,
      (_dx, dy) => {
        height = Math.min(room, Math.max(TERMINAL_MIN, start - dy))
        setTerminalHeight(height)
      },
      () => store('code.terminalHeight', String(height)),
    )
  }
  // Tabs reorder by dragging, like VS Code's.
  const dropTab = (onto: string) => {
    if (!dragTab || dragTab === onto) return
    setTabs(ts => {
      const from = ts.findIndex(t => t.path === dragTab)
      const to = ts.findIndex(t => t.path === onto)
      if (from < 0 || to < 0) return ts
      const next = [...ts]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  const dirtyCount = tabs.filter(isDirty).length
  const closingDirty = closing ? tabs.filter(t => closing.includes(t.path) && isDirty(t)) : []

  return (
    // Keyboard shortcuts come from the menus registered below (see useAppMenus / App).
    <div className="ce" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <input
        ref={uploadInput}
        type="file"
        multiple
        hidden
        onChange={e => {
          const picked = [...(e.target.files ?? [])]
          e.target.value = ''
          if (picked.length) void uploadFiles(root ?? ROOT, picked)
        }}
      />
      <WindowToolbar>
        <span className="tb-spacer" />
        <div className="ce-cc is-centered">
          <button
            className="ce-tb-btn"
            onClick={() => step(-1)}
            disabled={!canBack}
            aria-label={tr('Back')}
            title={`${tr('Back')} (${ALT}←)`}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="ce-tb-btn"
            onClick={() => step(1)}
            disabled={!canForward}
            aria-label={tr('Forward')}
            title={`${tr('Forward')} (${ALT}→)`}
          >
            <ArrowRight size={16} />
          </button>
          <button className="ce-cc-search" onClick={() => setQuickOpen(true)} title={tr('Go to File… ({0}P)', MOD)}>
            <Search size={13} />
            <span>{root ? nameOf(root) : (stats?.hostname ?? 'Code')}</span>
          </button>
        </div>
        <span className="tb-spacer" />
        <div className="ce-layout">
          <button
            className="ce-tb-btn"
            onClick={toggleSidebar}
            aria-pressed={!!panel}
            aria-label={tr('Toggle Sidebar')}
            title={`${tr('Toggle Sidebar')} (${MOD}B)`}
          >
            {panel ? <PanelLeft size={16} /> : <PanelLeftDashed size={16} />}
          </button>
          <button
            className="ce-tb-btn"
            onClick={() => setTerminal(t => !t)}
            aria-pressed={terminal}
            aria-label={tr('Toggle Terminal')}
            title={`${tr('Toggle Terminal')} (${MOD}\`)`}
          >
            {terminal ? <PanelBottom size={16} /> : <PanelBottomDashed size={16} />}
          </button>
          <button
            className="ce-tb-btn"
            onClick={() => setPreview(p => !p)}
            disabled={!canPreview}
            aria-pressed={showPreview}
            aria-label={tr('Toggle Preview')}
            title={tr('Toggle Preview')}
          >
            {showPreview ? <PanelRight size={16} /> : <PanelRightDashed size={16} />}
          </button>
        </div>
      </WindowToolbar>

      <div className="ce-body">
        <nav className="ce-activity" aria-label={tr('Views')}>
          <ActivityButton
            icon={FilesIcon}
            label={tr('Explorer ({0}B)', MOD)}
            active={panel === 'explorer'}
            onClick={() => setPanel(p => (p === 'explorer' ? null : 'explorer'))}
          />
          <ActivityButton
            icon={Search}
            label={tr('Search ({0}{1}F)', MOD, SHIFT)}
            active={panel === 'search'}
            onClick={() => setPanel(p => (p === 'search' ? null : 'search'))}
          />
          <ActivityButton
            icon={Blocks}
            label={tr('Extensions')}
            active={panel === 'extensions'}
            onClick={() => setPanel(p => (p === 'extensions' ? null : 'extensions'))}
          />
          <span className="ce-activity-spacer" />
          <ActivityButton
            icon={SquareTerminal}
            label={tr('Terminal ({0}`)', MOD)}
            active={terminal}
            onClick={() => setTerminal(t => !t)}
          />
        </nav>

        {panel && (
          <aside className="ce-sidebar" style={{ width: sidebarWidth }}>
            {panel === 'explorer' && root && (
              <Explorer
                key={root}
                root={root}
                version={treeVersion}
                expanded={expanded}
                onExpandedChange={setExpanded}
                activePath={active}
                onOpenFile={path => void openFile(path)}
                onRenamed={handleRenamed}
                onDeleted={handleDeleted}
                onOpenFolder={() => setDialog('folder')}
                onCloseFolder={closeFolder}
              />
            )}
            {panel === 'explorer' && !root && (
              <>
                <div className="ce-side-head">{tr('EXPLORER')}</div>
                <div className="ce-no-folder">
                  <p>{tr('You have not yet opened a folder.')}</p>
                  <button className="btn btn-primary" onClick={() => setDialog('folder')}>
                    {tr('Open Folder')}
                  </button>
                  <button className="btn" onClick={() => setDialog('file')}>
                    {tr('Open File')}
                  </button>
                </div>
              </>
            )}
            {panel === 'search' && (
              <SearchPanel
                key={root ?? ROOT}
                root={root ?? ROOT}
                onOpenMatch={(path, line, column) => void openFile(path, { line, column })}
              />
            )}
            {panel === 'extensions' && <ExtensionsPanel value={extensions} onChange={setExtensions} />}
          </aside>
        )}
        {panel && (
          <div
            className="ce-sash"
            role="separator"
            aria-orientation="vertical"
            aria-label={tr('Resize the sidebar')}
            onPointerDown={resizeSidebar}
            onDoubleClick={() => {
              setSidebarWidth(SIDEBAR_WIDTH)
              store('code.sidebarWidth', String(SIDEBAR_WIDTH))
            }}
          />
        )}

        <section className="ce-main" ref={mainRef}>
          {tabs.length > 0 && (
            <div className="ce-tabbar">
              <div className="ce-tabs" role="tablist" onDoubleClick={e => e.target === e.currentTarget && void newFile()}>
                {tabs.map(tab => (
                  <div
                    key={tab.path}
                    role="tab"
                    aria-selected={tab.path === active}
                    className={`ce-tab ${tab.path === active ? 'is-active' : ''} ${isDirty(tab) ? 'is-dirty' : ''} ${dragTab === tab.path ? 'is-dragging' : ''}`}
                    title={tab.path}
                    draggable
                    onDragStart={e => {
                      setDragTab(tab.path)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', tab.path)
                    }}
                    onDragOver={e => {
                      if (!dragTab) return
                      e.preventDefault()
                      dropTab(tab.path)
                    }}
                    onDragEnd={() => setDragTab(null)}
                    onDrop={e => dragTab && e.preventDefault()}
                    onClick={() => setActive(tab.path)}
                    onMouseDown={e => e.button === 1 && e.preventDefault()}
                    onAuxClick={e => e.button === 1 && requestClose([tab.path])}
                    onContextMenu={e => tabMenu(e, tab)}
                  >
                    <FileTypeIcon name={nameOf(tab.path)} size={14} />
                    <span className="ce-tab-name">{nameOf(tab.path)}</span>
                    <button
                      className="ce-tab-close"
                      aria-label={tr('Close {0}', nameOf(tab.path))}
                      onClick={e => {
                        e.stopPropagation()
                        requestClose([tab.path])
                      }}
                    >
                      <span className="ce-dot" />
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
              {activeTab && (
                <span className="ce-editor-actions">
                  {canPreview && (
                    <button
                      className={preview ? 'is-on' : ''}
                      onClick={() => setPreview(p => !p)}
                      title={tr('Preview beside')}
                      aria-label={tr('Preview beside')}
                      aria-pressed={preview}
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  <button
                    className={wordWrap ? 'is-on' : ''}
                    onClick={() => setWordWrap(w => !w)}
                    title={tr('Word Wrap')}
                    aria-label={tr('Word Wrap')}
                    aria-pressed={wordWrap}
                  >
                    <WrapText size={14} />
                  </button>
                  <button
                    className={minimap ? 'is-on' : ''}
                    onClick={() => setMinimap(m => !m)}
                    title={minimap ? tr('Hide Minimap') : tr('Show Minimap')}
                    aria-label={tr('Minimap')}
                    aria-pressed={minimap}
                  >
                    <MapIcon size={14} />
                  </button>
                  <button onClick={moreMenu} title={tr('More Actions…')} aria-label={tr('More Actions…')}>
                    <Ellipsis size={14} />
                  </button>
                </span>
              )}
            </div>
          )}

          {activeTab ? (
            <>
              <Crumbs
                path={activeTab.path}
                root={root}
                onFolder={revealFolder}
                onFile={runEditor('editor.action.quickOutline')}
              />
              <div className={`ce-editor ${showPreview ? 'has-preview' : ''}`}>
                <Suspense fallback={<div className="ce-loading">{tr('Loading editor…')}</div>}>
                  <MonacoView
                    path={activeTab.path}
                    language={language?.id ?? 'plaintext'}
                    defaultValue={activeTab.value}
                    dark={settings.theme === 'dark'}
                    wordWrap={wordWrap}
                    minimap={minimap}
                    extensions={extensions}
                    onChange={value => setTabs(ts => ts.map(t => (t.path === activeTab.path ? { ...t, value } : t)))}
                    onMount={handleMount}
                  />
                </Suspense>
                {showPreview && (
                  <iframe
                    className="ce-preview"
                    title={tr('Preview')}
                    // Sealed off: an HTML page's scripts run, but can't reach the server or this page.
                    sandbox={
                      previewKind === 'html' ? 'allow-scripts allow-popups' : 'allow-popups allow-popups-to-escape-sandbox'
                    }
                    srcDoc={previewPage}
                  />
                )}
              </div>
            </>
          ) : (
            <Welcome
              host={stats?.hostname ?? 'your server'}
              recent={recent}
              recentFolders={recentFolders}
              onOpenPath={path => void openFile(path)}
              onOpenFolderPath={openFolder}
              onNewFile={() => void newFile()}
              onOpenFile={() => setDialog('file')}
              onOpenFolder={() => setDialog('folder')}
              onGoToFile={() => setQuickOpen(true)}
            />
          )}

          {terminal && (
            <div className="ce-panel" style={{ height: terminalHeight }}>
              <div
                className="ce-sash is-horizontal"
                role="separator"
                aria-orientation="horizontal"
                aria-label={tr('Resize the terminal')}
                onPointerDown={resizeTerminal}
              />
              <div className="ce-panel-head">
                {tr('TERMINAL')}
                <button onClick={() => setTerminal(false)} aria-label={tr('Close terminal')}>
                  <X size={14} />
                </button>
              </div>
              <Terminal menus={false} />
            </div>
          )}
        </section>
      </div>

      <footer className="ce-status">
        <span title={tr('Connected server')}>
          <Server size={12} /> {stats?.hostname ?? 'server'}
        </span>
        {root && (
          <span title={tr('Workspace: {0}', root)}>
            <FolderOpen size={12} /> {nameOf(root)}
          </span>
        )}
        {dirtyCount > 0 && (
          <span>
            ● {dirtyCount} {tr('unsaved')}
          </span>
        )}
        {notice && <span className="ce-notice">{notice}</span>}
        <span className="ce-status-grow" />
        {activeTab && language && (
          <>
            <span>
              {tr('Ln')} {cursor.line}
              {tr(', Col')} {cursor.column}
            </span>
            <span>{format.insertSpaces ? tr('Spaces: {0}', format.tabSize) : tr('Tab Size: {0}', format.tabSize)}</span>
            <span>{tr('UTF-8')}</span>
            <span>{format.eol}</span>
            <span>{language.name}</span>
          </>
        )}
        <button onClick={() => setTerminal(t => !t)} aria-pressed={terminal}>
          <SquareTerminal size={12} /> {tr('Terminal')}
        </button>
      </footer>

      {closingDirty.length > 0 && <SaveSheet files={closingDirty.map(t => t.path)} onChoose={c => void resolveClose(c)} />}

      {dialog && (
        <OpenDialog
          mode={dialog}
          startDir={active ? dirOf(active) : (root ?? ROOT)}
          onOpen={path => {
            setDialog(null)
            if (dialog === 'folder') openFolder(path)
            else void openFile(path)
          }}
          onUpload={(dir, picked) => {
            setDialog(null)
            void uploadFiles(dir, picked)
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {quickOpen && (
        <QuickOpen root={root ?? ROOT} recent={recent} onOpen={path => void openFile(path)} onClose={() => setQuickOpen(false)} />
      )}

      {dragging && (
        <div className="ce-drop" aria-hidden>
          <Upload size={28} />
          {tr('Drop to upload to')} {root ?? ROOT}
        </div>
      )}
    </div>
  )
}

/**
 * The open file's path above the editor, from the workspace folder when it's in it (as VS Code
 * shows it). A folder shows in the Explorer; the file opens Go to Symbol.
 */
function Crumbs({
  path,
  root,
  onFolder,
  onFile,
}: {
  path: string
  root: string | null
  onFolder: (dir: string) => void
  onFile: () => void
}) {
  const inside = !!root && root !== '/' && path.startsWith(`${root}/`)
  let at = inside ? root : ''
  const parts = path
    .slice(at.length)
    .split('/')
    .filter(Boolean)
    .map(name => ({ name, path: (at = `${at}/${name}`) }))
  return (
    <div className="ce-crumbs">
      {parts.map((part, i) => {
        const file = i === parts.length - 1
        return (
          <span key={part.path} className="ce-crumb">
            <button
              onClick={file ? onFile : () => onFolder(part.path)}
              disabled={!file && !inside}
              title={file ? tr('Go to Symbol…') : part.path}
            >
              {file && <FileTypeIcon name={part.name} size={13} />}
              {part.name}
            </button>
            {!file && <ChevronRight size={12} />}
          </span>
        )
      })}
    </div>
  )
}

function ActivityButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button className={active ? 'is-active' : undefined} onClick={onClick} aria-label={label} title={label} aria-pressed={active}>
      <Icon size={20} strokeWidth={1.6} />
    </button>
  )
}

interface WelcomeProps {
  host: string
  recent: string[]
  recentFolders: string[]
  onOpenPath: (path: string) => void
  onOpenFolderPath: (path: string) => void
  onNewFile: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onGoToFile: () => void
}

function Welcome({
  host,
  recent,
  recentFolders,
  onOpenPath,
  onOpenFolderPath,
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onGoToFile,
}: WelcomeProps) {
  const hasRecent = recent.length > 0 || recentFolders.length > 0
  const files = hasRecent ? recent : SUGGESTED
  return (
    <div className="ce-welcome">
      <AppIcon icon={CODE_APP.icon} color={CODE_APP.color} size={72} />
      <h2>{tr('Code')}</h2>
      <p>
        {tr('Edit files on')} {host}
        {tr(', right from the browser.')}
      </p>
      <div className="ce-welcome-cols">
        <div>
          <h3>{tr('Start')}</h3>
          <button className="ce-link" onClick={onNewFile}>
            <FilePlus size={14} /> {tr('New File…')}
          </button>
          <button className="ce-link" onClick={onOpenFile}>
            <FileInput size={14} /> {tr('Open File…')}
          </button>
          <button className="ce-link" onClick={onOpenFolder}>
            <FolderOpen size={14} /> {tr('Open Folder…')}
          </button>
          <button className="ce-link" onClick={onGoToFile}>
            <FileSearch size={14} /> {tr('Go to File…')}
          </button>

          <h3 className="ce-welcome-gap">{hasRecent ? tr('Recent') : tr('Try opening')}</h3>
          {recentFolders.map(path => (
            <button key={path} className="ce-link" onClick={() => onOpenFolderPath(path)} title={path}>
              <FileTypeIcon name={nameOf(path)} folder size={14} />
              <span className="ce-link-name">{nameOf(path)}</span>
              <small>{dirOf(path)}</small>
            </button>
          ))}
          {files.map(path => (
            <button key={path} className="ce-link" onClick={() => onOpenPath(path)} title={path}>
              <FileTypeIcon name={nameOf(path)} size={14} />
              <span className="ce-link-name">{nameOf(path)}</span>
              <small>{dirOf(path)}</small>
            </button>
          ))}
        </div>
        <div>
          <h3>{tr('Shortcuts')}</h3>
          <dl className="ce-shortcuts">
            <dt>{tr('Open File')}</dt>
            <dd>{MOD}O</dd>
            <dt>{tr('Go to File')}</dt>
            <dd>{MOD}P</dd>
            <dt>{tr('Command Palette')}</dt>
            <dd>
              {MOD}
              {SHIFT}P
            </dd>
            <dt>{tr('Save')}</dt>
            <dd>{MOD}S</dd>
            <dt>{tr('Toggle Sidebar')}</dt>
            <dd>{MOD}B</dd>
            <dt>{tr('Toggle Terminal')}</dt>
            <dd>{MOD}`</dd>
            <dt>{tr('Search Files')}</dt>
            <dd>
              {MOD}
              {SHIFT}F
            </dd>
          </dl>
          <p className="ce-welcome-tip">{tr('Tip: drag files from your computer onto this window to upload and open them.')}</p>
        </div>
      </div>
    </div>
  )
}

function SaveSheet({ files, onChoose }: { files: string[]; onChoose: (choice: CloseChoice) => void }) {
  const one = files.length === 1
  return (
    <div
      className="ce-sheet-backdrop"
      onPointerDown={e => e.target === e.currentTarget && onChoose('cancel')}
      onKeyDown={e => e.key === 'Escape' && onChoose('cancel')}
    >
      <div className="ce-sheet" role="alertdialog" aria-modal="true" aria-labelledby="ce-sheet-title">
        <AppIcon icon={CODE_APP.icon} color={CODE_APP.color} size={52} />
        <h3 id="ce-sheet-title">
          {one
            ? tr('Do you want to save the changes you made to {0}?', nameOf(files[0]))
            : tr('Do you want to save the changes to {0} files?', files.length)}
        </h3>
        <p>{tr("Your changes will be lost if you don't save them.")}</p>
        <div className="ce-sheet-actions">
          <button className="btn" onClick={() => onChoose('discard')}>
            {tr("Don't Save")}
          </button>
          <span className="ce-status-grow" />
          <button className="btn" onClick={() => onChoose('cancel')}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" autoFocus onClick={() => onChoose('save')}>
            {one ? tr('Save') : tr('Save All')}
          </button>
        </div>
      </div>
    </div>
  )
}
