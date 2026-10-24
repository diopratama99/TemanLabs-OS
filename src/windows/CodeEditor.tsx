import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react'
import type { OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import {
  ArrowDownToLine,
  AtSign,
  ChevronRight,
  ClipboardPaste,
  Command,
  Copy,
  FileInput,
  FilePlus,
  FileSearch,
  Files as FilesIcon,
  FolderOpen,
  FolderX,
  Hash,
  Map as MapIcon,
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
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { languageFor } from '../lib/fileTypes'
import { joinPath, nameOf, parentOf } from '../lib/paths'
import { DATA_ROOT } from '../lib/places'
import { ALT, MOD, SHIFT } from '../lib/platform'
import { useSettings } from '../lib/settings'
import { CODE_APP } from '../lib/systemApps'
import { Terminal } from './Terminal'

const MonacoView = lazy(() => import('../components/code/MonacoView'))

const ROOT = DATA_ROOT
const MAX_RECENT = 6
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

type Panel = 'explorer' | 'search'
type CloseChoice = 'save' | 'discard' | 'cancel'

// Lives outside the component so closing the window keeps open tabs and unsaved edits.
const session = {
  tabs: [] as Tab[],
  active: null as string | null,
  /** Workspace folder shown in the Explorer; null after Close Folder. */
  root: ROOT as string | null,
  panel: 'explorer' as Panel | null,
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

  const uploadInput = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const pendingReveal = useRef<{ line: number; column: number } | null>(null)
  // Callbacks registered with Monaco outlive a render, so they read state through this ref.
  const latest = useRef({ tabs, active })
  latest.current = { tabs, active }

  useEffect(() => {
    Object.assign(session, { tabs, active, root, panel, terminal, expanded, recent, recentFolders, wordWrap, minimap })
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
    const { tabs, active } = latest.current
    const tab = tabs.find(t => t.path === (path ?? active))
    if (!tab || !isDirty(tab)) return
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
        label: 'File',
        items: [
          { label: 'New File', icon: FilePlus, onSelect: () => void newFile() },
          'separator',
          { label: 'Open File…', icon: FileInput, shortcut: `${MOD}O`, onSelect: () => setDialog('file') },
          { label: 'Open Folder…', icon: FolderOpen, onSelect: () => setDialog('folder') },
          { label: 'Go to File…', icon: FileSearch, shortcut: `${MOD}P`, onSelect: () => setQuickOpen(true) },
          { label: 'Upload from Computer…', icon: Upload, onSelect: () => uploadInput.current?.click() },
          'separator',
          {
            label: 'Save',
            icon: Save,
            shortcut: `${MOD}S`,
            disabled: !activeTab || !isDirty(activeTab),
            onSelect: () => void save(),
          },
          { label: 'Save All', disabled: dirtyCount === 0, onSelect: () => void saveAll() },
          'separator',
          { label: 'Close Editor', icon: X, disabled: noEditor, onSelect: () => active && requestClose([active]) },
          { label: 'Close All Editors', disabled: tabs.length === 0, onSelect: () => requestClose(tabs.map(t => t.path)) },
          { label: 'Close Folder', icon: FolderX, disabled: !root, onSelect: closeFolder },
        ],
      },
      {
        label: 'Edit',
        items: [
          editorItem('Undo', 'undo', { icon: Undo2, shortcut: `${MOD}Z` }),
          editorItem('Redo', 'redo', { icon: Redo2, shortcut: `${MOD}${SHIFT}Z` }),
          'separator',
          editorItem('Cut', 'editor.action.clipboardCutAction', { icon: Scissors, shortcut: `${MOD}X` }),
          editorItem('Copy', 'editor.action.clipboardCopyAction', { icon: Copy, shortcut: `${MOD}C` }),
          editorItem('Paste', 'editor.action.clipboardPasteAction', {
            icon: ClipboardPaste,
            shortcut: `${MOD}V`,
            disabled: noEditor || !navigator.clipboard?.readText,
          }),
          'separator',
          editorItem('Find', 'actions.find', { icon: Search, shortcut: `${MOD}F` }),
          editorItem('Replace', 'editor.action.startFindReplaceAction', { icon: Replace, shortcut: `${MOD}H` }),
          { label: 'Find in Files', icon: FileSearch, shortcut: `${MOD}${SHIFT}F`, onSelect: () => setPanel('search') },
          'separator',
          editorItem('Toggle Line Comment', 'editor.action.commentLine', { icon: Hash, shortcut: `${MOD}/` }),
          editorItem('Format Document', 'editor.action.formatDocument', { icon: WandSparkles, shortcut: `${SHIFT}${ALT}F` }),
        ],
      },
      {
        label: 'Selection',
        items: [
          editorItem('Select All', 'editor.action.selectAll', { shortcut: `${MOD}A` }),
          editorItem('Expand Selection', 'editor.action.smartSelect.expand', { shortcut: `${SHIFT}${ALT}→` }),
          editorItem('Shrink Selection', 'editor.action.smartSelect.shrink', { shortcut: `${SHIFT}${ALT}←` }),
          'separator',
          editorItem('Add Cursor Above', 'editor.action.insertCursorAbove'),
          editorItem('Add Cursor Below', 'editor.action.insertCursorBelow'),
          editorItem('Add Next Occurrence', 'editor.action.addSelectionToNextFindMatch', { shortcut: `${MOD}D` }),
          editorItem('Select All Occurrences', 'editor.action.selectHighlights', { shortcut: `${MOD}${SHIFT}L` }),
        ],
      },
      {
        label: 'View',
        items: [
          editorItem('Command Palette…', 'editor.action.quickCommand', { icon: Command, shortcut: `${MOD}${SHIFT}P` }),
          'separator',
          {
            label: 'Explorer',
            icon: FilesIcon,
            shortcut: `${MOD}B`,
            checked: panel === 'explorer',
            onSelect: () => togglePanel('explorer'),
          },
          { label: 'Search', icon: Search, checked: panel === 'search', onSelect: () => togglePanel('search') },
          {
            label: 'Terminal',
            icon: SquareTerminal,
            shortcut: `${MOD}\``,
            checked: terminal,
            onSelect: () => setTerminal(t => !t),
          },
          'separator',
          { label: 'Word Wrap', icon: WrapText, checked: wordWrap, onSelect: () => setWordWrap(w => !w) },
          { label: 'Minimap', icon: MapIcon, checked: minimap, onSelect: () => setMinimap(m => !m) },
        ],
      },
      {
        label: 'Go',
        items: [
          { label: 'Go to File…', icon: FileSearch, shortcut: `${MOD}P`, onSelect: () => setQuickOpen(true) },
          editorItem('Go to Line…', 'editor.action.gotoLine', { icon: ArrowDownToLine }),
          editorItem('Go to Symbol…', 'editor.action.quickOutline', { icon: AtSign }),
          editorItem('Go to Definition', 'editor.action.revealDefinition', { shortcut: 'F12' }),
          editorItem('Go to Bracket', 'editor.action.jumpToBracket'),
          'separator',
          editorItem('Next Problem', 'editor.action.marker.next', { shortcut: `${ALT}F8` }),
        ],
      },
      {
        label: 'Terminal',
        items: [
          {
            label: terminal ? 'Hide Terminal' : 'Show Terminal',
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
    setActive(a => a && remap(a))
    setRecent(r => r.map(remap))
  }

  const handleDeleted = (path: string) => {
    const gone = (p: string) => p === path || p.startsWith(`${path}/`)
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
      { label: 'Cut', icon: Scissors, shortcut: `${MOD}X`, disabled: !hasSelection, onSelect: run('editor.action.clipboardCutAction') },
      { label: 'Copy', icon: Copy, shortcut: `${MOD}C`, disabled: !hasSelection, onSelect: run('editor.action.clipboardCopyAction') },
      {
        label: 'Paste',
        icon: ClipboardPaste,
        shortcut: `${MOD}V`,
        disabled: !navigator.clipboard?.readText,
        onSelect: run('editor.action.clipboardPasteAction'),
      },
      'separator',
      { label: 'Find', icon: Search, shortcut: `${MOD}F`, onSelect: run('actions.find') },
      { label: 'Replace', icon: Replace, shortcut: `${MOD}H`, onSelect: run('editor.action.startFindReplaceAction') },
      { label: 'Change All Occurrences', icon: TextCursorInput, onSelect: run('editor.action.changeAll') },
      { label: 'Toggle Line Comment', icon: Hash, shortcut: `${MOD}/`, onSelect: run('editor.action.commentLine') },
      {
        label: 'Format Document',
        icon: WandSparkles,
        shortcut: `${SHIFT}${ALT}F`,
        disabled: !editor.getAction('editor.action.formatDocument')?.isSupported(),
        onSelect: run('editor.action.formatDocument'),
      },
      'separator',
      { label: 'Command Palette…', icon: Command, shortcut: 'F1', onSelect: run('editor.action.quickCommand') },
    ])
  }

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save())
    editor.onDidChangeCursorPosition(e => setCursor({ line: e.position.lineNumber, column: e.position.column }))
    editor.onContextMenu(e => openEditorMenu(editor, e))
    applyReveal()
    editor.focus()
  }

  const tabMenu = (e: MouseEvent, tab: Tab) => {
    const index = tabs.findIndex(t => t.path === tab.path)
    show(e, [
      { label: 'Close', icon: X, onSelect: () => requestClose([tab.path]) },
      {
        label: 'Close Others',
        disabled: tabs.length < 2,
        onSelect: () => requestClose(tabs.filter(t => t.path !== tab.path).map(t => t.path)),
      },
      {
        label: 'Close to the Right',
        disabled: index === tabs.length - 1,
        onSelect: () => requestClose(tabs.slice(index + 1).map(t => t.path)),
      },
      { label: 'Close Saved', onSelect: () => requestClose(tabs.filter(t => !isDirty(t)).map(t => t.path)) },
      { label: 'Close All', onSelect: () => requestClose(tabs.map(t => t.path)) },
      'separator',
      { label: 'Save', icon: Save, shortcut: `${MOD}S`, disabled: !isDirty(tab), onSelect: () => void save(tab.path) },
      { label: 'Copy Path', icon: Copy, onSelect: () => void copyText(tab.path) },
    ])
  }

  const activeTab = tabs.find(t => t.path === active) ?? null
  const language = activeTab ? languageFor(nameOf(activeTab.path)) : null
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
      <div className="ce-body">
        <nav className="ce-activity" aria-label="Views">
          <ActivityButton
            icon={FilesIcon}
            label={`Explorer (${MOD}B)`}
            active={panel === 'explorer'}
            onClick={() => setPanel(p => (p === 'explorer' ? null : 'explorer'))}
          />
          <ActivityButton
            icon={Search}
            label={`Search (${MOD}${SHIFT}F)`}
            active={panel === 'search'}
            onClick={() => setPanel(p => (p === 'search' ? null : 'search'))}
          />
          <span className="ce-activity-spacer" />
          <ActivityButton
            icon={SquareTerminal}
            label={`Terminal (${MOD}\`)`}
            active={terminal}
            onClick={() => setTerminal(t => !t)}
          />
        </nav>

        {panel && (
          <aside className="ce-sidebar">
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
                <div className="ce-side-head">EXPLORER</div>
                <div className="ce-no-folder">
                  <p>You have not yet opened a folder.</p>
                  <button className="btn btn-primary" onClick={() => setDialog('folder')}>
                    Open Folder
                  </button>
                  <button className="btn" onClick={() => setDialog('file')}>
                    Open File
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
          </aside>
        )}

        <section className="ce-main">
          {tabs.length > 0 && (
            <div className="ce-tabs" role="tablist">
              {tabs.map(tab => (
                <div
                  key={tab.path}
                  role="tab"
                  aria-selected={tab.path === active}
                  className={`ce-tab ${tab.path === active ? 'is-active' : ''} ${isDirty(tab) ? 'is-dirty' : ''}`}
                  title={tab.path}
                  onClick={() => setActive(tab.path)}
                  onMouseDown={e => e.button === 1 && e.preventDefault()}
                  onAuxClick={e => e.button === 1 && requestClose([tab.path])}
                  onContextMenu={e => tabMenu(e, tab)}
                >
                  <FileTypeIcon name={nameOf(tab.path)} size={14} />
                  <span className="ce-tab-name">{nameOf(tab.path)}</span>
                  <button
                    className="ce-tab-close"
                    aria-label={`Close ${nameOf(tab.path)}`}
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
          )}

          {activeTab ? (
            <>
              <div className="ce-crumbs">
                {activeTab.path
                  .split('/')
                  .filter(Boolean)
                  .map((part, i, parts) => (
                    <span key={i} className="ce-crumb">
                      {i === parts.length - 1 && <FileTypeIcon name={part} size={13} />}
                      {part}
                      {i < parts.length - 1 && <ChevronRight size={12} />}
                    </span>
                  ))}
              </div>
              <div className="ce-editor">
                <Suspense fallback={<div className="ce-loading">Loading editor…</div>}>
                  <MonacoView
                    path={activeTab.path}
                    language={language?.id ?? 'plaintext'}
                    defaultValue={activeTab.value}
                    dark={settings.theme === 'dark'}
                    wordWrap={wordWrap}
                    minimap={minimap}
                    onChange={value => setTabs(ts => ts.map(t => (t.path === activeTab.path ? { ...t, value } : t)))}
                    onMount={handleMount}
                  />
                </Suspense>
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
            <div className="ce-panel">
              <div className="ce-panel-head">
                TERMINAL
                <button onClick={() => setTerminal(false)} aria-label="Close terminal">
                  <X size={14} />
                </button>
              </div>
              <Terminal menus={false} />
            </div>
          )}
        </section>
      </div>

      <footer className="ce-status">
        <span title="Connected server">
          <Server size={12} /> {stats?.hostname ?? 'server'}
        </span>
        {root && (
          <span title={`Workspace: ${root}`}>
            <FolderOpen size={12} /> {nameOf(root)}
          </span>
        )}
        {dirtyCount > 0 && <span>● {dirtyCount} unsaved</span>}
        {notice && <span className="ce-notice">{notice}</span>}
        <span className="ce-status-grow" />
        {activeTab && language && (
          <>
            <span>
              Ln {cursor.line}, Col {cursor.column}
            </span>
            <span>Spaces: 2</span>
            <span>UTF-8</span>
            <span>LF</span>
            <span>{language.name}</span>
          </>
        )}
        <button onClick={() => setTerminal(t => !t)} aria-pressed={terminal}>
          <SquareTerminal size={12} /> Terminal
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
        <QuickOpen
          root={root ?? ROOT}
          recent={recent}
          onOpen={path => void openFile(path)}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {dragging && (
        <div className="ce-drop" aria-hidden>
          <Upload size={28} />
          Drop to upload to {root ?? ROOT}
        </div>
      )}
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
      <h2>Code</h2>
      <p>Edit files on {host}, right from the browser.</p>
      <div className="ce-welcome-cols">
        <div>
          <h3>Start</h3>
          <button className="ce-link" onClick={onNewFile}>
            <FilePlus size={14} /> New File…
          </button>
          <button className="ce-link" onClick={onOpenFile}>
            <FileInput size={14} /> Open File…
          </button>
          <button className="ce-link" onClick={onOpenFolder}>
            <FolderOpen size={14} /> Open Folder…
          </button>
          <button className="ce-link" onClick={onGoToFile}>
            <FileSearch size={14} /> Go to File…
          </button>

          <h3 className="ce-welcome-gap">{hasRecent ? 'Recent' : 'Try opening'}</h3>
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
          <h3>Shortcuts</h3>
          <dl className="ce-shortcuts">
            <dt>Open File</dt>
            <dd>{MOD}O</dd>
            <dt>Go to File</dt>
            <dd>{MOD}P</dd>
            <dt>Command Palette</dt>
            <dd>
              {MOD}
              {SHIFT}P
            </dd>
            <dt>Save</dt>
            <dd>{MOD}S</dd>
            <dt>Toggle Sidebar</dt>
            <dd>{MOD}B</dd>
            <dt>Toggle Terminal</dt>
            <dd>{MOD}`</dd>
            <dt>Search Files</dt>
            <dd>
              {MOD}
              {SHIFT}F
            </dd>
          </dl>
          <p className="ce-welcome-tip">Tip: drag files from your computer onto this window to upload and open them.</p>
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
            ? `Do you want to save the changes you made to ${nameOf(files[0])}?`
            : `Do you want to save the changes to ${files.length} files?`}
        </h3>
        <p>Your changes will be lost if you don't save them.</p>
        <div className="ce-sheet-actions">
          <button className="btn" onClick={() => onChoose('discard')}>
            Don't Save
          </button>
          <span className="ce-status-grow" />
          <button className="btn" onClick={() => onChoose('cancel')}>
            Cancel
          </button>
          <button className="btn btn-primary" autoFocus onClick={() => onChoose('save')}>
            {one ? 'Save' : 'Save All'}
          </button>
        </div>
      </div>
    </div>
  )
}
