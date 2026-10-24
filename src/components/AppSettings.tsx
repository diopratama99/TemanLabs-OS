import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleArrowUp, LoaderCircle, RotateCw, Trash2, TriangleAlert, X } from 'lucide-react'
import { api } from '../api'
import type { AppConfig, InstalledApp, Job } from '../api/types'
import { usePresence } from '../hooks/usePresence'
import { DATA_ROOT } from '../lib/places'
import { Terminal } from '../windows/Terminal'
import { AppIcon } from './AppIcon'
import { ContainerFields, EMPTY_FORM, formFromSpec, toSpec, type Form } from './CustomInstall'
import { LogsPane } from './LogsPane'
import { PopUpButton } from './PopUpButton'
import { tr } from '../lib/i18n'

type Tab = 'settings' | 'compose' | 'logs' | 'terminal'

const SOURCE_LABEL: Record<InstalledApp['source'], string> = {
  temanlabs: tr('TemanLabsOS'),
  casaos: tr('CasaOS'),
  compose: tr('Docker Compose'),
  container: tr('Container'),
  native: tr('Outside Docker'),
}

const EXIT_MS = 220
const JOB_POLL_MS = 1200

export interface SettingsRequest {
  app: InstalledApp
  /** Start an update as soon as the dialog opens (the Dock's "Update" item). */
  update?: boolean
  tab?: Tab
  nonce: number
}

interface Props {
  request: SettingsRequest | null
  updateAvailable: (id: string) => boolean
  onClose: () => void
  /** The app changed (saved, updated, removed): refresh the app list and update checks. */
  onChanged: () => void
}

/** App Settings: everything CasaOS's app settings do, for any Docker app on the server. */
export function AppSettings({ request, updateAvailable, onClose, onChanged }: Props) {
  const { mounted, closing } = usePresence(!!request, EXIT_MS)
  const [last, setLast] = useState(request)
  if (request && request !== last) setLast(request)
  if (!mounted || !last) return null
  return (
    <Dialog key={last.nonce} request={last} closing={closing} updateAvailable={updateAvailable(last.app.id)} onClose={onClose} onChanged={onChanged} />
  )
}

