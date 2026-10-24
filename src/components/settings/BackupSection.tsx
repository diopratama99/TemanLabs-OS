import { useCallback, useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api } from '../../api'
import type { BackupApp, BackupDestination, BackupFile, BackupPlan, BackupPlanSettings, BackupVersion, BackupsInfo, Job } from '../../api/types'
import { copyText } from '../../lib/clipboard'
import { formatBytes, formatFileDate } from '../../lib/format'
import { tr } from '../../lib/i18n'
import { GroupTitle } from './DesktopSections'
import { useJob } from '../../hooks/useJob'

const WEEKDAYS = [tr('Sunday'), tr('Monday'), tr('Tuesday'), tr('Wednesday'), tr('Thursday'), tr('Friday'), tr('Saturday')]

// Backups of the apps and chosen folders, made with restic (see server/backups.go).

const destLabel = (dest: string) => (dest.startsWith('rclone:') ? dest.slice(7).replace(':', ' → ') : dest)

function scheduleText(p: BackupPlanSettings) {
  if (p.schedule === 'daily') return tr('Every day at {0}', p.time)
  if (p.schedule === 'weekly') return tr('Every {0} at {1}', WEEKDAYS[p.weekday], p.time)
  return tr('Only when you click Back Up Now')
}

function statusOf(p: BackupPlan) {
  if (p.running) return { level: 'running', text: tr('Backing up now…') }
  if (!p.lastRun) return { level: 'none', text: tr('Not backed up yet') }
  if (!p.lastOk) return { level: 'error', text: tr('Last backup failed {0}', formatFileDate(p.lastRun)) }
  return { level: p.lastWarning ? 'warn' : 'ok', text: tr('Last backup {0}', formatFileDate(p.lastRun)) }
}

type View = { kind: 'list' } | { kind: 'plan'; id: string } | { kind: 'key' }

