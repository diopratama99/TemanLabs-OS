import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { ChevronDown, ClipboardPaste, LoaderCircle, Plus, Terminal, X } from 'lucide-react'
import { api } from '../api'
import type { CustomAppSpec } from '../api/types'
import { usePresence } from '../hooks/usePresence'
import { parseDockerRun } from '../lib/dockerRun'
import { DATA_ROOT } from '../lib/places'
import { AppIcon } from './AppIcon'
import { Switch } from './Switch'
import { tr } from '../lib/i18n'

export type Mode = 'form' | 'compose'
type Protocol = 'tcp' | 'udp'
type Restart = CustomAppSpec['restart']

// Numbers are kept as strings while editing, so a field can be empty.
export interface Form {
  image: string
  tag: string
  title: string
  iconUrl: string
  scheme: 'http' | 'https'
  webPort: string
  webPath: string
  network: string
  ports: { host: string; container: string; protocol: Protocol }[]
  volumes: { host: string; container: string; readOnly: boolean }[]
  env: { key: string; value: string }[]
  devices: { host: string; container: string }[]
  command: string
  restart: Restart
  privileged: boolean
  memoryMb: string
  cpuShares: string
  capAdd: string
  hostname: string
}

export const EMPTY_FORM: Form = {
  image: '',
  tag: '',
  title: '',
  iconUrl: '',
  scheme: 'http',
  webPort: '',
  webPath: '/',
  network: 'bridge',
  ports: [],
  volumes: [],
  env: [],
  devices: [],
  command: '',
  restart: 'unless-stopped',
  privileged: false,
  memoryMb: '',
  cpuShares: '',
  capAdd: '',
  hostname: '',
}

const SHEET_EXIT_MS = 220
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const num = (s: string) => Number.parseInt(s, 10) || 0

export function toSpec(f: Form, mode: Mode, compose: string): CustomAppSpec {
  const ports = f.ports
    .filter(p => p.container.trim())
    .map(p => ({ host: num(p.host), container: num(p.container), protocol: p.protocol }))
  // Like CasaOS: without an explicit Web UI port, the first published TCP port is the web UI.
  const firstTcp = f.network === 'host' ? undefined : ports.find(p => p.protocol === 'tcp')
  return {
    compose: mode === 'compose' ? compose : undefined,
    image: f.image.trim(),
    tag: f.tag.trim(),
    title: f.title.trim(),
    iconUrl: f.iconUrl.trim(),
    webUi: { scheme: f.scheme, port: num(f.webPort) || (firstTcp ? firstTcp.host || firstTcp.container : 0), path: f.webPath || '/' },
    network: f.network,
    ports,
    volumes: f.volumes.filter(v => v.host.trim() && v.container.trim()),
    env: f.env.filter(e => e.key.trim()),
    devices: f.devices.filter(d => d.host.trim()),
    command: f.command,
    restart: f.restart,
    privileged: f.privileged,
    memoryMb: num(f.memoryMb),
    cpuShares: num(f.cpuShares),
    capAdd: f.capAdd.split(/[\s,]+/).filter(Boolean),
    hostname: f.hostname.trim(),
  }
}

interface Props {
  open: boolean
  onClose: () => void
  onInstall: (spec: CustomAppSpec) => Promise<string>
}

/** Manual App Install, as a sheet over the App Center: install any image, like CasaOS's custom install. */
export function CustomInstall({ open, onClose, onInstall }: Props) {
  const { mounted, closing } = usePresence(open, SHEET_EXIT_MS)
  if (!mounted) return null
  return <Sheet closing={closing} onClose={onClose} onInstall={onInstall} />
}

