import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../../api'
import { FileTypeIcon } from './FileTypeIcon'

const MAX_RESULTS = 30
const RECENT_BOOST = 5
const NAME_BOOST = 10

import { displayName, nameOf, parentOf, relativeTo } from '../../lib/paths'
import { tr } from '../../lib/i18n'

/**
 * Subsequence match like VS Code's Quick Open: every query character must appear in order.
 * Consecutive characters and characters at word starts score higher.
 */
function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const lower = text.toLowerCase()
  const hits: number[] = []
  let score = 0
  let from = 0
  for (const ch of query.toLowerCase()) {
    const at = lower.indexOf(ch, from)
    if (at < 0) return null
    score += hits.length && hits[hits.length - 1] === at - 1 ? 3 : 1
    if (at === 0 || '/._- '.includes(lower[at - 1])) score += 2
    hits.push(at)
    from = at + 1
  }
  return { score: score - text.length * 0.01, hits }
}

interface Result {
  path: string
  /** Matched character positions in the file name, for highlighting. */
  hits: number[]
}

function rank(query: string, tree: string[], recent: string[], root: string): Result[] {
  const q = query.replace(/\s+/g, '')
  if (!q) {
    const known = new Set(tree)
    const recentInTree = recent.filter(p => known.has(p))
    return (recentInTree.length ? recentInTree : tree).slice(0, 12).map(path => ({ path, hits: [] }))
  }
  const scored: (Result & { score: number })[] = []
  for (const path of tree) {
    const boost = recent.includes(path) ? RECENT_BOOST : 0
    const inName = fuzzy(q, nameOf(path))
    if (inName) {
      scored.push({ path, hits: inName.hits, score: inName.score + NAME_BOOST + boost })
      continue
    }
    const inPath = fuzzy(q, relativeTo(root, path))
    if (inPath) scored.push({ path, hits: [], score: inPath.score + boost })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
}

function Highlighted({ text, hits }: { text: string; hits: number[] }) {
  const marked = new Set(hits)
  return (
    <>
      {[...text].map((ch, i) => (marked.has(i) ? <b key={i}>{ch}</b> : ch))}
    </>
  )
}

interface Props {
  root: string
  recent: string[]
  onOpen: (path: string) => void
  onClose: () => void
}

/** Go to File (Ctrl/⌘+P): fuzzy-find any file in the workspace by name. */
export function QuickOpen({ root, recent, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [tree, setTree] = useState<string[] | null>(null)
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void api.listTree(root).then(list => alive && setTree(list))
    return () => {
      alive = false
    }
  }, [root])

  const results = useMemo(() => rank(query, tree ?? [], recent, root), [query, tree, recent, root])
  const active = Math.min(selected, results.length - 1)
  const showingRecent = !query.trim() && recent.some(p => tree?.includes(p))

  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (path: string) => {
    onOpen(path)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[active]) choose(results[active].path)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="ce-quick-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="ce-quick" role="dialog" aria-label={tr('Go to File')}>
        <input
          autoFocus
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={tr('Search files by name in {0}', displayName(root))}
          aria-label={tr('Search files by name')}
          spellCheck={false}
        />
        <div className="ce-quick-list" role="listbox" ref={listRef}>
          {!query.trim() && results.length > 0 && (
            <div className="ce-quick-group">{showingRecent ? tr('recently opened') : 'files'}</div>
          )}
          {results.map((result, i) => {
            const name = nameOf(result.path)
            const dir = relativeTo(root, parentOf(result.path))
            return (
              <div
                key={result.path}
                role="option"
                aria-selected={i === active}
                className={`ce-quick-row ${i === active ? 'is-selected' : ''}`}
                onPointerMove={() => setSelected(i)}
                onClick={() => choose(result.path)}
                title={result.path}
              >
                <FileTypeIcon name={name} size={15} />
                <span className="ce-quick-name">
                  <Highlighted text={name} hits={result.hits} />
                </span>
                <span className="ce-quick-dir">{dir}</span>
              </div>
            )
          })}
          {tree && results.length === 0 && <p className="ce-quick-empty">{tr('No matching files')}</p>}
          {!tree && <p className="ce-quick-empty">{tr('Loading files…')}</p>}
        </div>
      </div>
    </div>
  )
}
