import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Lock, Plus, Shield, Trash2, Unlock, X } from 'lucide-react'
import { api } from '../../api'
import type { SystemAccount, SystemGroup } from '../../api/types'
import { Switch } from '../Switch'
import { tr } from '../../lib/i18n'

// Groups worth offering by name: what they let an account do.
const GROUP_HINTS: Record<string, string> = {
  docker: tr('Run Docker without sudo'),
  sudo: tr('Administrator'),
  video: tr('Use the GPU (hardware transcoding)'),
  render: tr('Use the GPU (hardware transcoding)'),
  plugdev: tr('Use removable drives'),
  adm: tr('Read system logs'),
  users: tr('Shared files of all users'),
}

/** Users & Groups: the server's login accounts, admin rights, groups and passwords. */
export function UsersSection() {
  const [users, setUsers] = useState<SystemAccount[]>([])
  const [groups, setGroups] = useState<SystemGroup[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.accounts()
      setUsers(res.users)
      setGroups(res.groups)
      setSelected(s => s ?? res.users.find(u => u.uid >= 1000)?.name ?? res.users[0]?.name ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const change = async (name: string, c: Parameters<typeof api.changeAccount>[1]) => {
    setError(null)
    try {
      await api.changeAccount(name, c)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const user = users.find(u => u.name === selected)
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <div className="group ug-list">
        {users.map(u => (
          <button key={u.name} className={`ug-user ${u.name === selected ? 'is-active' : ''}`} onClick={() => setSelected(u.name)}>
            <span className="ug-avatar">{(u.fullName || u.name)[0].toUpperCase()}</span>
            <span className="ug-name">
              <strong>{u.fullName || u.name}</strong>
              <small>
                {u.admin ? tr('Admin') : tr('Standard')}
                {u.locked ? tr(' · locked') : ''}
                {u.noLogin ? tr(' · sharing only') : ''}
              </small>
            </span>
          </button>
        ))}
        <button className="ug-user ug-add" onClick={() => setAdding(true)}>
          <span className="ug-avatar">
            <Plus size={16} />
          </span>
          <span className="ug-name">
            <strong>{tr('Add User…')}</strong>
          </span>
        </button>
      </div>

      {adding && <AddUser onClose={() => setAdding(false)} onAdded={() => void load().then(() => setAdding(false))} />}

      {user && !adding && <UserDetail key={user.name} user={user} groups={groups} onChange={c => change(user.name, c)} onDeleted={() => { setSelected(null); void load() }} />}
    </>
  )
}

function UserDetail({
  user,
  groups,
  onChange,
  onDeleted,
}: {
  user: SystemAccount
  groups: SystemGroup[]
  onChange: (c: Parameters<typeof api.changeAccount>[1]) => Promise<void>
  onDeleted: () => void
}) {
  const [fullName, setFullName] = useState(user.fullName ?? '')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [addGroup, setAddGroup] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removeHome, setRemoveHome] = useState(false)
  const others = groups.filter(g => !user.groups.includes(g.name) && g.gid >= 4 && !/^(nogroup|systemd-|_)/.test(g.name))
  const suggested = others.filter(g => GROUP_HINTS[g.name])

  return (
    <>
      <div className="group">
        <div className="row">
          <span>{tr('Full name')}</span>
          <input
            className="ug-input"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            onBlur={() => fullName !== (user.fullName ?? '') && void onChange({ action: 'fullName', fullName })}
          />
        </div>
        <div className="row">
          <span>{tr('User name')}</span>
          <span className="row-value">
            {user.name} {tr('· UID')} {user.uid}
          </span>
        </div>
        <div className="row">
          <span>{tr('Home')}</span>
          <span className="row-value">{user.home}</span>
        </div>
        <div className="row">
          <span>
            <Shield size={13} /> {tr('Administrator (sudo)')}
          </span>
          <Switch
            checked={user.admin}
            disabled={user.protected || user.uid === 0}
            onChange={admin => void onChange({ action: 'admin', admin })}
            label={tr('Administrator')}
          />
        </div>
        <div className="row">
          <span>{user.locked ? <Lock size={13} /> : <Unlock size={13} />} {tr('Can sign in')}</span>
          <Switch
            checked={!user.locked}
            disabled={user.protected}
            onChange={on => void onChange({ action: on ? 'unlock' : 'lock' })}
            label={tr('Can sign in')}
          />
        </div>
      </div>

      <h4 className="du-heading">{tr('Password')}</h4>
      <form
        className="group ug-password"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void onChange({ action: 'password', password }).then(() => {
            setPassword('')
            setMessage(tr('Password changed.'))
          })
        }}
      >
        <KeyRound size={14} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={tr('New login password (6+ characters)')} />
        <button className="btn" disabled={password.length < 6}>
          {tr('Change')}
        </button>
        {message && <small className="form-ok">{message}</small>}
      </form>

      <h4 className="du-heading">{tr('Groups')}</h4>
      <div className="group ug-groups">
        {user.groups.map(g => (
          <span key={g} className="ug-chip" title={GROUP_HINTS[g]}>
            {g}
            {g !== user.name && !(g === 'sudo' && user.protected) && (
              <button onClick={() => void onChange({ action: 'removeGroup', group: g })} aria-label={tr('Remove from {0}', g)}>
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        <select value={addGroup} onChange={e => setAddGroup(e.target.value)} aria-label={tr('Add to group')}>
          <option value="">{tr('Add to group…')}</option>
          {suggested.map(g => (
            <option key={g.name} value={g.name}>
              {g.name} — {GROUP_HINTS[g.name]}
            </option>
          ))}
          {others
            .filter(g => !GROUP_HINTS[g.name])
            .map(g => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
        </select>
        <button
          className="btn"
          disabled={!addGroup}
          onClick={() => void onChange({ action: 'addGroup', group: addGroup }).then(() => setAddGroup(''))}
        >
          {tr('Add')}
        </button>
      </div>
      <p className="pane-note">{tr('Group changes apply the next time the user signs in.')}</p>

      {!user.protected && (
        <div className="du-actions">
          <label className="pv-toggle">
            <input type="checkbox" checked={removeHome} onChange={e => setRemoveHome(e.target.checked)} /> {tr('Also delete')} {user.home}
          </label>
          <button
            className={`btn ${confirmDelete ? 'btn-danger' : ''}`}
            onClick={() => (confirmDelete ? void api.deleteAccount(user.name, removeHome).then(onDeleted) : setConfirmDelete(true))}
            onBlur={() => setConfirmDelete(false)}
          >
            <Trash2 size={13} /> {confirmDelete ? tr('Click Again to Delete') : tr('Delete User…')}
          </button>
        </div>
      )}
    </>
  )
}

function AddUser({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ name: '', fullName: '', password: '', admin: false })
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="group ug-new"
      onSubmit={e => {
        e.preventDefault()
        setError(null)
        api.createAccount(form).then(onAdded, (err: Error) => setError(err.message))
      }}
    >
      <div className="row">
        <span>{tr('Full name')}</span>
        <input className="ug-input" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} autoFocus />
      </div>
      <div className="row">
        <span>{tr('User name')}</span>
        <input
          className="ug-input"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
          placeholder="lowercase"
        />
      </div>
      <div className="row">
        <span>{tr('Password')}</span>
        <input className="ug-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
      </div>
      <div className="row">
        <span>{tr('Administrator (sudo)')}</span>
        <Switch checked={form.admin} onChange={admin => setForm({ ...form, admin })} label={tr('Administrator')} />
      </div>
      <div className="row ug-new-actions">
        {error ? <span className="form-error">{error}</span> : <span className="form-hint">{tr('Creates a login with a home folder.')}</span>}
        <span>
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>{' '}
          <button className="btn btn-primary" disabled={!form.name || form.password.length < 6}>
            {tr('Create User')}
          </button>
        </span>
      </div>
    </form>
  )
}
