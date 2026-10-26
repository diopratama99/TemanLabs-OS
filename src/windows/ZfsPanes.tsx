import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, CircleCheck, Database, FolderOpen, KeyRound, LoaderCircle, Lock, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '../api'
import type { Job, TrueNasApp, ZfsImportable, ZfsInfo, ZfsPool, ZfsSnapshot, ZfsVdev } from '../api/types'
import { EMPTY_FORM, toSpec } from '../components/CustomInstall'
import { Switch } from '../components/Switch'
import { formatBytes } from '../lib/format'
import { tr } from '../lib/i18n'

// ZFS in Disk Manager: importing pools brought from TrueNAS (or another system), their health,
// scrubs, snapshots, and the TrueNAS apps found on them. Nothing here erases data; see server/zfs.go.

export const ZFS_IMPORT = 'zfs:import'
export const poolKey = (name: string) => `zfs:${name}`

/** A pool state's level: ONLINE is fine, DEGRADED still has the data, the rest don't work. */
export function poolLevel(state: string): 'ok' | 'warn' | 'bad' {
  return state === 'ONLINE' ? 'ok' : state === 'DEGRADED' || state === 'OFFLINE' ? 'warn' : 'bad'
}

/** Runs a zfs job (import, install) and follows its log until it ends. */
function useZfsJob(onDone: () => void) {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = !!job?.running
  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      const next = await api.job('zfs').catch(() => null)
      if (!next) return
      setJob(next)
      if (!next.running) onDone()
    }, 1200)
    return () => clearInterval(timer)
  }, [running, onDone])
  const start = async (task: () => Promise<unknown>) => {
    setError(null)
    try {
      await task()
      const next = await api.job('zfs')
      setJob(next)
      if (!next.running) onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return { job, running, error, start }
}

function JobLog({ job }: { job: Job | null }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [job?.log.length])
  if (!job) return null
  return (
    <div className="su-job zfs-job">
      <div className="su-job-head">
        {job.running ? <LoaderCircle size={14} className="spin" /> : job.exit === 0 ? <CircleCheck size={14} className="is-ok" /> : <TriangleAlert size={14} className="is-bad" />}
        <strong>{job.title}</strong>
      </div>
      <pre ref={ref} className="su-log">
        {job.log.join('\n') || '…'}
      </pre>
    </div>
  )
}

function StatePill({ state }: { state?: string }) {
  if (!state) return null
  return <span className={`zfs-state is-${poolLevel(state)}`}>{state}</span>
}

/** A pool's layout: the pool, its mirror or raidz groups, and their drives, with error counts. */
function VdevTree({ vdevs }: { vdevs: ZfsVdev[] }) {
  const rows: ReactNode[] = []
  const walk = (v: ZfsVdev, depth: number) => {
    const errors = [v.read, v.write, v.cksum].some(n => n && n !== '0')
    rows.push(
      <div key={rows.length} className="zfs-vdev" style={{ paddingLeft: 14 + depth * 18 }}>
        <span className="zfs-vdev-name">
          {v.name}
          {v.note && <small>{v.note}</small>}
        </span>
        {errors && (
          <span className="zfs-vdev-errors" title={tr('Read, write and checksum errors')}>
            {tr('{0} read · {1} write · {2} checksum errors', v.read ?? '0', v.write ?? '0', v.cksum ?? '0')}
          </span>
        )}
        <StatePill state={v.state} />
      </div>,
    )
    for (const c of v.children ?? []) walk(c, depth + 1)
  }
  for (const v of vdevs) walk(v, 0)
  return <div className="group zfs-tree">{rows}</div>
}

/** What keeps the data safe, said where people decide to import. */
function SafetyNote() {
  return (
    <div className="zfs-safe">
      <ShieldCheck size={18} />
      <span>
        <strong>{tr('Your files stay as they are')}</strong>
        <small>{tr('Importing never formats or erases a drive, and the pool isn’t upgraded or changed, so it can still go back to TrueNAS.')}</small>
        <small>{tr('Check Read-Only first: you can look through everything while nothing is written to the drives, and after a restart the pool is untouched.')}</small>
        <small>{tr('A normal import takes a snapshot right away: a copy of the pool as it came, to go back to at any time.')}</small>
      </span>
    </div>
  )
}

