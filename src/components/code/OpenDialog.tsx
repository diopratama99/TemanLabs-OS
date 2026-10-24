import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronRight, Search, Upload } from 'lucide-react'
import { api } from '../../api'
import type { FileEntry } from '../../api/types'
import { usePlaces } from '../../hooks/usePlaces'
import { useAuth } from '../../lib/auth'
import { isTextFile } from '../../lib/fileTypes'
import { formatBytes } from '../../lib/format'
import { ancestors, displayName, joinPath, parentOf } from '../../lib/paths'
import { FileTypeIcon } from './FileTypeIcon'
import { tr } from '../../lib/i18n'

interface Props {
  mode: 'file' | 'folder'
  startDir: string
  /** A text file (file mode) or a folder (folder mode) was chosen. */
  onOpen: (path: string) => void
  /** Files picked from the user's own computer, to upload into `dir` (file mode only; no button without it). */
  onUpload?: (dir: string, files: File[]) => void
  onCancel: () => void
  /** Which files can be chosen (file mode); text files by default. */
  accept?: (entry: FileEntry) => boolean
  title?: string
}

/** Open File / Open Folder panel, as a sheet, browsing the server's files. */
export function OpenDialog({ mode, startDir, onOpen, onUpload, onCancel, accept = e => isTextFile(e.name), title: heading }: Props) {
  const { root } = useAuth()
  const { favorites, locations } = usePlaces()
  const [dir, setDir] = useState(startDir)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    api
      .listFiles(dir)
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
  }, [dir])

  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const go = (next: string) => {
    setDir(next)
    setSelected(null)
    setFilter('')
  }

  const usable = (entry: FileEntry) => entry.kind === 'folder' || (mode === 'file' && accept(entry))
  const q = filter.trim().toLowerCase()
  const visible = entries.filter(e => e.name.toLowerCase().includes(q))
  const selectedEntry = visible.find(e => e.name === selected)

  const activate = (entry: FileEntry) => {
    if (entry.kind === 'folder') go(joinPath(dir, entry.name))
    else if (usable(entry)) onOpen(joinPath(dir, entry.name))
  }
  const confirm = () => {
    if (mode === 'folder') onOpen(selectedEntry?.kind === 'folder' ? joinPath(dir, selectedEntry.name) : dir)
    else if (selectedEntry) activate(selectedEntry)
  }
  const canConfirm = mode === 'folder' || (!!selectedEntry && usable(selectedEntry))

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (canConfirm) confirm()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const index = visible.findIndex(v => v.name === selected)
      const next = e.key === 'ArrowDown' ? Math.min(index + 1, visible.length - 1) : Math.max(index - 1, 0)
      if (visible[next]) setSelected(visible[next].name)
    }
  }

  // Breadcrumbs from the server's root down to the current folder.
  const crumbs = ancestors(dir)
    .filter(c => root === '/' || c.path === root || c.path.startsWith(`${root}/`))
    .map(c => ({ label: c.name, path: c.path }))

  const title = heading ?? (mode === 'file' ? tr('Open File') : tr('Open Folder'))

  return (
    <div className="ce-sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="ce-open" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <aside className="ce-open-side">
          {[
            { title: tr('Favorites'), places: favorites },
            { title: tr('Locations'), places: locations },
          ]
            .filter(group => group.places.length > 0)
            .map(group => (
              <div key={group.title}>
                <div className="sidebar-group">{group.title}</div>
                {group.places.map(({ path, label, icon: Icon }) => (
                  <button
                    key={path}
                    className={`sidebar-item ${dir === path ? 'is-active' : ''}`}
                    onClick={() => go(path)}
                    title={path}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            ))}
        </aside>

        <div className="ce-open-main">
          <div className="ce-open-head">
            <strong>{title}</strong>
            <label className="sidebar-search ce-open-filter">
              <Search size={13} />
              <input autoFocus value={filter} onChange={e => setFilter(e.target.value)} placeholder={tr('Filter')} />
            </label>
          </div>
          <div className="ce-open-bar">
            <button
              className="icon-btn"
              onClick={() => go(parentOf(dir))}
              disabled={dir === root}
              aria-label={tr('Enclosing folder')}
              title={tr('Enclosing Folder')}
            >
              <ArrowUp size={16} />
            </button>
            <div className="ce-open-crumbs">
              {crumbs.map((crumb, i) => (
                <span key={crumb.path} className="ce-crumb">
                  <button onClick={() => go(crumb.path)} disabled={i === crumbs.length - 1}>
                    {crumb.label}
                  </button>
                  {i < crumbs.length - 1 && <ChevronRight size={12} />}
                </span>
              ))}
            </div>
          </div>

          <div className="ce-open-list" role="listbox" ref={listRef}>
            {visible.map(entry => (
              <div
                key={entry.name}
                role="option"
                aria-selected={entry.name === selected}
                aria-disabled={!usable(entry)}
                className={`ce-open-row ${entry.name === selected ? 'is-selected' : ''} ${usable(entry) ? '' : 'is-disabled'}`}
                onClick={() => usable(entry) && setSelected(entry.name)}
                onDoubleClick={() => activate(entry)}
              >
                <FileTypeIcon name={entry.name} folder={entry.kind === 'folder'} size={16} />
                <span className="ce-open-name">{entry.name}</span>
                <span className="ce-open-meta">{entry.kind === 'folder' ? '—' : formatBytes(entry.size ?? 0)}</span>
                <span className="ce-open-meta">{entry.modified}</span>
              </div>
            ))}
            {visible.length === 0 && (
              <p className="ce-open-empty">
                {loadError ? tr('Can’t open this folder: {0}', loadError) : q ? tr('No matches.') : tr('This folder is empty.')}
              </p>
            )}
          </div>

          <div className="ce-open-foot">
            {mode === 'file' ? (
              onUpload && (
                <>
                  <button className="btn" onClick={() => uploadRef.current?.click()}>
                    <Upload size={13} /> {tr('From This Computer…')}
                  </button>
                  <input
                    ref={uploadRef}
                    type="file"
                    multiple
                    hidden
                    onChange={e => {
                      const picked = [...(e.target.files ?? [])]
                      e.target.value = ''
                      if (picked.length) onUpload(dir, picked)
                    }}
                  />
                </>
              )
            ) : (
              <span className="ce-open-hint">
                {tr('Opens')} {selectedEntry?.kind === 'folder' ? selectedEntry.name : displayName(dir)} {tr('as the workspace')}
              </span>
            )}
            <span className="ce-status-grow" />
            <button className="btn" onClick={onCancel}>
              {tr('Cancel')}
            </button>
            <button className="btn btn-primary" onClick={confirm} disabled={!canConfirm}>
              {tr('Open')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
