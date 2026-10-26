import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  Copy,
  Folder,
  FolderOpen,
  KeyRound,
  Lock,
  Monitor,
  Pencil,
  Plus,
  RotateCw,
  Share2,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { SmbInfo, SmbSession, SmbShare, SmbShareSpec, SystemStats } from '../api/types'
import { Switch } from '../components/Switch'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { usePresence } from '../hooks/usePresence'
import { displayName, joinPath, parentOf } from '../lib/paths'
import { DATA_ROOT } from '../lib/places'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { tr } from '../lib/i18n'

type Section = 'shares' | 'users' | 'connections'

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'shares', label: tr('Shared Folders'), icon: Share2 },
  { id: 'users', label: tr('Users'), icon: Users },
  { id: 'connections', label: tr('Connections'), icon: Monitor },
]

const STATUS_POLL_MS = 5000
const SHEET_EXIT_MS = 220

/** Asks the window to open the New Share sheet for a folder (from Files). */
export interface ShareRequest {
  path: string
  nonce: number
}

interface Props {
  stats: SystemStats | null
  request: ShareRequest | null
}

function accessLabel(s: SmbShare) {
  if (s.guest) return s.readOnly ? 'Everyone · read only' : 'Everyone · read & write'
  return `${(s.users ?? []).join(', ') || 'Nobody'} · ${s.readOnly ? 'read only' : 'read & write'}`
}