/** Pools on the drives that aren't imported yet, and the ZFS tools if they're missing. */
export function ZfsImportPane({ info, onChanged }: { info: ZfsInfo | null; onChanged: () => void }) {
  const { job, running, error, start } = useZfsJob(onChanged)
  if (!info) return <p className="am-empty">{tr('Looking for ZFS pools…')}</p>
  return (
    <>
      <p className="pane-note">
        {tr('Coming from TrueNAS? Your pool’s drives are here with all their files. Import the pool to use it again: its folders show up in Files, and its apps can be installed again.')}
      </p>
      <SafetyNote />
      {!info.installed ? (
        <div className="group du-startup">
          <span>
            {tr('The ZFS tools aren’t installed')}
            <small>{tr('They’re what reads ZFS pools (the zfsutils-linux package, about 3 MB). Installing them doesn’t touch any drive.')}</small>
          </span>
          <button className="btn btn-primary" onClick={() => void start(() => api.installZfs())} disabled={running}>
            {running ? <LoaderCircle size={13} className="spin" /> : null} {tr('Install ZFS Tools')}
          </button>
        </div>
      ) : info.importable.length === 0 ? (
        <p className="sh-empty">{tr('No pools waiting to be imported. Imported pools are listed under ZFS Pools in the sidebar.')}</p>
      ) : (
        info.importable.map(p => <ImportCard key={p.id} pool={p} busy={running} onImport={ro => void start(() => api.importPool(p.id, p.name, ro))} />)
      )}
      {info.error && <p className="form-error">{info.error}</p>}
      {error && <p className="form-error">{error}</p>}
      <JobLog job={job} />
    </>
  )
}

function ImportCard({ pool, busy, onImport }: { pool: ZfsImportable; busy: boolean; onImport: (readOnly: boolean) => void }) {
  return (
    <div className="group zfs-import">
      <div className="zfs-import-head">
        <Database size={18} />
        <strong>{pool.name}</strong>
        <StatePill state={pool.state} />
      </div>
      {pool.status && <p className="zfs-text">{pool.status}</p>}
      <VdevTree vdevs={pool.vdevs} />
      {pool.blocked ? (
        <p className="form-hint">{tr(pool.blocked)}</p>
      ) : (
        <div className="du-actions">
          <button className="btn" onClick={() => onImport(true)} disabled={busy} title={tr('Look at the files without writing anything to the drives')}>
            {tr('Check Read-Only')}
          </button>
          <button className="btn btn-primary" onClick={() => onImport(false)} disabled={busy}>
            {tr('Import')}
          </button>
        </div>
      )}
    </div>
  )
}

const VERDICT: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'Healthy: every drive is working',
  warn: 'Degraded: a drive is missing or failing. Your files are still there; replace the drive soon.',
  bad: 'Not working: the pool can’t be read right now',
}

