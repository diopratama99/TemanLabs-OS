import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BookMarked,
  Copy,
  Pencil,
  Plus,
  Save,
  Search,
  SquareTerminal,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api } from '../api'
import type { CommandApp, CommandBook, CommandsInfo, SavedCommand } from '../api/types'
import { copyText } from '../lib/clipboard'
import { language, tr } from '../lib/i18n'
import { blanks, CATEGORIES, fill, LIBRARY, LIBRARY_TOOLS, PARAMS, type Text } from '../lib/commandLibrary'
import { indexDocs, rank } from '../lib/commandSearch'

const L = (t: Text) => (language === 'id' ? t[1] : t[0])

// Blanks a name from the search can fill ("restart nginx" → service = nginx).
const NAME_BLANKS = new Set(['service', 'container', 'user', 'package', 'program', 'name', 'host', 'image', 'pod', 'deployment', 'svc', 'remote', 'group', 'disk', 'partition'])

interface Entry {
  /** Unique, and the id favourites are kept by. */
  key: string
  source: 'library' | 'app' | 'mine' | 'history'
  /** A library category, or one of the book's own sections. */
  category: string
  /** App commands: the app's name. */
  group?: string
  title: string
  /** The other language's title, for search. */
  otherTitle?: string
  command: string
  note?: string
  keywords: string
  danger?: boolean
  /** The program isn't installed: how to get it. */
  missing?: { tool: string; pkg: string }
  saved?: SavedCommand
}

type Section = 'all' | 'favorites' | 'mine' | 'history' | 'apps' | string

// Docker and kubectl get sudo when the user can't run them without it.
function adapt(command: string, info: CommandsInfo) {
  let c = command
  if (!info.dockerGroup) c = c.replace(/(^|&& |; |\| )docker /g, '$1sudo docker ')
  if (info.tools.k3s) c = c.replace(/(^|&& |; |\| )kubectl /g, '$1sudo kubectl ')
  return c
}

const q = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

// Commands for the apps installed on this server, made from what the server knows about them.
function appCommands(app: CommandApp, info: CommandsInfo): Entry[] {
  const out: Entry[] = []
  const add = (id: string, title: Text, command: string, keywords: string, danger?: boolean) =>
    out.push({
      key: `app:${app.id}:${id}`,
      source: 'app',
      category: 'apps',
      group: app.name,
      title: L(title).replace('{0}', app.name),
      otherTitle: (language === 'id' ? title[0] : title[1]).replace('{0}', app.name),
      command: adapt(command, info),
      keywords: `${app.name} ${app.id} ${keywords}`,
      danger,
    })
  const first = app.containers?.[0]
  // -f only when the compose file isn't the one docker compose finds in the folder by itself.
  const usual = (f: string) => /\/(docker-)?compose\.ya?ml$/.test(f) && f.slice(0, f.lastIndexOf('/')) === app.dir
  const files = (app.files ?? []).every(usual) ? '' : (app.files ?? []).map(f => `-f ${q(f)}`).join(' ')
  if (app.project) {
    const compose = `docker compose -p ${q(app.project)}`
    add('logs', ['{0}: watch the log', '{0}: pantau log'], `${compose} logs -f --tail 100`, 'log logs error pantau')
    add('restart', ['Restart {0}', 'Restart {0}'], `${compose} restart`, 'restart ulang')
    add('stop', ['Stop {0}', 'Hentikan {0}'], `${compose} stop`, 'stop hentikan matikan')
    if (app.dir) {
      add('update', ['Update {0} to the newest version', 'Update {0} ke versi terbaru'], `cd ${q(app.dir)} && docker compose${files ? ` ${files}` : ''} pull && docker compose${files ? ` ${files}` : ''} up -d`, 'update pull versi baru terbaru upgrade')
      if (app.files?.[0]) add('edit', ['Edit {0}’s compose file', 'Edit file compose {0}'], `nano ${q(app.files[0])}`, 'edit compose yaml config konfigurasi')
      add('folder', ['Go to {0}’s folder', 'Masuk ke folder {0}'], `cd ${q(app.dir)}`, 'folder cd direktori data')
    }
  } else if (first) {
    add('logs', ['{0}: watch the log', '{0}: pantau log'], `docker logs -f --tail 100 ${q(first)}`, 'log logs error pantau')
    add('restart', ['Restart {0}', 'Restart {0}'], `docker restart ${q(first)}`, 'restart ulang')
  }
  if (first) {
    add('shell', ['Open a shell inside {0}', 'Buka shell di dalam {0}'], `docker exec -it ${q(first)} sh`, 'shell bash masuk exec terminal console')
    add('stats', ['{0}: CPU and memory', '{0}: CPU dan memori'], `docker stats ${app.containers!.map(q).join(' ')}`, 'stats cpu memory ram pemakaian')
    add('inspect', ['{0}: settings, mounts and IP', '{0}: pengaturan, mount, dan IP'], `docker inspect ${q(first)} | less`, 'inspect ip mount env volume')
  }
  if (app.unit) {
    add('status', ['Is {0} running?', 'Apakah {0} berjalan?'], `systemctl status ${q(app.unit)}`, 'status jalan running')
    add('restart-unit', ['Restart {0}', 'Restart {0}'], `sudo systemctl restart ${q(app.unit)}`, 'restart ulang')
    add('journal', ['{0}: watch the log', '{0}: pantau log'], `journalctl -u ${q(app.unit)} -f`, 'log logs journal')
  }
  return out
}

