import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, LoaderCircle, Power, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { api } from '../api'
import type { Job, UpdatesInfo } from '../api/types'
import { formatFileDate } from '../lib/format'
import { tr } from '../lib/i18n'

const JOB_POLL_MS = 1200

/**
 * Settings › Software Update, under TemanLabsOS's own: the system's packages (apt upgrades from
 * Ubuntu, Docker and the other sources), with the install log and the restart prompt.
 */
export function PackageUpdates() {
  const [info, setInfo] = useState<UpdatesInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  const refresh = useCallback(async () => {
    try {
      setInfo(await api.updates())
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    api.job('apt').then(setJob, () => {})
  }, [refresh])

  // While apt runs, follow its log; when it ends, the list of updates has changed.
  const running = !!job?.running
  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      const next = await api.job('apt').catch(() => null)
      if (!next) return
      setJob(next)
      if (!next.running) {
        setPicked(new Set())
        void refresh()
      }
    }, JOB_POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log.length])

  const start = async (task: () => Promise<void>) => {
    await task()
    setJob(await api.job('apt'))
  }
  const check = () => void start(api.checkUpdates)
  const install = (packages: string[] = []) => void start(() => api.installUpdates(packages))

  const updates = info?.updates ?? []
  const security = updates.filter(u => u.security).length
  const toggle = (name: string) =>
    setPicked(p => {
      const next = new Set(p)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <section className="su">
      <div className="su-head">
        <span>
          <strong>{tr('System packages')}</strong>
          <small>
            {tr('Ubuntu, Docker and your other apt sources.')}
            {info?.lastChecked ? ` ${tr('Last checked {0}', formatFileDate(info.lastChecked))}` : ''}
          </small>
        </span>
        <button className="btn" onClick={check} disabled={running}>
          <RefreshCw size={13} className={running && job?.title?.startsWith('Checking') ? 'spin' : ''} /> {tr('Check for Updates')}
        </button>
      </div>

      {loadError && <p className="form-error">{tr('Couldn’t read updates:')} {loadError}</p>}

      {info?.rebootRequired && (
        <div className="su-banner">
          <TriangleAlert size={18} />
          <span>
            <strong>{tr('Restart required')}</strong>
            <small>
              {tr('Updates to')} {info.rebootFor?.slice(0, 3).join(', ') || tr('the system')}
              {info.rebootFor && info.rebootFor.length > 3 ? tr(' and {0} more', info.rebootFor.length - 3) : ''} {tr('take effect after a restart. Apps and shares are unavailable for a minute or two.')}
            </small>
          </span>
          {restarting ? (
            <span className="su-restarting">
              <LoaderCircle size={14} className="spin" /> {tr('Restarting…')}
            </span>
          ) : (
            <button
              className={`btn ${confirmRestart ? 'btn-danger' : ''}`}
              onClick={() => {
                if (!confirmRestart) {
                  setConfirmRestart(true)
                  return
                }
                setRestarting(true)
                void api.power('restart')
              }}
              onBlur={() => setConfirmRestart(false)}
            >
              <Power size={13} /> {confirmRestart ? tr('Click Again to Restart') : tr('Restart Now…')}
            </button>
          )}
        </div>
      )}

      <div className="su-hero">
        {updates.length ? <ShieldAlert size={34} className={security ? 'is-security' : ''} /> : <CircleCheck size={34} className="is-ok" />}
        <div>
          <strong>
            {info ? (updates.length ? tr('{0} update{1} available', updates.length, updates.length > 1 ? 's' : '') : tr('Your server is up to date')) : tr('Checking…')}
          </strong>
          <small>
            {updates.length
              ? security
                ? tr('{0} {1}: install soon.', security, security > 1 ? tr('are security fixes') : tr('is a security fix'))
                : tr('Bug fixes and improvements from Ubuntu and your other sources.')
              : tr('Ubuntu, Docker and your other apt sources have nothing new.')}
          </small>
        </div>
        {updates.length > 0 && (
          <div className="su-actions">
            {picked.size > 0 && (
              <button className="btn" onClick={() => install([...picked])} disabled={running}>
                {tr('Install')} {picked.size} {tr('Selected')}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => install()} disabled={running}>
              {tr('Update All')}
            </button>
          </div>
        )}
      </div>

      {job && (job.running || job.log.length > 0) && (
        <div className="su-job">
          <div className="su-job-head">
            {job.running ? <LoaderCircle size={14} className="spin" /> : job.exit === 0 ? <CircleCheck size={14} className="is-ok" /> : <TriangleAlert size={14} className="is-bad" />}
            <strong>{job.title ?? 'apt'}</strong>
            <small>{job.running ? tr('Running…') : job.exit === 0 ? tr('Finished') : tr('Failed (exit {0})', job.exit)}</small>
          </div>
          <pre ref={logRef} className="su-log">
            {job.log.slice(-400).join('\n') || '…'}
          </pre>
        </div>
      )}

      {updates.length > 0 && (
        <div className="group su-list">
          {updates.map(u => (
            <label key={`${u.name}:${u.arch}`} className="su-row">
              <input type="checkbox" checked={picked.has(u.name)} onChange={() => toggle(u.name)} disabled={running} />
              <span className="su-name">
                <strong>
                  {u.name}
                  {u.arch && u.arch !== 'amd64' && u.arch !== 'all' && <small> ({u.arch})</small>}
                </strong>
                <small>
                  {u.current} → {u.version}
                </small>
              </span>
              {u.security && <i className="su-badge">{tr('Security')}</i>}
              <small className="su-origin">{u.origin.split(',')[0]}</small>
            </label>
          ))}
        </div>
      )}
    </section>
  )
}