/** An imported pool: space, health, layout, scrubs, snapshots and TrueNAS apps. */
export function ZfsPoolPane({ pool, onChanged, onShowInFiles }: { pool: ZfsPool; onChanged: () => void; onShowInFiles: (path: string) => void }) {
  const { job, running, error, start } = useZfsJob(onChanged)
  const [note, setNote] = useState<string | null>(null)
  const level = poolLevel(pool.state)
  const total = pool.used + pool.free

  const act = async (task: () => Promise<unknown>, done?: string) => {
    setNote(null)
    try {
      await task()
      if (done) setNote(done)
      onChanged()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="du-capacity">
        <div className="du-bar">
          <i style={{ width: `${total ? (pool.used / total) * 100 : 0}%` }} />
        </div>
        <div className="du-legend">
          <span>
            <i className="is-used" /> {tr('Used')} <strong>{formatBytes(pool.used)}</strong>
          </span>
          <span>
            <i /> {tr('Free')} <strong>{formatBytes(pool.free)}</strong>
          </span>
          <span>
            {tr('Capacity')} <strong>{formatBytes(total)}</strong>
          </span>
        </div>
      </div>

      {pool.readOnly && (
        <div className="zfs-safe is-info">
          <Lock size={18} />
          <span>
            <strong>{tr('Imported read-only')}</strong>
            <small>{tr('Look through your files: nothing is written to the drives. When everything is there, use the pool normally. Until then it’s set aside again at the next restart.')}</small>
          </span>
          <button className="btn btn-primary" onClick={() => void start(() => api.poolReadWrite(pool.name))} disabled={running}>
            {tr('Use Normally')}
          </button>
        </div>
      )}

      <div className={`group du-health is-${level}`}>
        <div className="du-verdict">
          {level === 'ok' ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
          <strong>{tr(VERDICT[level])}</strong>
        </div>
        {level !== 'ok' && pool.action && <p className="zfs-text">{pool.action}</p>}
        <div className="row">
          <span>{tr('State')}</span>
          <span className="row-value">{pool.state}</span>
        </div>
        {pool.errors && (
          <div className="row">
            <span>{tr('Data errors')}</span>
            <span className="row-value">{pool.errors === 'No known data errors' ? tr('None') : pool.errors}</span>
          </div>
        )}
        <div className="row">
          <span>{tr('Last scrub')}</span>
          <span className="row-value">{pool.scan || tr('Never')}</span>
        </div>
        {pool.mount && (
          <div className="row">
            <span>{tr('Mounted at')}</span>
            <span className="row-value">
              <button className="link-btn" onClick={() => onShowInFiles(pool.mount!)}>
                {pool.mount}
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="group du-startup">
        <span>
          {tr('Scrub')}
          <small>{tr('Reads every file and repairs any that went bad from the pool’s other copy. Run it about once a month; the pool stays usable meanwhile.')}</small>
        </span>
        <button className="btn" onClick={() => void act(() => api.scrubPool(pool.name, pool.scrubbing))} disabled={pool.readOnly || pool.state === 'FAULTED'}>
          {pool.scrubbing ? tr('Stop Scrub') : tr('Scrub Now')}
        </button>
      </div>

      {pool.locked.length > 0 && <UnlockForm pool={pool.name} locked={pool.locked} onDone={onChanged} />}
      {pool.skipped.length > 0 && (
        <p className="form-hint">
          {tr('Not mounted, so nothing is covered up: {0}. Give them another mount point to use them.', pool.skipped.join(', '))}
        </p>
      )}

      <h4 className="du-heading">{tr('Drives')}</h4>
      <VdevTree vdevs={pool.vdevs} />

      <PoolSnapshots pool={pool} onShowInFiles={onShowInFiles} onChanged={onChanged} />
      {pool.trueNasApps && !pool.readOnly && <TrueNasApps pool={pool.name} onShowInFiles={onShowInFiles} />}

      {(note || error) && <p className="form-hint">{note ?? error}</p>}
      <JobLog job={job} />
    </>
  )
}

function UnlockForm({ pool, locked, onDone }: { pool: string; locked: string[]; onDone: () => void }) {
  const [dataset, setDataset] = useState(locked[0])
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unlock = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.unlockDataset(pool, dataset, key)
      setKey('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="group zfs-unlock">
      <div className="zfs-import-head">
        <KeyRound size={16} />
        <strong>{tr('{0} encrypted datasets are locked', locked.length)}</strong>
      </div>
      <p className="zfs-text">{tr('Enter the passphrase, or the hex key from TrueNAS’s exported dataset keys. The key isn’t saved; after a restart, unlock them again.')}</p>
      <div className="zfs-unlock-row">
        <select value={dataset} onChange={e => setDataset(e.target.value)} disabled={busy}>
          {locked.map(d => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={tr('Passphrase or key')} autoComplete="off" disabled={busy} />
        <button className="btn btn-primary" onClick={() => void unlock()} disabled={busy || !key}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <Lock size={13} />} {tr('Unlock')}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

const KEEP_CHOICES = [7, 14, 30, 90]

function PoolSnapshots({ pool, onShowInFiles, onChanged }: { pool: ZfsPool; onShowInFiles: (path: string) => void; onChanged: () => void }) {
  const [snaps, setSnaps] = useState<{ snapshots: ZfsSnapshot[]; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    api.poolSnapshots(pool.name).then(setSnaps, (err: Error) => setError(err.message))
  }, [pool.name])
  useEffect(load, [load])

  const act = async (task: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const shown = snaps?.snapshots.slice(0, 10) ?? []
  return (
    <>
      <h4 className="du-heading">{tr('Snapshots')}</h4>
      <p className="pane-note">
        {tr('A snapshot keeps the pool as it was at that moment, read-only, and only takes space for what changed since. To get a file back, open a snapshot and copy the file out.')}
      </p>
      <div className="group du-startup">
        <span>
          {tr('Daily snapshots')}
          <small>{tr('One a day, keeping the newest {0}. Only these daily ones are ever removed; your own and TrueNAS’s stay.', pool.auto.keep || 14)}</small>
        </span>
        <select
          value={pool.auto.keep || 14}
          onChange={e => void act(() => api.setPoolAuto(pool.name, { daily: pool.auto.daily, keep: Number(e.target.value) }))}
          disabled={busy || pool.readOnly}
          aria-label={tr('Snapshots to keep')}
        >
          {KEEP_CHOICES.map(n => (
            <option key={n} value={n}>
              {tr('Keep {0}', n)}
            </option>
          ))}
        </select>
        <Switch checked={pool.auto.daily} onChange={on => void act(() => api.setPoolAuto(pool.name, { daily: on, keep: pool.auto.keep || 14 }))} label={tr('Daily snapshots')} />
      </div>
      <div className="group zfs-snaps">
        {shown.length === 0 && <p className="sh-empty">{snaps ? tr('No snapshots yet.') : tr('Reading snapshots…')}</p>}
        {shown.map(s => (
          <div key={s.name} className="zfs-snap">
            <Camera size={15} />
            <span>
              <strong>{s.name}</strong>
              <small>
                {new Date(s.created).toLocaleString()} · {formatBytes(s.used)}
                {s.datasets > 1 ? tr(' · {0} datasets', s.datasets) : ''}
              </small>
            </span>
            {s.browse && (
              <button className="btn" onClick={() => onShowInFiles(s.browse!)}>
                <FolderOpen size={13} /> {tr('Open')}
              </button>
            )}
          </div>
        ))}
        {snaps && snaps.total > shown.length && <p className="form-hint">{tr('{0} older snapshots aren’t shown.', snaps.total - shown.length)}</p>}
      </div>
      <div className="du-actions">
        {error && <span className="form-error">{error}</span>}
        <button className="btn" onClick={() => void act(() => api.snapshotPool(pool.name))} disabled={busy || pool.readOnly}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <Camera size={13} />} {tr('Take Snapshot Now')}
        </button>
      </div>
    </>
  )
}

/** Apps found on a pool from TrueNAS, to install again with the data they had. */
function TrueNasApps({ pool, onShowInFiles }: { pool: string; onShowInFiles: (path: string) => void }) {
  const [apps, setApps] = useState<TrueNasApp[] | null>(null)
  const [state, setState] = useState<Record<string, string>>({})
  useEffect(() => {
    api.trueNasApps(pool).then(setApps, () => setApps([]))
  }, [pool])
  if (!apps?.length) return null

  const install = async (app: TrueNasApp) => {
    setState(s => ({ ...s, [app.name]: tr('Installing…') }))
    try {
      const spec = toSpec({ ...EMPTY_FORM, title: app.title, iconUrl: app.icon ?? '', webPort: app.port ? String(app.port) : '', scheme: app.scheme === 'https' ? 'https' : 'http', webPath: app.path || '/' }, 'compose', app.compose ?? '')
      await api.installCustomApp(spec)
      setState(s => ({ ...s, [app.name]: tr('Installing: it appears on the desktop when it’s ready.') }))
    } catch (err) {
      setState(s => ({ ...s, [app.name]: err instanceof Error ? err.message : String(err) }))
    }
  }

  return (
    <>
      <h4 className="du-heading">{tr('Apps from TrueNAS')}</h4>
      <p className="pane-note">{tr('These apps were on the pool. Installing one runs the same setup TrueNAS used, with the data it had; nothing is copied or changed.')}</p>
      <div className="group zfs-snaps">
        {apps.map(app => (
          <div key={app.name} className="zfs-snap">
            {app.icon ? <img src={app.icon} alt="" className="zfs-app-icon" /> : <Database size={15} />}
            <span>
              <strong>
                {app.title}
                {app.version ? ` ${app.version}` : ''}
              </strong>
              <small>
                {state[app.name] ??
                  (app.kind === 'kubernetes'
                    ? tr('From TrueNAS before 24.10: install it again from the App Center, then point it at its data.')
                    : app.missing.length
                      ? tr('Uses folders this server doesn’t have: {0}', app.missing.join(', '))
                      : tr('Ready to install, with its data.'))}
              </small>
            </span>
            {app.data && (
              <button className="btn" onClick={() => onShowInFiles(app.data!)} title={app.data}>
                <FolderOpen size={13} /> {tr('Data')}
              </button>
            )}
            {app.kind === 'compose' && (
              <button className="btn btn-primary" onClick={() => void install(app)} disabled={!!state[app.name]}>
                {tr('Install')}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
