import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { SearchMatch } from '../../api/types'
import { displayName, nameOf, parentOf } from '../../lib/paths'
import { FileTypeIcon } from './FileTypeIcon'

const DEBOUNCE_MS = 180
const CONTEXT_CHARS = 24

interface Props {
  /** Workspace folder to search in. */
  root: string
  onOpenMatch: (path: string, line: number, column: number) => void
}

/** Preview of a matching line, trimmed so the match stays visible, with the match highlighted. */
function Preview({ text, column, length }: { text: string; column: number; length: number }) {
  const at = column - 1
  const start = at > CONTEXT_CHARS ? at - CONTEXT_CHARS : 0
  const before = text.slice(start, at).trimStart()
  return (
    <span className="ce-match-text">
      {start > 0 && '…'}
      {before}
      <mark>{text.slice(at, at + length)}</mark>
      {text.slice(at + length)}
    </span>
  )
}

export function SearchPanel({ root, onOpenMatch }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[] | null>(null)
  const q = query.trim()

  useEffect(() => {
    if (!q) return
    let alive = true
    const timer = setTimeout(() => void api.searchFiles(q, root).then(r => alive && setResults(r)), DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q, root])

  const shown = q ? results : null
  const groups = new Map<string, SearchMatch[]>()
  for (const match of shown ?? []) groups.set(match.path, [...(groups.get(match.path) ?? []), match])

  return (
    <>
      <div className="ce-side-head">SEARCH</div>
      <div className="ce-search">
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search in ${displayName(root)}`}
          aria-label="Search files"
          spellCheck={false}
        />
        {shown && (
          <p className="ce-search-summary">
            {shown.length === 0
              ? 'No results found.'
              : `${shown.length} result${shown.length === 1 ? '' : 's'} in ${groups.size} file${groups.size === 1 ? '' : 's'}`}
          </p>
        )}
      </div>
      <div className="ce-tree">
        {[...groups].map(([path, matches]) => {
          const name = nameOf(path)
          return (
            <div key={path} className="ce-search-group">
              <div className="ce-row ce-search-file" title={path} onClick={() => onOpenMatch(path, matches[0].line, matches[0].column)}>
                <FileTypeIcon name={name} />
                <span className="ce-row-name">{name}</span>
                <span className="ce-search-dir">{parentOf(path)}</span>
                <span className="ce-badge">{matches.length}</span>
              </div>
              {matches.map(match => (
                <div
                  key={match.line}
                  className="ce-row ce-match"
                  title={`${path}:${match.line}`}
                  onClick={() => onOpenMatch(path, match.line, match.column)}
                >
                  <Preview text={match.preview} column={match.column} length={q.length} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