/** File Sharing: Samba shares, users and who's connected, without smb.conf or smbpasswd. */
export function Sharing({ stats, request }: Props) {
  const [section, setSection] = useState<Section>('shares')
  const [info, setInfo] = useState<SmbInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SmbSession[]>([])
  const [openFiles, setOpenFiles] = useState(0)
  // Share being edited: an existing one, or a new one (possibly prefilled from Files).
  const [editing, setEditing] = useState<{ share: SmbShareSpec; original?: string } | null>(null)
  const [userSheet, setUserSheet] = useState<{ name?: string } | null>(null)
  const { show } = useContextMenu()

  const refresh = useCallback(async () => {
    try {
      // An older server sends null for an empty list.
      const next = await api.smbInfo()
      setInfo({ ...next, shares: next.shares ?? [], users: next.users ?? [], people: next.people ?? [] })
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const load = () =>
      api.smbStatus().then(
        s => {
          setSessions((s.sessions ?? []).map(se => ({ ...se, shares: se.shares ?? [] })))
          setOpenFiles(s.openFiles ?? 0)
        },
        () => {},
      )
    void load()
    const timer = setInterval(load, STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const newShare = (path = DATA_ROOT): SmbShareSpec => ({
    name: displayName(path) || 'Share',
    path,
    comment: '',
    readOnly: false,
    guest: false,
    users: info?.users.filter(u => !u.disabled).map(u => u.name).slice(0, 1) ?? [],
    browseable: true,
  })

  // "Share Folder…" from Files.
  useEffect(() => {
    if (!request) return
    setSection('shares')
    setEditing({ share: newShare(request.path) })
  }, [request])

  const lan = stats?.addresses.lan?.ipv4
  const tailscale = stats?.addresses.tailscale?.ipv4
  const networks = [
    { label: tr('Local network'), ip: lan },
    { label: tr('Tailscale'), ip: tailscale },
  ].filter((n): n is { label: string; ip: string } => !!n.ip)
  const host = networks[0]?.ip ?? location.hostname

  const shareItems = (s: SmbShare) => [
    { label: tr('Copy \\\\{0}\\{1}', host, s.name), icon: Copy, onSelect: () => void copyText(`\\\\${host}\\${s.name}`) },
    { label: tr('Copy smb://{0}/{1}', host, s.name), icon: Copy, onSelect: () => void copyText(`smb://${host}/${encodeURI(s.name)}`) },
    'separator' as const,
    {
      label: tr('Edit…'),
      icon: Pencil,
      disabled: s.source !== 'temanlabs',
      onSelect: () => setEditing({ share: { ...s }, original: s.name }),
    },
    {
      label: tr('Stop Sharing'),
      icon: Trash2,
      danger: true,
      confirm: tr('Click Again to Stop Sharing'),
      disabled: s.source !== 'temanlabs',
      onSelect: () => void api.deleteShare(s.name).then(refresh),
    },
  ]

  useAppMenus(() => [
    {
      label: tr('File'),
      items: [
        { label: tr('New Shared Folder…'), icon: Plus, onSelect: () => setEditing({ share: newShare() }) },
        { label: tr('New User…'), icon: Users, onSelect: () => setUserSheet({}) },
      ],
    },
    {
      label: tr('View'),
      items: [
        ...SECTIONS.map(s => ({ label: s.label, icon: s.icon, checked: section === s.id, onSelect: () => setSection(s.id) })),
        'separator',
        { label: tr('Refresh'), icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
  ])

  const current = SECTIONS.find(s => s.id === section)!
  const shares = info?.shares ?? []
  const own = shares.filter(s => s.source === 'temanlabs')
  const others = shares.filter(s => s.source !== 'temanlabs')

  const shareRow = (s: SmbShare) => (
    <div key={s.name} className="sh-row" onContextMenu={e => show(e, shareItems(s))} onDoubleClick={() => s.source === 'temanlabs' && setEditing({ share: { ...s }, original: s.name })}>
      <span className="sh-icon">
        <Folder size={22} />
      </span>
      <span className="sh-main">
        <strong>
          {s.name}
          {!s.guest && <Lock size={11} />}
        </strong>
        <small>{s.path}</small>
      </span>
      <span className="sh-access">{accessLabel(s)}</span>
      <button className="pill-btn" onClick={() => void copyText(`\\\\${host}\\${s.name}`)} title={tr('Copy \\\\{0}\\{1}', host, s.name)}>
        <Copy size={12} /> {tr('Address')}
      </button>
      {s.source === 'temanlabs' ? (
        <button className="icon-btn" onClick={() => setEditing({ share: { ...s }, original: s.name })} aria-label={tr('Edit {0}', s.name)} title={tr('Edit')}>
          <Pencil size={14} />
        </button>
      ) : (
        <span className="sh-source" title={tr('CasaOS rewrites its own shares; change them in CasaOS.')}>
          {s.source === 'casaos' ? tr('CasaOS') : 'smb.conf'}
        </span>
      )}
    </div>
  )

  return (
    <div className="split">
      <aside className="sidebar">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`sidebar-item ${section === id ? 'is-active' : ''}`} onClick={() => setSection(id)}>
            <Icon size={15} /> {label}
            {id === 'connections' && sessions.length > 0 && <span className="sidebar-badge">{sessions.length}</span>}
          </button>
        ))}
        <div className="sh-service">
          <i className={info?.running ? 'is-on' : ''} />
          <span>
            {info ? (info.running ? tr('Sharing is on') : info.installed ? tr('Samba is stopped') : tr('Samba isn’t installed')) : '…'}
            {info?.version && <small>{tr('Samba')} {info.version.replace('-Ubuntu', '')}</small>}
          </span>
          <button className="icon-btn" onClick={() => void api.restartSmb().then(refresh)} title={tr('Restart Samba')} aria-label={tr('Restart Samba')}>
            <RotateCw size={13} />
          </button>
        </div>
      </aside>

      <div className="pane sh-pane">
        <WindowToolbar>
          <ToolbarTitle title={current.label} subtitle={section === 'shares' ? tr('{0} shared folders', shares.length) : undefined} />
          <span className="tb-spacer" />
          {section !== 'connections' && (
            <div className="tb-group">
              <button
                className="tb-btn"
                onClick={() => (section === 'users' ? setUserSheet({}) : setEditing({ share: newShare() }))}
                aria-label={section === 'users' ? tr('New user') : tr('New shared folder')}
                title={section === 'users' ? tr('New User') : tr('New Shared Folder')}
              >
                <Plus size={17} />
              </button>
            </div>
          )}
        </WindowToolbar>

        {loadError && <p className="form-error">{tr('Couldn’t read the Samba setup:')} {loadError}</p>}

        {section === 'shares' && (
          <>
            <div className="sh-connect">
              <strong>{tr('Connect from another computer')}</strong>
              <span>{tr('Windows: type the address in File Explorer. Mac: Finder → Go → Connect to Server.')}</span>
              {networks.map(n => (
                <span key={n.ip}>
                  {n.label}: <code>\\{n.ip}</code> or <code>smb://{n.ip}</code>
                </span>
              ))}
            </div>
            <div className="group sh-list">
              {own.length === 0 && (
                <p className="sh-empty">
                  {tr('No folders shared from TemanLabsOS yet. Click + or right-click a folder in Files → Share Folder….')}
                </p>
              )}
              {own.map(shareRow)}
            </div>
            {others.length > 0 && (
              <>
                <h4 className="sh-heading">{tr('Shared by CasaOS')}</h4>
                <p className="pane-note">{tr('CasaOS writes these itself; change or remove them in CasaOS.')}</p>
                <div className="group sh-list">{others.map(shareRow)}</div>
              </>
            )}
          </>
        )}

        {section === 'users' && (
          <>
            <p className="pane-note">
              {tr('People who can open protected shared folders. Their Samba password is separate from their login password.')}
            </p>
            <div className="group sh-list">
              {(info?.users ?? []).map(u => (
                <div key={u.name} className={`sh-row ${u.disabled ? 'is-off' : ''}`}>
                  <span className="sh-icon is-user">{(u.fullName || u.name)[0].toUpperCase()}</span>
                  <span className="sh-main">
                    <strong>{u.fullName || u.name}</strong>
                    <small>{u.name}</small>
                  </span>
                  <span className="sh-access">{u.disabled ? tr('Can’t connect') : tr('Can connect')}</span>
                  <Switch
                    checked={!u.disabled}
                    onChange={on => void api.smbUserAction(u.name, on ? 'enable' : 'disable').then(refresh)}
                    label={tr('Allow {0}', u.name)}
                  />
                  <button className="icon-btn" onClick={() => setUserSheet({ name: u.name })} title={tr('Change password')} aria-label={tr('Change password of {0}', u.name)}>
                    <KeyRound size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={e =>
                      show(e, [
                        {
                          label: tr('Remove {0} from Samba', u.name),
                          icon: Trash2,
                          danger: true,
                          confirm: tr('Click Again to Remove'),
                          onSelect: () => void api.smbUserAction(u.name, 'remove').then(refresh),
                        },
                      ])
                    }
                    title={tr('Remove')}
                    aria-label={tr('Remove {0}', u.name)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {info && info.users.length === 0 && <p className="sh-empty">{tr('No Samba users yet. Guest shares work without one.')}</p>}
            </div>
          </>
        )}

        {section === 'connections' && (
          <>
            <p className="pane-note">
              {tr('Computers using shared folders right now')}{openFiles ? tr(' · {0} open file{1}', openFiles, openFiles > 1 ? 's' : '') : ''}.
            </p>
            <div className="group sh-list">
              {sessions.length === 0 && <p className="sh-empty">{tr('Nobody is connected.')}</p>}
              {sessions.map(se => (
                <div key={`${se.machine}-${se.user}-${se.since}`} className="sh-row">
                  <span className="sh-icon">
                    <Monitor size={20} />
                  </span>
                  <span className="sh-main">
                    <strong>{se.machine}</strong>
                    <small>
                      {se.user} · {se.protocol.replace('_', '.')}
                    </small>
                  </span>
                  <span className="sh-access">{se.shares.join(', ') || tr('No folder open')}</span>
                  <span className="sh-since">{se.since ? new Date(se.since).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <ShareSheet
          open={!!editing}
          initial={editing}
          users={(info?.users ?? []).map(u => u.name)}
          onClose={() => setEditing(null)}
          onSave={async (spec, original) => {
            await api.saveShare(spec, original)
            setEditing(null)
            await refresh()
          }}
        />
        <UserSheet
          open={!!userSheet}
          name={userSheet?.name}
          onClose={() => setUserSheet(null)}
          onSave={async (name, password, existing) => {
            if (existing) await api.smbUserAction(name, 'password', password)
            else await api.addSmbUser(name, password)
            setUserSheet(null)
            await refresh()
          }}
        />
      </div>
    </div>
  )
}

// ----- Sheets -----

interface ShareSheetProps {
  open: boolean
  initial: { share: SmbShareSpec; original?: string } | null
  users: string[]
  onClose: () => void
  onSave: (spec: SmbShareSpec, original?: string) => Promise<void>
}

function ShareSheet({ open, initial, users, onClose, onSave }: ShareSheetProps) {
  const { mounted, closing } = usePresence(open, SHEET_EXIT_MS)
  const [last, setLast] = useState(initial)
  if (initial && initial !== last) setLast(initial)
  if (!mounted || !last) return null
  return <ShareForm key={last.original ?? last.share.path} closing={closing} initial={last} users={users} onClose={onClose} onSave={onSave} />
}

function ShareForm({
  closing,
  initial,
  users,
  onClose,
  onSave,
}: Omit<ShareSheetProps, 'open' | 'initial'> & { closing: boolean; initial: { share: SmbShareSpec; original?: string } }) {
  const [form, setForm] = useState<SmbShareSpec>(initial.share)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<SmbShareSpec>) => setForm(f => ({ ...f, ...patch }))
  const chosen = new Set(form.users ?? [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({ ...form, users: form.guest ? [] : [...chosen] }, initial.original)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`sheet-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet sh-sheet ci" onSubmit={e => void submit(e)}>
        <header className="ci-head">
          <strong>{initial.original ? tr('Edit “{0}”', initial.original) : tr('New Shared Folder')}</strong>
        </header>
        <div className="ci-body">
          <label className="ci-field">
            <span className="ci-label">{tr('Folder')}</span>
            <div className="sh-path">
              <input value={form.path} onChange={e => set({ path: e.target.value })} spellCheck={false} />
              <button type="button" className="btn" onClick={() => setPicking(p => !p)}>
                <FolderOpen size={13} /> {tr('Choose…')}
              </button>
            </div>
          </label>
          {picking && (
            <FolderPicker
              start={form.path}
              onPick={path => {
                set({ path, name: initial.original ? form.name : displayName(path) || form.name })
                setPicking(false)
              }}
            />
          )}
          <label className="ci-field">
            <span className="ci-label">{tr('Share name')}</span>
            <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder={tr('e.g. Photos')} />
            <small>{tr('What other computers see, as in \\\\server\\')}{form.name || tr('Name')}</small>
          </label>
          <label className="ci-field">
            <span className="ci-label">{tr('Description')}</span>
            <input value={form.comment ?? ''} onChange={e => set({ comment: e.target.value })} placeholder={tr('Optional')} />
          </label>

          <div className="ci-field">
            <span className="ci-label">{tr('Who can connect')}</span>
            <div className="segmented sh-who">
              <button type="button" className={form.guest ? 'is-active' : ''} onClick={() => set({ guest: true })}>
                {tr('Everyone (no password)')}
              </button>
              <button type="button" className={!form.guest ? 'is-active' : ''} onClick={() => set({ guest: false })}>
                {tr('Only these users')}
              </button>
            </div>
          </div>
          {!form.guest && (
            <div className="sh-users">
              {users.length === 0 && <small>{tr('Add a user in Users first.')}</small>}
              {users.map(u => (
                <label key={u} className="sh-user">
                  <input
                    type="checkbox"
                    checked={chosen.has(u)}
                    onChange={e => {
                      const next = new Set(chosen)
                      if (e.target.checked) next.add(u)
                      else next.delete(u)
                      set({ users: [...next] })
                    }}
                  />
                  {u}
                </label>
              ))}
            </div>
          )}
          <div className="ci-toggle">
            <span>
              {tr('Read only')}
              <small>{tr('People can open and copy files, but not change or delete them.')}</small>
            </span>
            <Switch checked={form.readOnly} onChange={readOnly => set({ readOnly })} label={tr('Read only')} />
          </div>
          <div className="ci-toggle">
            <span>
              {tr('Show in network browsing')}
              <small>{tr('Off hides it from the list; people can still connect by name.')}</small>
            </span>
            <Switch checked={form.browseable} onChange={browseable => set({ browseable })} label={tr('Browseable')} />
          </div>
        </div>
        <footer className="ci-foot">
          {error ? <p className="form-error">{error}</p> : <p className="form-hint">{tr('Checked with Samba before it’s applied.')}</p>}
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {initial.original ? tr('Save') : tr('Share')}
          </button>
        </footer>
      </form>
    </div>
  )
}

/** A small folder browser for choosing what to share. */
function FolderPicker({ start, onPick }: { start: string; onPick: (path: string) => void }) {
  const [dir, setDir] = useState(start || DATA_ROOT)
  const [folders, setFolders] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api.listFiles(dir).then(
      list => {
        if (!alive) return
        setFolders(list.filter(e => e.kind === 'folder').map(e => e.name))
        setError(null)
      },
      err => alive && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
    }
  }, [dir])
  return (
    <div className="sh-picker">
      <div className="sh-picker-head">
        <button type="button" className="icon-btn" onClick={() => setDir(parentOf(dir))} disabled={dir === '/'} aria-label={tr('Up')}>
          <ArrowUp size={14} />
        </button>
        <span>{dir}</span>
        <button type="button" className="btn btn-primary" onClick={() => onPick(dir)}>
          {tr('Use This Folder')}
        </button>
      </div>
      <div className="sh-picker-list">
        {error && <p className="form-error">{error}</p>}
        {folders.map(name => (
          <button type="button" key={name} onClick={() => setDir(joinPath(dir, name))}>
            <Folder size={14} /> {name}
          </button>
        ))}
        {!error && folders.length === 0 && <small>{tr('No folders inside.')}</small>}
      </div>
    </div>
  )
}

function UserSheet({
  open,
  name,
  onClose,
  onSave,
}: {
  open: boolean
  name?: string
  onClose: () => void
  onSave: (name: string, password: string, existing: boolean) => Promise<void>
}) {
  const { mounted, closing } = usePresence(open, SHEET_EXIT_MS)
  const [last, setLast] = useState<string | undefined>(name)
  if (open && name !== last) setLast(name)
  if (!mounted) return null
  return <UserForm key={last ?? 'new'} closing={closing} name={last} onClose={onClose} onSave={onSave} />
}

function UserForm({
  closing,
  name,
  onClose,
  onSave,
}: {
  closing: boolean
  name?: string
  onClose: () => void
  onSave: (name: string, password: string, existing: boolean) => Promise<void>
}) {
  const [user, setUser] = useState(name ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError(tr('The passwords don’t match.'))
      return
    }
    try {
      await onSave(user.trim(), password, !!name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <div className={`sheet-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet sh-sheet sh-user-sheet ci" onSubmit={e => void submit(e)}>
        <header className="ci-head">
          <strong>{name ? tr('Password for {0}', name) : tr('New User')}</strong>
        </header>
        <div className="ci-body">
          {!name && (
            <label className="ci-field">
              <span className="ci-label">{tr('User name')}</span>
              <input value={user} onChange={e => setUser(e.target.value.toLowerCase())} placeholder={tr('e.g. family')} autoFocus spellCheck={false} />
              <small>{tr('Lowercase letters and numbers. A new name gets a sharing-only account (no shell login).')}</small>
            </label>
          )}
          <label className="ci-field">
            <span className="ci-label">{tr('Password')}</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus={!!name} />
          </label>
          <label className="ci-field">
            <span className="ci-label">{tr('Confirm password')}</span>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
        </div>
        <footer className="ci-foot">
          {error ? <p className="form-error">{error}</p> : <p className="form-hint">{tr('Used when connecting to protected shares.')}</p>}
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!user || !password}>
            {name ? tr('Change Password') : tr('Add User')}
          </button>
        </footer>
      </form>
    </div>
  )
}