function Dialog({
  request,
  closing,
  updateAvailable,
  onClose,
  onChanged,
}: {
  request: SettingsRequest
  closing: boolean
  updateAvailable: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { app } = request
  const [tab, setTab] = useState<Tab>(request.tab ?? 'settings')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [service, setService] = useState<string | undefined>(undefined)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [savedForm, setSavedForm] = useState<string>('')
  const [yaml, setYaml] = useState('')
  const [networks, setNetworks] = useState(['bridge', 'host'])
  const [advanced, setAdvanced] = useState(false)
  const [container, setContainer] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<null | 'confirm' | 'working'>(null)
  const [deleteData, setDeleteData] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const updateStarted = useRef(false)

  const load = useCallback(
    async (svc?: string) => {
      try {
        const cfg = await api.appConfig(app.id, svc)
        setConfig(cfg)
        setLoadError(null)
        setService(cfg.service)
        setYaml(cfg.yaml ?? '')
        if (cfg.spec) {
          const f = formFromSpec(cfg.spec)
          setForm(f)
          setSavedForm(JSON.stringify(f))
          if (cfg.spec.command || cfg.spec.privileged || cfg.spec.memoryMb || cfg.spec.cpuShares || cfg.spec.capAdd?.length || cfg.spec.hostname) setAdvanced(true)
        }
        setContainer(c => (c && cfg.containers.some(x => x.id === c) ? c : (cfg.containers.find(x => x.state === 'running') ?? cfg.containers[0])?.id ?? null))
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err))
      }
    },
    [app.id],
  )

  useEffect(() => {
    void load()
    api.listNetworks().then(setNetworks, () => {})
    api.job(`app-${app.id}`).then(j => j.running && setJob(j), () => {})
  }, [load, app.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Follow a running job (save or update); when it ends, reload what the server now has.
  const running = !!job?.running
  useEffect(() => {
    if (!running || !job) return
    const timer = setInterval(async () => {
      const next = await api.job(job.kind).catch(() => null)
      if (!next) return
      setJob(next)
      if (!next.running) {
        onChanged()
        void load(service)
      }
    }, JOB_POLL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, job?.kind])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log.length])

  const follow = async (kind: string) => {
    if (!kind) {
      setNote(tr('Nothing changed.'))
      return
    }
    setNote(null)
    setJob(await api.job(kind))
  }

  const update = useCallback(async () => {
    setError(null)
    try {
      const { job: kind } = await api.updateApp(app.id)
      await follow(kind)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id])

  useEffect(() => {
    if (request.update && !updateStarted.current) {
      updateStarted.current = true
      void update()
    }
  }, [request.update, update])

  const dirtyForm = config?.editable && JSON.stringify(form) !== savedForm
  const dirtyYaml = config?.editable && yaml !== (config.yaml ?? '')
  const canSave = !running && !saving && ((tab === 'settings' && dirtyForm) || (tab === 'compose' && dirtyYaml))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body = tab === 'compose' ? { yaml } : { service, spec: toSpec(form, 'form', '') }
      const { job: kind } = await api.saveAppConfig(app.id, body)
      await follow(kind)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const uninstall = async () => {
    setRemoving('working')
    setError(null)
    try {
      await api.uninstallApp(app.id, deleteData)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRemoving('confirm')
    }
  }

  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }))
  const selected = config?.containers.find(c => c.id === container)
  const containerPicker =
    config && config.containers.length > 1 ? (
      <PopUpButton
        className="as-picker"
        value={container ?? ''}
        onChange={setContainer}
        aria-label={tr('Container')}
        options={config.containers.map(c => ({ value: c.id, label: `${c.service || c.name}${c.state === 'running' ? '' : ' (stopped)'}` }))}
      />
    ) : null
  const appData = `${DATA_ROOT}/AppData/${app.id}`

  return (
    <div className={`sheet-backdrop as-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci as" role="dialog" aria-label={tr('{0} settings', app.name)}>
        <header className="ci-head as-head">
          <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={30} />
          <span className="as-title">
            <strong>{app.name}</strong>
            <small>
              {SOURCE_LABEL[app.source]}
              {config?.file ? ` · ${config.file}` : ''}
            </small>
          </span>
          <div className="segmented as-tabs">
            {(['settings', 'compose', 'logs', 'terminal'] as Tab[]).map(t => (
              <button key={t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)} disabled={(t === 'compose' && !config?.yaml) || ((t === 'logs' || t === 'terminal') && !config?.containers.length)}>
                {t === 'settings' ? tr('Settings') : t === 'compose' ? tr('Compose') : t === 'logs' ? tr('Logs') : tr('Terminal')}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>

        <div className={`ci-body as-body as-${tab}`}>
          {loadError && <p className="form-error">{loadError}</p>}
          {!config && !loadError && (
            <p className="as-loading">
              <LoaderCircle size={14} className="spin" /> {tr('Loading settings…')}
            </p>
          )}

          {config && tab === 'settings' && (
            <>
              {!config.editable && config.reason && <p className="ci-note">{config.reason}</p>}
              {config.editable && config.services && config.services.length > 1 && (
                <div className="as-service">
                  <span>{tr('Service')}</span>
                  <PopUpButton
                    className="as-picker"
                    value={service ?? ''}
                    onChange={svc => {
                      setService(svc)
                      void load(svc)
                    }}
                    aria-label={tr('Service')}
                    options={config.services.map(s => ({ value: s, label: s }))}
                  />
                  <small>{tr('This app has')} {config.services.length} {tr('services; the form edits one at a time. The Compose tab shows them all.')}</small>
                </div>
              )}
              {config.editable && (
                <ContainerFields form={form} set={set} networks={networks} appData={appData} advanced={advanced} onAdvanced={setAdvanced} editing />
              )}
            </>
          )}

          {config && tab === 'compose' && (
            <>
              <p className="ci-note">
                {config.file}
                {config.extraFiles?.length ? tr(' (also merged: {0})', config.extraFiles.join(', ')) : ''}{tr('. Saving checks the file with docker compose, keeps the previous version as docker-compose.yml.bak and recreates what changed.')}
              </p>
              <textarea className="ci-compose as-yaml" value={yaml} onChange={e => setYaml(e.target.value)} spellCheck={false} />
            </>
          )}

          {config && tab === 'logs' && (
            <>
              {containerPicker}
              <LogsPane
                title={selected ? selected.service || selected.name : tr('Logs')}
                source={container}
                load={(id, lines) => api.containerLogs(id, lines)}
                emptyText={tr('No logs yet.')}
                onClose={() => setTab('settings')}
              />
            </>
          )}

          {config && tab === 'terminal' && (
            <>
              {containerPicker}
              {selected?.state === 'running' ? (
                <div className="as-terminal">
                  <Terminal key={selected.id} menus={false} connect={(cols, rows) => api.appTerminalUrl(app.id, selected.id, cols, rows)} />
                </div>
              ) : (
                <p className="ci-note">{tr('Start the app to open a shell in its container.')}</p>
              )}
            </>
          )}
        </div>

        {job && (
          <div className="su-job as-job">
            <div className="su-job-head">
              {job.running ? <LoaderCircle size={14} className="spin" /> : job.exit === 0 ? <CircleCheck size={14} className="is-ok" /> : <TriangleAlert size={14} className="is-bad" />}
              <strong>{job.title}</strong>
              <small>{job.running ? tr('Working…') : job.exit === 0 ? tr('Done') : tr('Failed')}</small>
              {!job.running && (
                <button className="icon-btn" onClick={() => setJob(null)} aria-label={tr('Hide log')}>
                  <X size={13} />
                </button>
              )}
            </div>
            <pre ref={logRef} className="su-log">
              {job.log.slice(-300).join('\n') || '…'}
            </pre>
          </div>
        )}

        {removing && (
          <div className="as-remove">
            <TriangleAlert size={16} />
            <div>
              <strong>{tr('Uninstall')} {app.name}?</strong>
              <label>
                <input type="checkbox" checked={deleteData} onChange={e => setDeleteData(e.target.checked)} /> {tr('Also delete its data')}
                {config?.dataDirs.length ? `: ${config.dataDirs.join(', ')}` : tr(' (named volumes)')}
              </label>
              <small>{deleteData ? tr('Settings, databases and files the app kept there are gone for good.') : tr('Its data stays, so reinstalling picks up where it left off.')}</small>
            </div>
            <button className="btn" onClick={() => setRemoving(null)} disabled={removing === 'working'}>
              {tr('Cancel')}
            </button>
            <button className="btn btn-danger" onClick={() => void uninstall()} disabled={removing === 'working'}>
              {removing === 'working' ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />} {tr('Uninstall')}
            </button>
          </div>
        )}

        <footer className="ci-foot as-foot">
          {app.source !== 'native' && (
            <button className="btn" onClick={() => setRemoving('confirm')} disabled={!!removing || running}>
              <Trash2 size={13} /> {tr('Uninstall…')}
            </button>
          )}
          {config?.canUpdate && (
            <button className={`btn ${updateAvailable ? 'is-update' : ''}`} onClick={() => void update()} disabled={running} title={tr('Pull newer images and recreate the containers')}>
              {updateAvailable ? <CircleArrowUp size={13} /> : <RotateCw size={13} />} {updateAvailable ? tr('Update Available') : tr('Update')}
            </button>
          )}
          <span className="as-status">{error ? <span className="form-error">{error}</span> : note && <span className="form-hint">{note}</span>}</span>
          <button className="btn" onClick={onClose}>
            {tr('Close')}
          </button>
          {(tab === 'settings' || tab === 'compose') && config?.editable && (
            <button className="btn btn-primary" onClick={() => void save()} disabled={!canSave}>
              {saving ? <LoaderCircle size={13} className="spin" /> : null} {tr('Save')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