/** Settings → Backup: the plans, one plan's page, and the recovery key. */
/** sub is the page open inside: "plan:<id>" or "key" (Settings keeps it in its history). */
export function BackupSection({ sub, onSub }: { sub: string | null; onSub: (sub: string | null) => void }) {
  const [info, setInfo] = useState<BackupsInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const view: View = sub === 'key' ? { kind: 'key' } : sub?.startsWith('plan:') ? { kind: 'plan', id: sub.slice(5) } : { kind: 'list' }
  const setView = (v: View) => onSub(v.kind === 'key' ? 'key' : v.kind === 'plan' ? `plan:${v.id}` : null)
  const [editing, setEditing] = useState<BackupPlan | 'new' | null>(null)
  const [installJob, setInstallJob] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await api.backups()
      setInfo(next)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  const running = info?.plans.some(p => p.running)
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), running ? 2000 : 15000)
    return () => clearInterval(timer)
  }, [load, running])
  const install = useJob(installJob, () => {
    setInstallJob(null)
    void load()
  })

  const plan = view.kind === 'plan' ? (info?.plans.find(p => p.id === view.id) ?? null) : null
  // A plan removed (here or elsewhere) goes back to the list.
  useEffect(() => {
    if (info && view.kind === 'plan' && !plan) onSub(null)
  }, [info, plan, view.kind])
  const back = (
    <button className="bk-back" onClick={() => setView({ kind: 'list' })}>
      <ChevronLeft size={14} /> {tr('Backup')}
    </button>
  )

  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {!info ? (
        <p className="pane-note">{tr('Loading…')}</p>
      ) : view.kind === 'key' ? (
        <>
          {back}
          <RecoveryKeyPane />
        </>
      ) : plan ? (
        <>
          {back}
          <PlanPane key={plan.id} plan={plan} onChanged={load} onEdit={() => setEditing(plan)} />
        </>
      ) : !info.installed ? (
        <div className="bk-hero">
          <HardDrive size={44} strokeWidth={1.3} />
          <h2>{tr('Back up your apps and files')}</h2>
          <p>
            {tr(
              'Copies of your apps’ settings and data, and the folders you choose, go to another disk or a cloud drive on a schedule. Only changes are copied after the first time, everything is encrypted, and older versions are kept so you can go back.',
            )}
          </p>
          <button
            className="btn btn-primary"
            disabled={!!install?.running || info.installing}
            onClick={() => void api.installBackups().then(r => setInstallJob(r.job), e => setError(e instanceof Error ? e.message : String(e)))}
          >
            {install?.running || info.installing ? <LoaderCircle size={14} className="spin" /> : null} {tr('Install Backup Engine')}
          </button>
          {install?.running && <code className="bk-log-line">{install.log.at(-1)}</code>}
          {install && !install.running && install.exit !== 0 && <p className="form-error">{install.log.slice(-3).join('\n')}</p>}
          <small>{tr('Installs restic, a well-known open-source backup tool, from Ubuntu.')}</small>
        </div>
      ) : (
        <>
          {info.plans.length === 0 ? (
            <div className="bk-hero">
              <HardDrive size={44} strokeWidth={1.3} />
              <h2>{tr('No backups yet')}</h2>
              <p>{tr('Set up a backup of your apps’ settings and data. It takes a minute, and runs by itself from then on.')}</p>
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                {tr('Set Up Backup…')}
              </button>
            </div>
          ) : (
            <>
              <div className="group set-links">
                {info.plans.map(p => {
                  const st = statusOf(p)
                  return (
                    <button key={p.id} className="row set-link" onClick={() => setView({ kind: 'plan', id: p.id })}>
                      <span className="set-link-label bk-plan-label">
                        <span className={`bk-plan-icon is-${st.level}`}>{p.dest.startsWith('rclone:') ? <Cloud size={14} /> : <HardDrive size={14} />}</span>
                        <span>
                          {p.name}
                          <small>{st.text}</small>
                        </span>
                      </span>
                      {st.level === 'running' && <LoaderCircle size={13} className="spin" />}
                      <ChevronRight size={15} className="set-chevron" />
                    </button>
                  )
                })}
              </div>
              <div className="set-open">
                <button className="btn" onClick={() => setEditing('new')}>
                  <Plus size={12} /> {tr('New Backup…')}
                </button>
              </div>
            </>
          )}
          <GroupTitle>{tr('Security')}</GroupTitle>
          <div className="group set-links">
            <button className="row set-link" onClick={() => setView({ kind: 'key' })}>
              <span className="set-link-label">
                <KeyRound size={15} /> {tr('Recovery Key')}
              </span>
              <ChevronRight size={15} className="set-chevron" />
            </button>
          </div>
        </>
      )}

      {editing && (
        <PlanEditor
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={p => {
            setEditing(null)
            setView({ kind: 'plan', id: p.id })
            void load()
          }}
        />
      )}
    </>
  )
}