function buildEntries(info: CommandsInfo): Entry[] {
  const hidden = new Set(CATEGORIES.filter(c => c.tool && info.tools[c.tool] === false).map(c => c.id))
  const library: Entry[] = LIBRARY.filter(c => !hidden.has(c.cat)).map(c => ({
    key: c.id,
    source: 'library',
    category: c.cat,
    title: L(c.title),
    otherTitle: language === 'id' ? c.title[0] : c.title[1],
    command: adapt(c.command, info),
    note: c.note && L(c.note),
    keywords: `${c.keywords} ${c.note ? `${c.note[0]} ${c.note[1]}` : ''}`,
    danger: c.danger,
    missing: c.tool && info.tools[c.tool] === false ? { tool: c.tool, pkg: c.pkg ?? c.tool } : undefined,
  }))
  const mine: Entry[] = info.book.custom.map(c => ({
    key: `mine:${c.id}`,
    source: 'mine',
    category: 'mine',
    title: c.title,
    command: c.command,
    note: c.note,
    keywords: c.keywords ?? '',
    saved: c,
  }))
  const history: Entry[] = info.history.map((h, i) => ({ key: `history:${i}`, source: 'history', category: 'history', title: h, command: h, keywords: '' }))
  return [...mine, ...info.apps.flatMap(a => appCommands(a, info)), ...library, ...history]
}

interface Props {
  /** Puts a command on the Terminal's prompt (it isn't run until the user presses Enter). */
  onRun: (command: string) => void
  onClose: () => void
}

/**
 * Commands: a searchable book of terminal commands for this server and its apps, in a panel
 * beside the Terminal (it was an app of its own; its old name opens the panel).
 */