function Sheet({ closing, onClose, onInstall }: Omit<Props, 'open'> & { closing: boolean }) {
  const [mode, setMode] = useState<Mode>('form')
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [compose, setCompose] = useState('')
  const [networks, setNetworks] = useState(['bridge', 'host'])
  const [importing, setImporting] = useState(false)
  const [runCommand, setRunCommand] = useState('')
  const [importNote, setImportNote] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listNetworks().then(setNetworks, () => {})
    firstField.current?.focus({ preventScroll: true })
  }, [])

  // On the window, not the sheet: focus can fall back to the page (e.g. after Fill Form).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }))
  const appData = `${DATA_ROOT}/AppData/${slug(form.title) || 'app'}`

  const importRun = () => {
    try {
      const { spec, skipped } = parseDockerRun(runCommand)
      setForm(f => ({
        ...f,
        ...spec,
        title: spec.title ?? f.title,
        tag: spec.tag ?? '',
        network: spec.network ?? f.network,
        ports: (spec.ports ?? []).map(p => ({ host: String(p.host), container: String(p.container), protocol: p.protocol })),
        volumes: spec.volumes ?? [],
        env: spec.env ?? [],
        devices: spec.devices ?? [],
        memoryMb: spec.memoryMb ? String(spec.memoryMb) : '',
        cpuShares: spec.cpuShares ? String(spec.cpuShares) : '',
        capAdd: (spec.capAdd ?? []).join(', '),
      }))
      if (spec.network && !networks.includes(spec.network)) setNetworks(n => [...n, spec.network!])
      if (spec.command || spec.privileged || spec.memoryMb || spec.cpuShares || spec.capAdd?.length || spec.hostname) setAdvanced(true)
      setImportNote(skipped.length ? tr('Not imported: {0}', skipped.join(', ')) : null)
      setImporting(false)
      setError(null)
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : String(err))
    }
  }

  const submit = async () => {
    if (mode === 'form' && (!form.image.trim() || !form.title.trim())) {
      setError(tr('Docker Image and Title are required.'))
      return
    }
    if (mode === 'compose' && !compose.trim()) {
      setError(tr('Paste a docker-compose.yml first.'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onInstall(toSpec(form, mode, compose))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`sheet-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div
        className="sheet ci"
        role="dialog"
        aria-label={tr('Manual App Install')}
      >
        <header className="ci-head">
          <strong>{tr('Manual App Install')}</strong>
          <div className="segmented ci-modes">
            <button className={mode === 'form' ? 'is-active' : ''} onClick={() => setMode('form')}>
              {tr('Configure')}
            </button>
            <button className={mode === 'compose' ? 'is-active' : ''} onClick={() => setMode('compose')}>
              {tr('Docker Compose')}
            </button>
          </div>
          {mode === 'form' && (
            <button className={`pill-btn ${importing ? 'is-on' : ''}`} onClick={() => setImporting(i => !i)} title={tr('Fill the form from a docker run command')}>
              <Terminal size={13} /> {tr('Import docker run')}
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>

        <div className="ci-body">
          {mode === 'form' && importing && (
            <div className="ci-import">
              <textarea
                autoFocus
                value={runCommand}
                onChange={e => setRunCommand(e.target.value)}
                placeholder={tr("docker run -d --name=whoami -p 8080:80 \\\n  -v /DATA/AppData/whoami:/data traefik/whoami")}
                spellCheck={false}
              />
              <button className="btn btn-primary" onClick={importRun} disabled={!runCommand.trim()}>
                <ClipboardPaste size={13} /> {tr('Fill Form')}
              </button>
            </div>
          )}
          {importNote && <p className="ci-note">{importNote}</p>}

          {mode === 'compose' ? (
            <>
              <div className="ci-grid">
                <Field label={tr('Title')} hint={tr('Optional; taken from the file when empty')}>
                  <input ref={firstField} value={form.title} onChange={e => set({ title: e.target.value })} placeholder={tr('Your App Name')} />
                </Field>
                <IconField value={form.iconUrl} title={form.title} onChange={iconUrl => set({ iconUrl })} />
              </div>
              <Field label="docker-compose.yml" hint={tr('CasaOS app files keep their title, icon and web UI (x-casaos).')}>
                <textarea
                  className="ci-compose"
                  value={compose}
                  onChange={e => setCompose(e.target.value)}
                  spellCheck={false}
                  placeholder={tr("services:\n  whoami:\n    image: traefik/whoami\n    ports:\n      - \"8080:80\"")}
                />
              </Field>
            </>
          ) : (
            <ContainerFields form={form} set={set} networks={networks} appData={appData} firstField={firstField} advanced={advanced} onAdvanced={setAdvanced} />
          )}
        </div>

        <footer className="ci-foot">
          {error ? <p className="form-error">{error}</p> : <p className="form-hint">{tr('The image is pulled on the server; big images take a while.')}</p>}
          <button className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <LoaderCircle size={13} className="spin" /> : null} {tr('Install')}
          </button>
        </footer>
      </div>
    </div>
  )
}

interface ContainerFieldsProps {
  form: Form
  set: (patch: Partial<Form>) => void
  networks: string[]
  /** Where new volumes go by default, e.g. /DATA/AppData/jellyfin. */
  appData: string
  firstField?: RefObject<HTMLInputElement | null>
  advanced: boolean
  onAdvanced: (open: boolean) => void
  /** App Settings edits an installed app: the image is required but the title may stay. */
  editing?: boolean
}

/** The container form (image, web UI, network, ports, volumes, env, devices, advanced), shared by
 * Manual Install, App Settings and App Store installs. */
export function ContainerFields({ form, set, networks, appData, firstField, advanced, onAdvanced, editing }: ContainerFieldsProps) {
  const networkOptions = networks.includes(form.network) || !form.network ? networks : [form.network, ...networks]
  return (
    <>
      <div className="ci-grid ci-image">
        <Field label={tr('Docker Image')} required>
          <input
            ref={firstField}
            value={form.image}
            onChange={e => set({ image: e.target.value })}
            placeholder={tr('e.g. hello-world:latest')}
            spellCheck={false}
            autoCapitalize="off"
          />
        </Field>
        <Field label={tr('Tag')}>
          <input value={form.tag} onChange={e => set({ tag: e.target.value })} placeholder="latest" spellCheck={false} />
        </Field>
      </div>
      <div className="ci-grid">
        <Field label={tr('Title')} required={!editing}>
          <input value={form.title} onChange={e => set({ title: e.target.value })} placeholder={tr('e.g. Your App Name')} />
        </Field>
        <IconField value={form.iconUrl} title={form.title} onChange={iconUrl => set({ iconUrl })} />
      </div>

      <Field label={tr('Web UI')} hint={tr('Leave the port empty to use the first published TCP port.')}>
        <div className="ci-webui">
          <select value={form.scheme} onChange={e => set({ scheme: e.target.value as Form['scheme'] })}>
            <option value="http">http://</option>
            <option value="https">https://</option>
          </select>
          <span className="ci-host">{location.hostname}</span>
          <input value={form.webPort} onChange={e => set({ webPort: e.target.value.replace(/\D/g, '') })} placeholder={tr(':Port')} inputMode="numeric" />
          <input value={form.webPath} onChange={e => set({ webPath: e.target.value })} placeholder="/" />
        </div>
      </Field>

      <Field label={tr('Network')}>
        <select value={form.network} onChange={e => set({ network: e.target.value })}>
          {!form.network && <option value="">{tr('Compose default')}</option>}
          {networkOptions.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>

      <ListSection
        title={tr('Ports')}
        hint={form.network === 'host' ? tr('Host network: the container uses the server’s ports directly.') : undefined}
        columns={['Host', 'Container', 'Protocol']}
        rows={form.ports}
        onChange={ports => set({ ports })}
        onAdd={() => ({ host: '', container: '', protocol: 'tcp' as Protocol })}
        render={(p, update) => (
          <>
            <input value={p.host} onChange={e => update({ host: e.target.value.replace(/\D/g, '') })} placeholder="8080" inputMode="numeric" />
            <input value={p.container} onChange={e => update({ container: e.target.value.replace(/\D/g, '') })} placeholder="80" inputMode="numeric" />
            <select value={p.protocol} onChange={e => update({ protocol: e.target.value as Protocol })}>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </>
        )}
      />

      <ListSection
        title={tr('Volumes')}
        columns={['Host', 'Container', 'Read-only']}
        rows={form.volumes}
        onChange={volumes => set({ volumes })}
        onAdd={() => ({ host: `${appData}/`, container: '', readOnly: false })}
        render={(v, update) => (
          <>
            <input value={v.host} onChange={e => update({ host: e.target.value })} placeholder={`${appData}/config`} spellCheck={false} />
            <input value={v.container} onChange={e => update({ container: e.target.value })} placeholder="/config" spellCheck={false} />
            <Switch checked={v.readOnly} onChange={readOnly => update({ readOnly })} label={tr('Read-only')} />
          </>
        )}
      />

      <ListSection
        title={tr('Environment Variables')}
        columns={['Key', 'Value']}
        rows={form.env}
        onChange={env => set({ env })}
        onAdd={() => ({ key: '', value: '' })}
        render={(e, update) => (
          <>
            <input value={e.key} onChange={ev => update({ key: ev.target.value })} placeholder="TZ" spellCheck={false} />
            <input value={e.value} onChange={ev => update({ value: ev.target.value })} placeholder={tr('Asia/Jakarta')} spellCheck={false} />
          </>
        )}
      />

      <ListSection
        title={tr('Devices')}
        columns={['Host', 'Container']}
        rows={form.devices}
        onChange={devices => set({ devices })}
        onAdd={() => ({ host: '/dev/', container: '' })}
        render={(d, update) => (
          <>
            <input value={d.host} onChange={e => update({ host: e.target.value })} placeholder="/dev/dri" spellCheck={false} />
            <input value={d.container} onChange={e => update({ container: e.target.value })} placeholder={tr('Same as host')} spellCheck={false} />
          </>
        )}
      />

      <button className={`ci-disclosure ${advanced ? 'is-open' : ''}`} onClick={() => onAdvanced(!advanced)}>
        <ChevronDown size={14} /> {tr('Advanced')}
      </button>
      {advanced && (
        <div className="ci-advanced">
          <Field label={tr('Container Command')}>
            <input value={form.command} onChange={e => set({ command: e.target.value })} placeholder={tr('e.g. --port 8080')} spellCheck={false} />
          </Field>
          <div className="ci-grid">
            <Field label={tr('Restart Policy')}>
              <select value={form.restart} onChange={e => set({ restart: e.target.value as Restart })}>
                <option value="unless-stopped">{tr('Unless stopped')}</option>
                <option value="always">{tr('Always')}</option>
                <option value="on-failure">{tr('On failure')}</option>
                <option value="no">{tr('Never')}</option>
              </select>
            </Field>
            <Field label={tr('Hostname')}>
              <input value={form.hostname} onChange={e => set({ hostname: e.target.value })} placeholder={tr('Container ID')} spellCheck={false} />
            </Field>
          </div>
          <div className="ci-grid">
            <Field label={tr('Memory Limit (MB)')}>
              <input value={form.memoryMb} onChange={e => set({ memoryMb: e.target.value.replace(/\D/g, '') })} placeholder={tr('No limit')} inputMode="numeric" />
            </Field>
            <Field label={tr('CPU Shares')}>
              <input value={form.cpuShares} onChange={e => set({ cpuShares: e.target.value.replace(/\D/g, '') })} placeholder="1024" inputMode="numeric" />
            </Field>
          </div>
          <Field label={tr('Capabilities')} hint={tr('Comma-separated, e.g. NET_ADMIN, SYS_TIME')}>
            <input value={form.capAdd} onChange={e => set({ capAdd: e.target.value })} placeholder={tr('None')} spellCheck={false} />
          </Field>
          <div className="ci-toggle">
            <span>
              {tr('Privileged')}
              <small>{tr('Full access to the server’s devices. Only for apps that need it.')}</small>
            </span>
            <Switch checked={form.privileged} onChange={privileged => set({ privileged })} label={tr('Privileged')} />
          </div>
        </div>
      )}
    </>
  )
}

/** The form for an existing spec (App Settings, App Store installs); null arrays become empty. */
export function formFromSpec(spec: CustomAppSpec): Form {
  return {
    image: spec.image ?? '',
    tag: spec.tag ?? '',
    title: spec.title ?? '',
    iconUrl: spec.iconUrl ?? '',
    scheme: spec.webUi?.scheme === 'https' ? 'https' : 'http',
    webPort: spec.webUi?.port ? String(spec.webUi.port) : '',
    webPath: spec.webUi?.path || '/',
    network: spec.network ?? '',
    ports: (spec.ports ?? []).map(p => ({ host: String(p.host || ''), container: String(p.container), protocol: p.protocol === 'udp' ? 'udp' : 'tcp' })),
    volumes: (spec.volumes ?? []).map(v => ({ ...v })),
    env: (spec.env ?? []).map(e => ({ ...e })),
    devices: (spec.devices ?? []).map(d => ({ ...d })),
    command: spec.command ?? '',
    restart: spec.restart || 'no',
    privileged: !!spec.privileged,
    memoryMb: spec.memoryMb ? String(spec.memoryMb) : '',
    cpuShares: spec.cpuShares ? String(spec.cpuShares) : '',
    capAdd: (spec.capAdd ?? []).join(', '),
    hostname: spec.hostname ?? '',
  }
}

export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="ci-field">
      <span className="ci-label">
        {label}
        {required && <i> *</i>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function IconField({ value, title, onChange }: { value: string; title: string; onChange: (url: string) => void }) {
  return (
    <Field label={tr('Icon URL')}>
      <div className="ci-icon">
        <AppIcon key={value} icon="boxes" iconUrl={value || undefined} color={['#64d2ff', '#2f6bff']} size={28} />
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={title ? `https://…/${slug(title)}.png` : tr('Your custom icon URL')} spellCheck={false} />
      </div>
    </Field>
  )
}

interface ListSectionProps<T> {
  title: string
  hint?: string
  columns: string[]
  rows: T[]
  onChange: (rows: T[]) => void
  onAdd: () => T
  render: (row: T, update: (patch: Partial<T>) => void) => ReactNode
}

export function ListSection<T>({ title, hint, columns, rows, onChange, onAdd, render }: ListSectionProps<T>) {
  return (
    <section className="ci-list">
      <div className="ci-list-head">
        <span className="ci-label">{title}</span>
        <button className="pill-btn" onClick={() => onChange([...rows, onAdd()])}>
          <Plus size={12} /> {tr('Add')}
        </button>
      </div>
      {hint && <small className="ci-list-hint">{hint}</small>}
      {rows.length > 0 && (
        <div className="ci-rows" style={{ '--cols': columns.length } as CSSProperties}>
          {columns.map(c => (
            <span key={c} className="ci-col">
              {c}
            </span>
          ))}
          <span />
          {rows.map((row, i) => (
            <div className="ci-row" key={i}>
              {render(row, patch => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))))}
              <button className="icon-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={tr('Remove {0} row', title)}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
