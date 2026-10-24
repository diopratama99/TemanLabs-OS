import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  FilePen,
  FilePlus,
  FolderOpen,
  FolderPlus,
  FolderX,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { api } from '../../api'
import type { FileEntry } from '../../api/types'
import { copyText } from '../../lib/clipboard'
import { useContextMenu } from '../../lib/contextMenu'
import { isTextFile } from '../../lib/fileTypes'
import type { MenuItem } from '../ContextMenu'
import { RenameField } from '../RenameField'
import { FileTypeIcon } from './FileTypeIcon'

import { displayName, joinPath, nameOf, parentOf } from '../../lib/paths'

interface Props {
  root: string
  /** Bumped by the parent when files change elsewhere, to reload the tree. */
  version: number
  expanded: ReadonlySet<string>
  onExpandedChange: (next: Set<string>) => void
  activePath: string | null
  onOpenFile: (path: string) => void
  /** A file or folder moved; open tabs below `from` need their paths updated. */
  onRenamed: (from: string, to: string) => void
  onDeleted: (path: string) => void
  onOpenFolder: () => void
  onCloseFolder: () => void
}

export function Explorer({
  root,
  version: externalVersion,
  expanded,
  onExpandedChange,
  activePath,
  onOpenFile,
  onRenamed,
  onDeleted,
  onOpenFolder,
  onCloseFolder,
}: Props) {
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; isNew: boolean } | null>(null)
  const { show } = useContextMenu()

  // Load every expanded folder; cheap enough for the mock and keeps the tree consistent after edits.
  useEffect(() => {
    let alive = true
    void Promise.all([...expanded].map(async dir => [dir, await api.listFiles(dir)] as const)).then(pairs => {
      if (alive) setChildren(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [expanded, version, externalVersion])

  const refresh = () => setVersion(v => v + 1)
  const entryAt = (path: string) => children[parentOf(path)]?.find(e => e.name === nameOf(path))
  const isFolder = (path: string) => path === root || entryAt(path)?.kind === 'folder'

  const toggle = (dir: string) => {
    const next = new Set(expanded)
    if (next.has(dir)) next.delete(dir)
    else next.add(dir)
    onExpandedChange(next)
  }

  /** New items go into the selected folder, or next to the selected file. */
  const targetDir = () => (!selected ? root : isFolder(selected) ? selected : parentOf(selected))

  const create = async (kind: 'file' | 'folder', dir = targetDir()) => {
    const name = kind === 'file' ? await api.createFile(dir) : await api.createFolder(dir)
    if (!expanded.has(dir)) onExpandedChange(new Set(expanded).add(dir))
    refresh()
    const path = joinPath(dir, name)
    setSelected(path)
    setRenaming({ path, isNew: kind === 'file' })
  }

  const finishRename = async (path: string, value: string | null) => {
    const isNew = renaming?.isNew
    setRenaming(null)
    const dir = parentOf(path)
    const to = value?.trim()
    const valid = to && to !== nameOf(path) && !to.includes('/') && !(children[dir] ?? []).some(e => e.name === to)
    let finalPath = path
    if (valid) {
      await api.renameEntry(dir, nameOf(path), to)
      finalPath = joinPath(dir, to)
      onRenamed(path, finalPath)
      setSelected(finalPath)
      refresh()
    }
    if (isNew) onOpenFile(finalPath)
  }

  const remove = async (path: string) => {
    await api.deleteEntry(parentOf(path), nameOf(path))
    onDeleted(path)
    setSelected(null)
    refresh()
  }

  const rowMenu = (e: MouseEvent, path: string, entry: FileEntry) => {
    setSelected(path)
    const folder = entry.kind === 'folder'
    const head: MenuItem[] = folder
      ? [
          { label: 'New File', icon: FilePlus, onSelect: () => void create('file', path) },
          { label: 'New Folder', icon: FolderPlus, onSelect: () => void create('folder', path) },
        ]
      : [{ label: 'Open', icon: FilePen, disabled: !isTextFile(entry.name), onSelect: () => onOpenFile(path) }]
    show(e, [
      ...head,
      'separator',
      { label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: () => setRenaming({ path, isNew: false }) },
      {
        label: 'Delete',
        confirm: 'Click Again to Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => void remove(path),
      },
      'separator',
      { label: 'Copy Path', icon: Copy, onSelect: () => void copyText(path) },
    ])
  }

  const backgroundMenu = (e: MouseEvent) => {
    if (e.defaultPrevented) return
    setSelected(null)
    show(e, [
      { label: 'New File', icon: FilePlus, onSelect: () => void create('file', root) },
      { label: 'New Folder', icon: FolderPlus, onSelect: () => void create('folder', root) },
      'separator',
      { label: 'Refresh', icon: RefreshCw, onSelect: refresh },
      { label: 'Collapse All', icon: ChevronsDownUp, onSelect: () => onExpandedChange(new Set([root])) },
      'separator',
      { label: 'Open Folder…', icon: FolderOpen, onSelect: onOpenFolder },
      { label: 'Close Folder', icon: FolderX, onSelect: onCloseFolder },
      { label: 'Copy Path', icon: Copy, onSelect: () => void copyText(root) },
    ])
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming || !selected || selected === root) return
    if (e.key === 'F2') {
      e.preventDefault()
      setRenaming({ path: selected, isNew: false })
    }
  }

  const rows: { path: string; entry: FileEntry; depth: number }[] = []
  const walk = (dir: string, depth: number) => {
    for (const entry of children[dir] ?? []) {
      const path = joinPath(dir, entry.name)
      rows.push({ path, entry, depth })
      if (entry.kind === 'folder' && expanded.has(path)) walk(path, depth + 1)
    }
  }
  if (expanded.has(root)) walk(root, 1)

  return (
    <>
      <div className="ce-side-head">
        EXPLORER
        <div className="ce-side-actions">
          <button onClick={() => void create('file')} aria-label="New file" title="New File">
            <FilePlus size={15} />
          </button>
          <button onClick={() => void create('folder')} aria-label="New folder" title="New Folder">
            <FolderPlus size={15} />
          </button>
          <button onClick={refresh} aria-label="Refresh" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => onExpandedChange(new Set([root]))} aria-label="Collapse all" title="Collapse All">
            <ChevronsDownUp size={15} />
          </button>
        </div>
      </div>

      <div className="ce-tree" role="tree" tabIndex={0} onKeyDown={onKeyDown} onContextMenu={backgroundMenu}>
        <div
          className={`ce-row ce-root ${selected === root ? 'is-selected' : ''}`}
          role="treeitem"
          aria-expanded={expanded.has(root)}
          title={root}
          onClick={() => {
            setSelected(root)
            toggle(root)
          }}
        >
          <span className="ce-chev">{expanded.has(root) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          {displayName(root)}
        </div>

        {rows.map(({ path, entry, depth }) => {
          const folder = entry.kind === 'folder'
          const open = folder && expanded.has(path)
          return (
            <div
              key={path}
              role="treeitem"
              aria-expanded={folder ? open : undefined}
              className={`ce-row ${selected === path ? 'is-selected' : ''} ${activePath === path ? 'is-active' : ''} ${
                !folder && !isTextFile(entry.name) ? 'is-binary' : ''
              }`}
              style={{ paddingLeft: 4 + depth * 12 }}
              title={path}
              onClick={() => {
                setSelected(path)
                if (folder) toggle(path)
                else if (isTextFile(entry.name)) onOpenFile(path)
              }}
              onContextMenu={e => rowMenu(e, path, entry)}
            >
              <span className="ce-chev">
                {folder && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
              </span>
              <FileTypeIcon name={entry.name} folder={folder} open={open} />
              {renaming?.path === path ? (
                <RenameField name={entry.name} onDone={value => void finishRename(path, value)} />
              ) : (
                <span className="ce-row-name">{entry.name}</span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