export function Commands({ onRun, onClose }: Props) {
  const [info, setInfo] = useState<CommandsInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  // Values typed into blanks, shared by name (a service typed once is there for the next command).
  const [values, setValues] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<SavedCommand | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [suggest, setSuggest] = useState<{ service?: string[]; user?: string[] }>({})
  const searchRef = useRef<HTMLInputElement>(null)

  const load = () =>
    api.commandsInfo(LIBRARY_TOOLS).then(
      i => {
        setInfo(i)
        setError(null)
      },
      (err: Error) => setError(err.message),
    )
  useEffect(() => {
    void load()
    searchRef.current?.focus()
  }, [])

  const entries = useMemo(() => (info ? buildEntries(info) : []), [info])
  const index = useMemo(
    () =>
      indexDocs(entries, e => ({
        title: `${e.title} ${e.otherTitle ?? ''}`,
        command: e.command,
        keywords: `${e.keywords} ${e.group ?? ''}`,
        note: e.note,
        category: categoryLabel(e.category),
      })),
    [entries],
  )
  const favorites = new Set(info?.book.favorites ?? [])

  const ranked = useMemo(() => (query.trim() ? rank(index, query) : []), [index, query])
  const shown = useMemo(() => {
    if (query.trim()) return ranked.map(r => r.item)
    switch (section) {
      case 'all':
        return entries.filter(e => e.source !== 'history')
      case 'favorites':
        return entries.filter(e => favorites.has(e.key))
      default:
        return entries.filter(e => e.category === section)
    }
  }, [query, section, entries, ranked, info?.book.favorites])

  // The best match takes the name the search left over as its blank's value.
  useEffect(() => {
    const top = ranked[0]
    if (!top || top.leftover.length === 0) return
    const blank = blanks(top.item.command).find(b => !b.value && NAME_BLANKS.has(b.name))
    if (blank) setValues(v => ({ ...v, [blank.name]: top.leftover.join(' ') }))
  }, [ranked])

  const saveBook = async (book: CommandBook) => {
    setInfo(i => (i ? { ...i, book } : i))
    try {
      await api.saveCommandBook(book)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      void load()
    }
  }
  const toggleStar = (key: string) => {
    if (!info) return
    const fav = info.book.favorites
    void saveBook({ ...info.book, favorites: fav.includes(key) ? fav.filter(f => f !== key) : [...fav, key] })
  }
  const saveCommand = (c: SavedCommand) => {
    if (!info) return
    const custom = info.book.custom.some(x => x.id === c.id) ? info.book.custom.map(x => (x.id === c.id ? c : x)) : [c, ...info.book.custom]
    void saveBook({ ...info.book, custom })
    setEditing(null)
  }
  const deleteCommand = (id: string) => {
    if (!info) return
    void saveBook({ custom: info.book.custom.filter(x => x.id !== id), favorites: info.book.favorites.filter(f => f !== `mine:${id}`) })
    setEditing(null)
  }
  const newCommand = (command = '') => setEditing({ id: '', title: '', command })

  // Suggestions for blanks, fetched the first time a card needs them.
  const needSuggestions = (kinds: Set<string>) => {
    if (kinds.has('service') && !suggest.service)
      void api.listServices().then(
        list => setSuggest(s => ({ ...s, service: list.map(x => x.unit.replace(/\.service$/, '')) })),
        () => setSuggest(s => ({ ...s, service: [] })),
      )
    if (kinds.has('user') && !suggest.user)
      void api.accounts().then(
        a => setSuggest(s => ({ ...s, user: a.users.filter(u => u.uid >= 1000 && u.uid < 65534).map(u => u.name) })),
        () => setSuggest(s => ({ ...s, user: [] })),
      )
  }
  const containers = useMemo(() => [...new Set(info?.apps.flatMap(a => a.containers ?? []) ?? [])], [info])

  const use = (entry: Entry, how: 'copy' | 'run') => {
    const empty = blanks(entry.command).filter(b => !b.value && !values[b.name]?.trim())
    if (empty.length) {
      setOpen(entry.key)
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-blank="${entry.key}:${empty[0].name}"]`)?.focus())
      return
    }
    const text = fill(entry.command, values)
    if (how === 'copy') {
      void copyText(text)
      setCopied(entry.key)
      setTimeout(() => setCopied(c => (c === entry.key ? null : c)), 1500)
    } else onRun(text)
  }

  const count = (s: Section) =>
    s === 'all'
      ? entries.filter(e => e.source !== 'history').length
      : s === 'favorites'
        ? entries.filter(e => favorites.has(e.key)).length
        : entries.filter(e => e.category === s).length

  const option = (id: Section, label: string) => (
    <option key={id} value={id}>
      {label} ({count(id)})
    </option>
  )
  const installedTools = CATEGORIES.filter(c => c.group === 'tools' && (!c.tool || info?.tools[c.tool] !== false))

  return (
    <aside className="cm-panel" aria-label={tr('Commands')}>
      <header className="cm-panel-head">
        <BookMarked size={15} />
        <strong>{tr('Commands')}</strong>
        <span className="tb-spacer" />
        <button className="icon-btn" onClick={() => newCommand()} aria-label={tr('New Command')} title={tr('New Command')}>
          <Plus size={15} />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label={tr('Close')} title={tr('Close')}>
          <X size={15} />
        </button>
      </header>
      <div className="cm-panel-find">
        <label className="sidebar-search">
          <Search size={13} />
          <input
            ref={searchRef}
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setOpen(null)
            }}
            placeholder={tr('What do you want to do?')}
            aria-label={tr('Search commands')}
          />
          {query && (
            <button className="cm-clear" onClick={() => setQuery('')} aria-label={tr('Clear')}>
              <X size={12} />
            </button>
          )}
        </label>
        <select
          value={section}
          disabled={!!query.trim()}
          onChange={e => {
            setSection(e.target.value)
            setOpen(null)
          }}
          aria-label={tr('Library')}
        >
          <optgroup label={tr('Library')}>
            {option('all', tr('All Commands'))}
            {option('favorites', tr('Favorites'))}
            {option('mine', tr('My Commands'))}
            {(info?.history.length ?? 0) > 0 && option('history', tr('History'))}
            {(info?.apps.length ?? 0) > 0 && option('apps', tr('Installed Apps'))}
          </optgroup>
          <optgroup label="Ubuntu">{CATEGORIES.filter(c => c.group === 'ubuntu').map(c => option(c.id, L(c.label)))}</optgroup>
          {installedTools.length > 0 && <optgroup label={tr('Apps & Tools')}>{installedTools.map(c => option(c.id, L(c.label)))}</optgroup>}
        </select>
      </div>

      <div className="cm-panel-body">

        {error && <p className="form-error">{error}</p>}
        {!info && !error && <p className="am-empty">{tr('Loading…')}</p>}
        {query.trim() && shown.length > 0 && <p className="cm-hint">{tr('Best matches for “{0}”', query.trim())}</p>}

        <div className="cm-list">
          {shown.map(entry => (
            <CommandCard
              key={entry.key}
              entry={entry}
              showCategory={!!query.trim() || section === 'all' || section === 'favorites'}
              open={open === entry.key}
              onToggle={() => {
                const next = open === entry.key ? null : entry.key
                setOpen(next)
                if (next) needSuggestions(new Set(blanks(entry.command).map(b => PARAMS[b.name]?.kind ?? 'text')))
              }}
              values={values}
              onValue={(name, value) => setValues(v => ({ ...v, [name]: value }))}
              suggestions={{ service: suggest.service, user: suggest.user, container: containers }}
              starred={favorites.has(entry.key)}
              copied={copied === entry.key}
              onStar={() => toggleStar(entry.key)}
              onCopy={() => use(entry, 'copy')}
              onRun={() => use(entry, 'run')}
              onEdit={entry.saved ? () => setEditing(entry.saved!) : undefined}
              onSave={entry.source === 'history' ? () => newCommand(entry.command) : undefined}
            />
          ))}
          {info && shown.length === 0 && (
            <div className="cm-empty">
              <BookMarked size={28} />
              <p>
                {query.trim()
                  ? tr('Nothing matches “{0}”. Try other words, or save it as your own command.', query.trim())
                  : section === 'favorites'
                    ? tr('Star a command to keep it here.')
                    : section === 'mine'
                      ? tr('Commands you save yourself show up here.')
                      : tr('Nothing here yet.')}
              </p>
              {(query.trim() || section === 'mine') && (
                <button className="btn" onClick={() => newCommand()}>
                  <Plus size={13} /> {tr('New Command')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && <CommandSheet initial={editing} onSave={saveCommand} onDelete={editing.id ? () => deleteCommand(editing.id) : undefined} onClose={() => setEditing(null)} />}
    </aside>
  )
}

function categoryLabel(id: string) {
  const c = CATEGORIES.find(x => x.id === id)
  if (c) return L(c.label)
  return { mine: tr('My Commands'), history: tr('History'), apps: tr('Installed Apps'), favorites: tr('Favorites') }[id] ?? id
}

// The command with its blanks shown as fields' values or ‹names›.
function CommandText({ command, values }: { command: string; values: Record<string, string> }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of command.matchAll(/\{\{([a-z][a-z0-9_]*)(?::([^}]*))?\}\}/g)) {
    parts.push(command.slice(last, m.index))
    const value = values[m[1]]?.trim() || m[2]
    parts.push(
      <span key={m.index} className={`cm-blank ${value ? 'is-filled' : ''}`}>
        {value || `‹${L(PARAMS[m[1]]?.label ?? [m[1], m[1]]).toLowerCase()}›`}
      </span>,
    )
    last = m.index! + m[0].length
  }
  parts.push(command.slice(last))
  return <code className="cm-code">{parts}</code>
}

interface CardProps {
  entry: Entry
  showCategory: boolean
  open: boolean
  onToggle: () => void
  values: Record<string, string>
  onValue: (name: string, value: string) => void
  suggestions: { service?: string[]; user?: string[]; container?: string[] }
  starred: boolean
  copied: boolean
  onStar: () => void
  onCopy: () => void
  onRun: () => void
  onEdit?: () => void
  onSave?: () => void
}

function CommandCard({ entry, showCategory, open, onToggle, values, onValue, suggestions, starred, copied, onStar, onCopy, onRun, onEdit, onSave }: CardProps) {
  const fields = blanks(entry.command)
  const history = entry.source === 'history'
  return (
    <div className={`cm-card ${open ? 'is-open' : ''} ${entry.danger ? 'is-danger' : ''}`}>
      <div className="cm-card-main" onClick={onToggle} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && onToggle()}>
        <div className="cm-card-head">
          {!history && <strong className="cm-title">{entry.title}</strong>}
          {showCategory && !history && <span className="cm-chip">{entry.group ?? categoryLabel(entry.category)}</span>}
          {entry.danger && (
            <span className="cm-chip is-danger">
              <TriangleAlert size={11} /> {tr('Careful')}
            </span>
          )}
        </div>
        <CommandText command={entry.command} values={values} />
        {entry.note && <small className="cm-note">{entry.note}</small>}
        {entry.missing && (
          <small className="cm-note is-missing">
            {tr('Not installed yet:')} <code>sudo apt install {entry.missing.pkg}</code>
          </small>
        )}
      </div>
      <div className="cm-actions">
        {!history && (
          <button className={`icon-btn ${starred ? 'is-on' : ''}`} onClick={onStar} aria-label={starred ? tr('Remove from Favorites') : tr('Add to Favorites')} title={starred ? tr('Remove from Favorites') : tr('Add to Favorites')}>
            <Star size={14} fill={starred ? 'currentColor' : 'none'} />
          </button>
        )}
        {onEdit && (
          <button className="icon-btn" onClick={onEdit} aria-label={tr('Edit')} title={tr('Edit')}>
            <Pencil size={14} />
          </button>
        )}
        {onSave && (
          <button className="icon-btn" onClick={onSave} aria-label={tr('Save as My Command')} title={tr('Save as My Command')}>
            <Save size={14} />
          </button>
        )}
        <button className="icon-btn" onClick={onCopy} aria-label={tr('Copy')} title={copied ? tr('Copied') : tr('Copy')}>
          <Copy size={14} />
        </button>
        <button className="pill-btn cm-run" onClick={onRun} title={tr('Put it in the Terminal (you press Enter)')}>
          <SquareTerminal size={13} /> {copied ? tr('Copied') : tr('Run')}
        </button>
      </div>
      {open && fields.length > 0 && (
        <div className="cm-fields">
          {fields.map(f => {
            const p = PARAMS[f.name]
            const list = p?.kind === 'service' ? suggestions.service : p?.kind === 'user' ? suggestions.user : p?.kind === 'container' ? suggestions.container : undefined
            const listId = list?.length ? `cm-${entry.key}-${f.name}` : undefined
            return (
              <label key={f.name} className="cm-field">
                <span>{L(p?.label ?? [f.name, f.name])}</span>
                <input
                  data-blank={`${entry.key}:${f.name}`}
                  value={values[f.name] ?? ''}
                  placeholder={f.value ?? p?.example ?? ''}
                  list={listId}
                  spellCheck={false}
                  onChange={e => onValue(f.name, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && onRun()}
                />
                {listId && (
                  <datalist id={listId}>
                    {list!.slice(0, 300).map(v => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CommandSheet({ initial, onSave, onDelete, onClose }: { initial: SavedCommand; onSave: (c: SavedCommand) => void; onDelete?: () => void; onClose: () => void }) {
  const [c, setC] = useState(initial)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ok = c.title.trim() && c.command.trim()
  const save = () => ok && onSave({ ...c, id: c.id || `c${Date.now().toString(36)}`, title: c.title.trim(), command: c.command.trim() })
  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci cm-sheet" role="dialog" aria-label={initial.id ? tr('Edit Command') : tr('New Command')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{initial.id ? tr('Edit Command') : tr('New Command')}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body cm-form">
          <label>
            <span>{tr('What it does')}</span>
            <input autoFocus value={c.title} onChange={e => setC({ ...c, title: e.target.value })} placeholder={tr('Back up the photos to the HDD')} />
          </label>
          <label>
            <span>{tr('Command')}</span>
            <textarea
              value={c.command}
              rows={3}
              spellCheck={false}
              onChange={e => setC({ ...c, command: e.target.value })}
              placeholder="rsync -avh /DATA/Gallery/ /mnt/HDD_DATA/Gallery/"
            />
            <small>{tr('Write {{name}} for a blank to fill in each time, or {{name:default}} with a default.')}</small>
          </label>
          <label>
            <span>{tr('Note')}</span>
            <input value={c.note ?? ''} onChange={e => setC({ ...c, note: e.target.value })} placeholder={tr('Optional')} />
          </label>
          <label>
            <span>{tr('Search words')}</span>
            <input value={c.keywords ?? ''} onChange={e => setC({ ...c, keywords: e.target.value })} placeholder={tr('Other words you might search with')} />
          </label>
        </div>
        <footer className="ci-foot">
          {onDelete && (
            <button className={`btn ${confirmDelete ? 'btn-danger' : ''}`} onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)}>
              <Trash2 size={13} /> {confirmDelete ? tr('Click Again to Delete') : tr('Delete')}
            </button>
          )}
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!ok}>
            {tr('Save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
