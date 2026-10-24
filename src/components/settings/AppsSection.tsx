import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppWindow, ChevronLeft, ChevronRight, CircleArrowUp, Copy, LoaderCircle, Play, Search, Settings2, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { api } from '../../api'
import type { AppHealth, InstalledApp, MovePreview, MovedApp, StartupApp } from '../../api/types'
import { useJob } from '../../hooks/useJob'
import { formatFileDate } from '../../lib/format'
import { directUrl, hasWebUI } from '../../lib/apps'
import { copyText } from '../../lib/clipboard'
import { tr } from '../../lib/i18n'
import { AppIcon } from '../AppIcon'
import { Switch } from '../Switch'
import { SettingRow } from './DesktopSections'

export interface AppActions {
  busy: ReadonlySet<string>
  onOpen: (app: InstalledApp) => void
  onToggle: (app: InstalledApp) => void
  onUninstall: (id: string) => void
  /** App Settings; tab opens it on Terminal, update starts an update. */
  onSettings: (app: InstalledApp, options?: { tab?: 'terminal'; update?: boolean }) => void
  updateAvailable: (id: string) => boolean
  onOpenStore: () => void
  /** The app list changed on the server (an app moved into Docker). */
  onRefresh: () => void
}

const STATUS: Record<string, string> = {
  running: tr('Running'),
  stopped: tr('Stopped'),
  installing: tr('Installing…'),
  error: tr('Error'),
}
const statusText = (app: InstalledApp) => STATUS[app.status] ?? app.status

/** Settings → Apps: every installed app, and one app's page. */
/** sub is the app whose page is open (Settings keeps it in its back and forward history). */
export function AppsSection({ apps, actions, sub, onSub }: { apps: InstalledApp[]; actions: AppActions; sub: string | null; onSub: (sub: string | null) => void }) {
  const selected = sub
  const setSelected = onSub
  const [query, setQuery] = useState('')
  const [health, setHealth] = useState<Record<string, AppHealth>>({})
  const loadHealth = useCallback(() => {
    api.appHealth().then(list => setHealth(Object.fromEntries(list.map(h => [h.id, h]))), () => {})
  }, [])
  useEffect(() => {
    loadHealth()
    const timer = setInterval(loadHealth, 60_000)
    return () => clearInterval(timer)
  }, [loadHealth])
  const app = apps.find(a => a.id === selected)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...apps].filter(a => !q || a.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))
  }, [apps, query])

  if (app) return <AppPage app={app} actions={actions} health={health[app.id]} onHealthChanged={loadHealth} onBack={() => setSelected(null)} />
  const running = apps.filter(a => a.status === 'running').length
  return (
    <>
      {apps.length > 8 && (
        <label className="sa-search">
          <Search size={13} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Search apps')} />
        </label>
      )}
      <div className="group set-links">
        {shown.length === 0 && <SettingRow label={apps.length ? tr('No apps match.') : tr('No apps installed yet.')} />}
        {shown.map(a => (
          <button key={a.id} className="row set-link" onClick={() => setSelected(a.id)}>
            <span className="set-link-label sa-row-label">
              <AppIcon icon={a.icon} iconUrl={a.iconUrl} color={a.color} size={26} />
              <span>
                {a.name}
                <small className={`is-${health[a.id]?.status === 'down' && a.status === 'running' ? 'down' : a.status}`}>
                  {health[a.id]?.status === 'down' && a.status === 'running' ? tr('Not responding') : statusText(a)}
                  {actions.updateAvailable(a.id) && <b className="sa-upd"> · {tr('Update available')}</b>}
                </small>
              </span>
            </span>
            {actions.busy.has(a.id) && <LoaderCircle size={13} className="spin" />}
            <ChevronRight size={15} className="set-chevron" />
          </button>
        ))}
      </div>
      <p className="pane-note">{tr('{0} apps installed, {1} running.', apps.length, running)}</p>
      <div className="set-open">
        <button className="btn" onClick={actions.onOpenStore}>
          {tr('Open App Center…')}
        </button>
      </div>
    </>
  )
}

const pctText = (v: number) => (v >= 0.9995 ? '100%' : `${(v * 100).toFixed(v >= 0.99 ? 2 : 1)}%`)

function duration(from: string, to?: string) {
  const mins = Math.max(1, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 60_000))
  if (mins < 60) return tr('{0} min', mins)
  const h = Math.floor(mins / 60)
  return mins % 60 ? tr('{0} h {1} min', h, mins % 60) : tr('{0} h', h)
}

function healthText(h: AppHealth | undefined) {
  switch (h?.status) {
    case 'up':
      return { level: 'up', text: tr('Responding') }
    case 'down':
      return { level: 'down', text: tr('Not responding') }
    case 'starting':
      return { level: 'starting', text: tr('Starting…') }
    case 'stopped':
      return { level: 'stopped', text: tr('Stopped') }
    default:
      return { level: 'unknown', text: tr('Not checked yet') }
  }
}