function PlanPane({ plan, onChanged, onEdit }: { plan: BackupPlan; onChanged: () => void; onEdit: () => void }) {
  const [versions, setVersions] = useState<BackupVersion[] | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<BackupVersion | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apps, setApps] = useState<BackupApp[] | null>(null)
  const job = useJob(plan.running ? `backup-${plan.id}` : null)

  const loadVersions = useCallback(() => {
    api.backupVersions(plan.id).then(
      v => {
        setVersions(v)
        setVersionsError(null)
      },
      e => setVersionsError(e instanceof Error ? e.message : String(e)),
    )
  }, [plan.id])
  useEffect(loadVersions, [loadVersions, plan.lastRun])
  useEffect(() => {
    if (plan.apps) api.backupApps().then(setApps, () => setApps([]))
  }, [plan.apps])

  const act = (fn: () => Promise<unknown>) =>
    void fn().then(onChanged, e => setError(e instanceof Error ? e.message : String(e)))
  const st = statusOf(plan)
  const cloud = plan.dest.startsWith('rclone:')

  return (
    <>
      <div className={`group bk-status is-${st.level}`}>
        <div className="bk-status-icon">{cloud ? <Cloud size={26} /> : <HardDrive size={26} />}</div>
        <div className="bk-status-text">
          <strong>{st.text}</strong>
          {plan.running ? (
            <small>{job?.log.at(-1) ?? tr('Starting…')}</small>
          ) : plan.lastRun && plan.lastOk ? (
            <small>{tr('{0} new · {1} in all · {2} files', formatBytes(plan.lastAdded ?? 0), formatBytes(plan.lastTotal ?? 0), (plan.lastFiles ?? 0).toLocaleString())}</small>
          ) : null}
          {!plan.running && plan.nextRun && <small>{tr('Next backup {0}', formatFileDate(plan.nextRun))}</small>}
        </div>
        {!plan.running && (
          <button className="btn" onClick={onEdit}>
            <Pencil size={12} /> {tr('Edit…')}
          </button>
        )}
        {plan.running ? (
          <button className="btn" onClick={() => act(() => api.stopBackup(plan.id))}>
            <Square size={12} /> {tr('Stop')}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => act(() => api.runBackup(plan.id))}>
            <Play size={12} /> {tr('Back Up Now')}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!plan.running && plan.lastError && <p className="bk-alert is-error">{plan.lastError}</p>}
      {!plan.running && plan.lastWarning && <p className="bk-alert is-warn">{plan.lastWarning}</p>}
      {plan.sameDisk && (
        <p className="bk-alert is-warn">
          <TriangleAlert size={13} /> {tr('The backups are on the same disk as the apps’ data, so they won’t help if that disk fails. Choose another disk or a cloud drive.')}
        </p>
      )}

      <div className="group">
        <div className="row">
          <span>{tr('Backs up')}</span>
          <span className="value bk-what">
            {plan.apps && <span>{apps ? tr('Settings and data of {0} apps', apps.length) : tr('Apps’ settings and data')}</span>}
            {(plan.paths ?? []).map(p => (
              <span key={p}>{p}</span>
            ))}
          </span>
        </div>
        <div className="row">
          <span>{tr('To')}</span>
          <span className="value">
            {destLabel(plan.dest)}
            {plan.destFree ? ` · ${tr('{0} free', formatBytes(plan.destFree))}` : ''}
          </span>
        </div>
        <div className="row">
          <span>{tr('When')}</span>
          <span className="value">{scheduleText(plan)}</span>
        </div>
        <div className="row">
          <span>{tr('Keeps')}</span>
          <span className="value">{tr('The newest {0} versions', plan.keep)}</span>
        </div>
      </div>
      {plan.apps && !!apps?.length && <p className="pane-note">{apps.map(a => a.name).join(', ')}</p>}

      <h4 className="bk-heading">{tr('Versions')}</h4>
      <div className="group">
        {versionsError ? (
          <div className="row">
            <span className="form-error">{versionsError}</span>
          </div>
        ) : !versions ? (
          <div className="row">
            <span>{tr('Loading…')}</span>
          </div>
        ) : versions.length === 0 ? (
          <div className="row">
            <span>{tr('No versions yet. Back up once to make the first.')}</span>
          </div>
        ) : (
          versions.map(v => (
            <div key={v.id} className="row bk-version">
              <span>
                {formatFileDate(v.time)}
                <small>{v.mine ? (v.paths ?? []).length === 1 ? v.paths?.[0] : tr('{0} folders', (v.paths ?? []).length) : tr('From another backup ({0})', v.host)}</small>
              </span>
              <button className="btn" onClick={() => setRestoring(v)} disabled={plan.running}>
                <RotateCcw size={12} /> {tr('Restore…')}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="bk-footer">
        <button
          className={`btn ${confirmDelete ? 'btn-danger' : ''}`}
          disabled={plan.running}
          onBlur={() => setConfirmDelete(false)}
          onClick={() => (confirmDelete ? act(() => api.deleteBackup(plan.id)) : setConfirmDelete(true))}
        >
          <Trash2 size={12} /> {confirmDelete ? tr('Click Again to Remove') : tr('Remove Backup Plan…')}
        </button>
        <small>{tr('Versions already saved stay at {0}.', destLabel(plan.dest))}</small>
      </div>

      {restoring && <RestoreSheet plan={plan} version={restoring} onClose={() => setRestoring(null)} />}
    </>
  )
}

const DEFAULT_PLAN: BackupPlanSettings = { name: tr('Apps'), apps: true, paths: [], dest: '', schedule: 'daily', time: '03:00', weekday: 0, keep: 14, pauseApps: true }

function PlanEditor({ plan, onClose, onSaved }: { plan: BackupPlan | null; onClose: () => void; onSaved: (p: BackupPlan) => void }) {
  const [form, setForm] = useState<BackupPlanSettings>(() => (plan ? { ...plan, paths: [...(plan.paths ?? [])] } : DEFAULT_PLAN))
  const [dests, setDests] = useState<BackupDestination[]>([])
  const [custom, setCustom] = useState(false)
  const [folder, setFolder] = useState('')
  const [apps, setApps] = useState<BackupApp[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<BackupPlanSettings>) => setForm(f => ({ ...f, ...patch }))

  useEffect(() => {
    api.backupDestinations().then(d => {
      setDests(d)
      if (!plan) {
        if (d[0]) set({ dest: d[0].dest })
        else setCustom(true)
      } else if (!d.some(x => x.dest === plan.dest)) setCustom(true)
    }, () => setCustom(true))
    api.backupApps().then(setApps, () => setApps([]))
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onSaved(plan ? await api.updateBackup(plan.id, form) : await api.createBackup(form))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  const addFolder = () => {
    const f = folder.trim()
    if (!f.startsWith('/') || form.paths.includes(f)) return
    set({ paths: [...form.paths, f] })
    setFolder('')
  }
  const cloud = form.dest.startsWith('rclone:')
  const title = plan ? tr('Edit “{0}”', plan.name) : tr('New Backup')

  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci bk-sheet" role="dialog" aria-label={title} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{title}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <form
          className="ci-body cm-form bk-form"
          onSubmit={e => {
            e.preventDefault()
            void save()
          }}
        >
          <label>
            <span>{tr('Name')}</span>
            <input value={form.name} onChange={e => set({ name: e.target.value })} autoFocus={!plan} />
          </label>

          <div className="bk-field">
            <span>{tr('What to back up')}</span>
            <label className="bk-check">
              <input type="checkbox" checked={form.apps} onChange={e => set({ apps: e.target.checked })} />
              <span>
                {tr('Apps’ settings and data')}
                <small>
                  {apps === null
                    ? tr('Looking at your apps…')
                    : apps.length
                      ? tr('{0}: their compose files and the folders they keep data in. Not shared media like /DATA/Media.', apps.map(a => a.name).join(', '))
                      : tr('No Docker apps found.')}
                </small>
              </span>
            </label>
            {form.paths.map(p => (
              <div key={p} className="bk-path">
                <Folder size={13} /> <span>{p}</span>
                <button type="button" className="icon-btn" onClick={() => set({ paths: form.paths.filter(x => x !== p) })} aria-label={tr('Remove')}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <div className="bk-inline">
              <input value={folder} onChange={e => setFolder(e.target.value)} placeholder="/DATA/Documents" spellCheck={false} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addFolder())} />
              <button type="button" className="btn" onClick={addFolder} disabled={!folder.trim().startsWith('/')}>
                <Plus size={12} /> {tr('Add Folder')}
              </button>
            </div>
          </div>

          <label>
            <span>{tr('Where to')}</span>
            <select
              value={custom ? '' : form.dest}
              onChange={e => {
                if (e.target.value === '') {
                  setCustom(true)
                  return
                }
                setCustom(false)
                set({ dest: e.target.value })
              }}
            >
              {dests.map(d => (
                <option key={d.dest} value={d.dest}>
                  {d.cloud ? tr('{0} (cloud drive)', d.label) : `${d.label}${d.free ? ` · ${tr('{0} free', formatBytes(d.free))}` : ''}`} — {destLabel(d.dest)}
                </option>
              ))}
              <option value="">{tr('Another folder…')}</option>
            </select>
          </label>
          {custom && (
            <label>
              <span>{tr('Folder (or rclone:Remote:Folder)')}</span>
              <input value={form.dest} onChange={e => set({ dest: e.target.value })} placeholder="/mnt/USB/Backups" spellCheck={false} />
            </label>
          )}

          <div className="bk-field">
            <span>{tr('When')}</span>
            <div className="segmented" role="radiogroup" aria-label={tr('When')}>
              {(
                [
                  ['daily', tr('Every day')],
                  ['weekly', tr('Every week')],
                  ['manual', tr('By hand')],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={form.schedule === id} className={form.schedule === id ? 'is-active' : ''} onClick={() => set({ schedule: id })}>
                  {label}
                </button>
              ))}
            </div>
            {form.schedule !== 'manual' && (
              <div className="bk-inline">
                {form.schedule === 'weekly' && (
                  <select value={form.weekday} onChange={e => set({ weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                )}
                <input type="time" value={form.time} onChange={e => set({ time: e.target.value })} />
              </div>
            )}
          </div>

          <label>
            <span>{tr('Versions to keep')}</span>
            <input type="number" min={1} max={1000} value={form.keep} onChange={e => set({ keep: Number(e.target.value) || 1 })} />
          </label>

          <label className="bk-check">
            <input type="checkbox" checked={form.pauseApps && !cloud} disabled={cloud} onChange={e => set({ pauseApps: e.target.checked })} />
            <span>
              {tr('Pause apps while they’re copied')}
              <small>
                {cloud
                  ? tr('Not for cloud drives: uploading takes too long to keep apps waiting.')
                  : tr('A few seconds to a few minutes; keeps databases in one piece. Recommended.')}
              </small>
            </span>
          </label>

          {error && <p className="form-error">{error}</p>}
          <div className="sl-actions">
            <button type="button" className="btn" onClick={onClose}>
              {tr('Cancel')}
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? <LoaderCircle size={14} className="spin" /> : null} {plan ? tr('Save') : tr('Create Backup')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RestoreSheet({ plan, version, onClose }: { plan: BackupPlan; version: BackupVersion; onClose: () => void }) {
  const [dir, setDir] = useState('')
  const [files, setFiles] = useState<BackupFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'original' | 'folder'>('folder')
  const at = new Date(version.time)
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}`
  const [to, setTo] = useState(`/DATA/Restored ${stamp}`)
  const [jobKind, setJobKind] = useState<string | null>(null)
  const [done, setDone] = useState<Job | null>(null)
  const job = useJob(jobKind, setDone)

  useEffect(() => {
    setFiles(null)
    api.backupFiles(plan.id, version.id, dir).then(setFiles, e => setError(e instanceof Error ? e.message : String(e)))
  }, [dir])

  const toggle = (p: string) =>
    setPicked(s => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  const restore = async () => {
    setError(null)
    try {
      setJobKind((await api.restoreBackup(plan.id, { version: version.id, paths: [...picked], to: mode === 'original' ? '' : to })).job)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const crumbs = dir ? dir.split('/').filter(Boolean) : []
  const title = tr('Restore from {0}', formatFileDate(version.time))
  const busy = !!job?.running

  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet ci bk-sheet" role="dialog" aria-label={title} onKeyDown={e => e.key === 'Escape' && !busy && onClose()}>
        <header className="ci-head">
          <strong>{title}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')} disabled={busy}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body cm-form bk-form">
          {jobKind ? (
            <div className="bk-restore-progress">
              {busy ? <LoaderCircle size={18} className="spin" /> : null}
              <strong>{busy ? tr('Restoring…') : done?.exit === 0 ? tr('Restored.') : tr('Restore failed.')}</strong>
              <pre className="bk-log">{(job ?? done)?.log.slice(-12).join('\n')}</pre>
              {!busy && (
                <div className="sl-actions">
                  <button className="btn btn-primary" onClick={onClose}>
                    {tr('Done')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <nav className="bk-crumbs">
                <button type="button" onClick={() => setDir('')} disabled={!dir}>
                  {tr('Backed-up folders')}
                </button>
                {crumbs.map((c, i) => {
                  const p = '/' + crumbs.slice(0, i + 1).join('/')
                  return (
                    <span key={p}>
                      <ChevronRight size={11} />
                      <button type="button" onClick={() => setDir(p)} disabled={p === dir}>
                        {c}
                      </button>
                    </span>
                  )
                })}
              </nav>
              <div className="bk-files">
                {!files ? (
                  <p className="empty">{tr('Loading…')}</p>
                ) : files.length === 0 ? (
                  <p className="empty">{tr('This folder is empty.')}</p>
                ) : (
                  files.map(f => (
                    <div key={f.path} className={`bk-file ${picked.has(f.path) ? 'is-picked' : ''}`}>
                      <input type="checkbox" checked={picked.has(f.path)} onChange={() => toggle(f.path)} aria-label={f.name} />
                      {f.folder ? <Folder size={14} /> : <span className="bk-file-dot" />}
                      {f.folder ? (
                        <button type="button" className="bk-file-name" onClick={() => setDir(f.path)}>
                          {f.name}
                        </button>
                      ) : (
                        <span className="bk-file-name">{f.name}</span>
                      )}
                      <small>{f.folder ? '' : formatBytes(f.size ?? 0)}</small>
                    </div>
                  ))
                )}
              </div>

              <div className="bk-field">
                <span>{tr('Restore {0} selected to', picked.size)}</span>
                <label className="bk-check">
                  <input type="radio" name="bk-mode" checked={mode === 'folder'} onChange={() => setMode('folder')} />
                  <span>
                    {tr('A new folder')}
                    <small>{tr('Nothing is replaced; compare, then move what you need.')}</small>
                  </span>
                </label>
                {mode === 'folder' && <input value={to} onChange={e => setTo(e.target.value)} spellCheck={false} />}
                <label className="bk-check">
                  <input type="radio" name="bk-mode" checked={mode === 'original'} onChange={() => setMode('original')} />
                  <span>
                    {tr('Where they came from')}
                    <small>{tr('Replaces the files there now. Apps using them are stopped meanwhile and started again after.')}</small>
                  </span>
                </label>
              </div>
              {error && <p className="form-error">{error}</p>}
              <div className="sl-actions">
                <button type="button" className="btn" onClick={onClose}>
                  {tr('Cancel')}
                </button>
                <button className={`btn ${mode === 'original' ? 'btn-danger' : 'btn-primary'}`} disabled={!picked.size || (mode === 'folder' && !to.startsWith('/'))} onClick={() => void restore()}>
                  <FolderOpen size={13} /> {tr('Restore')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RecoveryKeyPane() {
  const [key, setKey] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [replace, setReplace] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    api.recoveryKey().then(setKey, e => setNote(e instanceof Error ? e.message : String(e)))
  }, [])
  return (
    <>
      <p className="pane-note">
        {tr(
          'Every backup is encrypted with this key. If this server breaks and TemanLabsOS is set up again, you need it to read your backups. Keep a copy somewhere else: a password manager, or on paper.',
        )}
      </p>
      <div className="group">
        <div className="row">
          <code className="bk-key">{key ? (shown ? key : '•'.repeat(Math.min(key.length, 32))) : '…'}</code>
          <span className="bk-inline">
            <button className="icon-btn" onClick={() => setShown(v => !v)} aria-label={shown ? tr('Hide') : tr('Show')} title={shown ? tr('Hide') : tr('Show')}>
              {shown ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              className="btn"
              disabled={!key}
              onClick={() => {
                void copyText(key ?? '')
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? tr('Copied') : tr('Copy')}
            </button>
          </span>
        </div>
      </div>

      <h4 className="bk-heading">{tr('Backups from before')}</h4>
      <p className="pane-note">
        {tr('Set up again after a reinstall? Enter the key your old backups were made with, then add a backup plan with the same destination: its versions show up to restore from.')}
      </p>
      <form
        className="group bk-replace"
        onSubmit={e => {
          e.preventDefault()
          if (!confirm) return setConfirm(true)
          void api.setRecoveryKey(replace.trim()).then(
            () => {
              setKey(replace.trim())
              setReplace('')
              setConfirm(false)
              setNote(tr('Key changed. New backups use it too.'))
            },
            err => setNote(err instanceof Error ? err.message : String(err)),
          )
        }}
      >
        <input value={replace} onChange={e => setReplace(e.target.value)} placeholder={tr('Recovery key')} spellCheck={false} autoComplete="off" />
        <button className={`btn ${confirm ? 'btn-danger' : ''}`} disabled={replace.trim().length < 8} onBlur={() => setConfirm(false)}>
          {confirm ? tr('Click Again: backups made with the current key become unreadable') : tr('Use This Key')}
        </button>
      </form>
      {note && <p className="pane-note">{note}</p>}
    </>
  )
}