function AppPage({ app, actions, health, onHealthChanged, onBack }: { app: InstalledApp; actions: AppActions; health?: AppHealth; onHealthChanged: () => void; onBack: () => void }) {
  const [startup, setStartup] = useState<StartupApp | null | undefined>(undefined)
  const [startupBusy, setStartupBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  useEffect(() => {
    api.startupApps().then(list => setStartup(list.find(s => s.id === app.id) ?? null), () => setStartup(null))
  }, [app.id])

  const docker = app.source !== 'native'
  const running = app.status === 'running'
  const busy = actions.busy.has(app.id)
  const url = directUrl(app)
  const update = actions.updateAvailable(app.id)
  const controllable = docker || !!app.unit

  const setStartsWithServer = async (enabled: boolean) => {
    if (!startup) return
    setStartupBusy(true)
    setError(null)
    try {
      await api.setStartupApp(app.id, enabled)
      setStartup({ ...startup, enabled })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStartupBusy(false)
    }
  }

  return (
    <>
      <button className="bk-back" onClick={onBack}>
        <ChevronLeft size={14} /> {tr('Applications')}
      </button>
      <div className="sa-page-head">
        <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={64} />
        <div>
          <h2>{app.name}</h2>
          {app.description && <p>{app.description}</p>}
        </div>
      </div>
      <div className="sa-page-actions">
        <button className="btn btn-primary" disabled={app.status === 'installing' || !hasWebUI(app)} onClick={() => actions.onOpen(app)}>
          <AppWindow size={13} /> {tr('Open')}
        </button>
        {docker && (
          <button className="btn" onClick={() => actions.onSettings(app)} disabled={app.status === 'installing'}>
            <Settings2 size={13} /> {tr('App Settings…')}
          </button>
        )}
        {docker && (
          <button className="btn" onClick={() => actions.onSettings(app, { tab: 'terminal' })} disabled={!running}>
            <SquareTerminal size={13} /> {tr('Terminal')}
          </button>
        )}
      </div>

      <div className="group">
        <SettingRow label={tr('Status')} note={app.error}>
          <span className="set-inline">
            <span className={`sa-status is-${app.status}`}>{statusText(app)}</span>
            <button className="btn" disabled={busy || !controllable || app.status === 'installing'} onClick={() => actions.onToggle(app)}>
              {busy ? <LoaderCircle size={12} className="spin" /> : running ? <Square size={11} /> : <Play size={11} />} {running ? tr('Stop') : tr('Start')}
            </button>
          </span>
        </SettingRow>
        <SettingRow label={tr('Address')} note={app.localOnly ? tr('Only on this server; it opens through TemanLabsOS.') : undefined}>
          {url ? (
            <span className="value set-inline">
              {url}
              <button className="icon-btn" onClick={() => void copyText(url)} aria-label={tr('Copy')} title={tr('Copy')}>
                <Copy size={13} />
              </button>
            </span>
          ) : (
            <span className="value">{hasWebUI(app) ? tr('Through TemanLabsOS') : tr('No web page')}</span>
          )}
        </SettingRow>
        <SettingRow
          label={tr('Starts with the server')}
          note={startup?.locked ? tr('Keeps the server reachable; always starts.') : startup === null ? tr('Not available for this app.') : undefined}
        >
          {startup === undefined || startupBusy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Switch label={tr('Starts with the server')} checked={!!startup?.enabled} disabled={!startup || startup.locked} onChange={v => void setStartsWithServer(v)} />
          )}
        </SettingRow>
        {docker && (
          <SettingRow label={tr('Updates')} note={update ? tr('A newer image is available.') : tr('Up to date, as of the last check.')}>
            <button className={`btn ${update ? 'btn-primary' : ''}`} disabled={busy || app.status === 'installing'} onClick={() => actions.onSettings(app, { update: true })}>
              <CircleArrowUp size={13} /> {update ? tr('Update…') : tr('Check & Update…')}
            </button>
          </SettingRow>
        )}
        <SettingRow label={tr('Runs as')}>
          <span className="value">
            {docker
              ? app.containers === 1
                ? tr('1 Docker container')
                : tr('{0} Docker containers', app.containers)
              : app.unit
                ? tr('Service {0}', app.unit)
                : tr('A program on the server')}
          </span>
        </SettingRow>
      </div>
      {error && <p className="form-error">{error}</p>}

      <h4 className="bk-heading">{tr('Health')}</h4>
      <div className="group">
        <SettingRow
          label={tr('Now')}
          note={
            health?.status === 'down'
              ? `${health.error ?? ''}${health.since ? ` · ${tr('since {0}', formatFileDate(health.since))}` : ''}`
              : health?.checked
                ? tr('Checked {0}', formatFileDate(health.checked))
                : tr('Apps are checked every minute.')
          }
        >
          <span className={`sa-status is-${healthText(health).level}`}>{healthText(health).text}</span>
        </SettingRow>
        <SettingRow label={tr('Uptime')} note={health ? tr('Watched since {0}', formatFileDate(health.watching)) : undefined}>
          <span className="value">
            {health ? `${tr('24 h')} ${pctText(health.uptime24h)} · ${tr('7 days')} ${pctText(health.uptime7d)} · ${tr('30 days')} ${pctText(health.uptime30d)}` : '–'}
          </span>
        </SettingRow>
        {docker && (
          <SettingRow
            label={tr('Restart when it stops responding')}
            note={tr('After 3 minutes without an answer, or right after a crash. At most 3 times an hour.')}
          >
            <Switch
              label={tr('Restart when it stops responding')}
              checked={health?.autoRestart ?? true}
              onChange={v =>
                void api.setAutoRestart(app.id, v).then(onHealthChanged, e => setError(e instanceof Error ? e.message : String(e)))
              }
            />
          </SettingRow>
        )}
      </div>
      {!!health?.incidents.length && (
        <>
          <h4 className="bk-heading">{tr('Outages')}</h4>
          <div className="group">
            {health.incidents.map(inc => (
              <div key={inc.start} className="row sa-incident">
                <span>
                  {formatFileDate(inc.start)}
                  <small>
                    {inc.reason}
                    {inc.restarted ? ` · ${tr('restarted by TemanLabsOS')}` : ''}
                  </small>
                </span>
                <span className={`value ${inc.end ? '' : 'sa-ongoing'}`}>{inc.end ? duration(inc.start, inc.end) : tr('Ongoing · {0}', duration(inc.start))}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <MoveSection app={app} onDone={() => {
        actions.onRefresh()
        onBack()
      }} />

      {docker && (
        <div className="bk-footer">
          <button
            className={`btn ${confirmUninstall ? 'btn-danger' : ''}`}
            disabled={busy || !app.canUninstall}
            onBlur={() => setConfirmUninstall(false)}
            onClick={() => {
              if (!confirmUninstall) return setConfirmUninstall(true)
              actions.onUninstall(app.id)
              onBack()
            }}
          >
            <Trash2 size={12} /> {confirmUninstall ? tr('Click Again to Uninstall (keeps its data)') : tr('Uninstall…')}
          </button>
        </div>
      )}
    </>
  )
}

/** Run in Docker: a native Node.js app (run by pm2) can move into a container, and back. */
function MoveSection({ app, onDone }: { app: InstalledApp; onDone: () => void }) {
  const native = app.source === 'native'
  const [preview, setPreview] = useState<MovePreview | null>(null)
  const [moved, setMoved] = useState<MovedApp | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [kind, setKind] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const job = useJob(kind)
  useEffect(() => {
    if (native) api.movePreview(app.id).then(setPreview, () => setPreview({ possible: false }))
    else api.movedApps().then(list => setMoved(list.find(m => m.project === app.id) ?? null), () => {})
  }, [app.id, native])

  const start = (fn: () => Promise<{ job: string }>) => {
    setError(null)
    setConfirm(false)
    fn().then(r => setKind(r.job), e => setError(e instanceof Error ? e.message : String(e)))
  }
  if (!native && !moved) return null

  const running = !!job?.running
  const finished = job && !job.running
  return (
    <>
      <h4 className="bk-heading">{tr('Docker')}</h4>
      <div className="group">
        {native ? (
          <SettingRow
            label={tr('Run in Docker')}
            note={
              !preview
                ? tr('Looking at how it runs…')
                : preview.possible
                  ? tr('Runs the same files from {0} with Node.js {1}, as the same user and on the server’s network, so nothing else changes. If it doesn’t answer in Docker, it goes back to pm2 by itself.', preview.folder ?? '', preview.node ?? '')
                  : tr('Can’t be moved: {0}.', tr(preview.reason ?? 'unknown'))
            }
          >
            <button
              className={`btn ${confirm ? 'btn-danger' : ''}`}
              disabled={!preview?.possible || running || !!finished}
              onBlur={() => setConfirm(false)}
              onClick={() => (confirm ? start(() => api.moveToDocker(app.id)) : setConfirm(true))}
            >
              {running ? <LoaderCircle size={12} className="spin" /> : null} {confirm ? tr('Click Again to Move') : tr('Move to Docker…')}
            </button>
          </SettingRow>
        ) : (
          moved && (
            <SettingRow label={tr('Moved from pm2')} note={tr('On {0}. Its compose file is {1}.', formatFileDate(moved.moved), moved.compose)}>
              <button
                className={`btn ${confirm ? 'btn-danger' : ''}`}
                disabled={running || !!finished}
                onBlur={() => setConfirm(false)}
                onClick={() => (confirm ? start(() => api.moveBack(moved.project)) : setConfirm(true))}
              >
                {running ? <LoaderCircle size={12} className="spin" /> : null} {confirm ? tr('Click Again to Move Back') : tr('Move Back to pm2…')}
              </button>
            </SettingRow>
          )
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {job && (
        <div className="bk-restore-progress">
          <pre className="bk-log">{job.log.slice(-12).join('\n') || '…'}</pre>
          {finished && (
            <div className="sl-actions">
              <span className={`sa-status is-${job.exit === 0 ? 'up' : 'down'}`}>{job.exit === 0 ? tr('Done.') : tr('Didn’t work; nothing changed.')}</span>
              <button className="btn btn-primary" onClick={onDone}>
                {tr('Back to Applications')}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
