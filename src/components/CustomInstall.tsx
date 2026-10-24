import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ClipboardPaste, LoaderCircle, Plus, Terminal, X } from 'lucide-react'
import { api } from '../api'
import type { CustomAppSpec } from '../api/types'
import { usePresence } from '../hooks/usePresence'
import { parseDockerRun } from '../lib/dockerRun'
import { DATA_ROOT } from '../lib/places'
import { AppIcon } from './AppIcon'
import { Switch } from './Switch'

type Mode = 'form' | 'compose'
type Protocol = 'tcp' | 'udp'
type Restart = CustomAppSpec['restart']

// Numbers are kept as strings while editing, so a field can be empty.
interface Form {
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

const EMPTY: Form = {
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

function toSpec(f: Form, mode: Mode, compose: string): CustomAppSpec {
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
  const [form, setForm] = useState<Form>(EMPTY)
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
      setImportNote(skipped.length ? `Not imported: ${skipped.join(', ')}` : null)
      setImporting(false)
      setError(null)
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : String(err))
    }
  }

  const submit = async () => {
    if (mode === 'form' && (!form.image.trim() || !form.title.trim())) {
      setError('Docker Image and Title are required.')
      return
    }
    if (mode === 'compose' && !compose.trim()) {
      setError('Paste a docker-compose.yml first.')
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
        aria-label="Manual App Install"
      >
        <header className="ci-head">
          <strong>Manual App Install</strong>
          <div className="segmented ci-modes">
            <button className={mode === 'form' ? 'is-active' : ''} onClick={() => setMode('form')}>
              Configure
            </button>
            <button className={mode === 'compose' ? 'is-active' : ''} onClick={() => setMode('compose')}>
              Docker Compose
            </button>
          </div>
          {mode === 'form' && (
            <button className={`pill-btn ${importing ? 'is-on' : ''}`} onClick={() => setImporting(i => !i)} title="Fill the form from a docker run command">
              <Terminal size={13} /> Import docker run
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
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
                placeholder={'docker run -d --name=whoami -p 8080:80 \\\n  -v /DATA/AppData/whoami:/data traefik/whoami'}
                spellCheck={false}
              />
              <button className="btn btn-primary" onClick={importRun} disabled={!runCommand.trim()}>
                <ClipboardPaste size={13} /> Fill Form
              </button>
            </div>
          )}
          {importNote && <p className="ci-note">{importNote}</p>}

          {mode === 'compose' ? (
            <>
              <div className="ci-grid">
                <Field label="Title" hint="Optional; taken from the file when empty">
                  <input ref={firstField} value={form.title} onChange={e => set({ title: e.target.value })} placeholder="Your App Name" />
                </Field>
                <IconField value={form.iconUrl} title={form.title} onChange={iconUrl => set({ iconUrl })} />
              </div>
              <Field label="docker-compose.yml" hint="CasaOS app files keep their title, icon and web UI (x-casaos).">
                <textarea
                  className="ci-compose"
                  value={compose}
                  onChange={e => setCompose(e.target.value)}
                  spellCheck={false}
                  placeholder={'services:\n  whoami:\n    image: traefik/whoami\n    ports:\n      - "8080:80"'}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="ci-grid ci-image">
                <Field label="Docker Image" required>
                  <input
                    ref={firstField}
                    value={form.image}
                    onChange={e => set({ image: e.target.value })}
                    placeholder="e.g. hello-world:latest"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </Field>
                <Field label="Tag">
                  <input value={form.tag} onChange={e => set({ tag: e.target.value })} placeholder="latest" spellCheck={false} />
                </Field>
              </div>
              <div className="ci-grid">
                <Field label="Title" required>
                  <input value={form.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Your App Name" />
                </Field>
                <IconField value={form.iconUrl} title={form.title} onChange={iconUrl => set({ iconUrl })} />
              </div>

              <Field label="Web UI" hint="Leave the port empty to use the first published TCP port.">
                <div className="ci-webui">
                  <select value={form.scheme} onChange={e => set({ scheme: e.target.value as Form['scheme'] })}>
                    <option value="http">http://</option>
                    <option value="https">https://</option>
                  </select>
                  <span className="ci-host">{location.hostname}</span>
                  <input value={form.webPort} onChange={e => set({ webPort: e.target.value.replace(/\D/g, '') })} placeholder=":Port" inputMode="numeric" />
                  <input value={form.webPath} onChange={e => set({ webPath: e.target.value })} placeholder="/" />
                </div>
              </Field>

              <Field label="Network">
                <select value={form.network} onChange={e => set({ network: e.target.value })}>
                  {networks.map(n => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>

              <ListSection
                title="Ports"
                hint={form.network === 'host' ? 'Host network: the container uses the server’s ports directly.' : undefined}
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
                title="Volumes"
                columns={['Host', 'Container', 'Read-only']}
                rows={form.volumes}
                onChange={volumes => set({ volumes })}
                onAdd={() => ({ host: `${appData}/`, container: '', readOnly: false })}
                render={(v, update) => (
                  <>
                    <input value={v.host} onChange={e => update({ host: e.target.value })} placeholder={`${appData}/config`} spellCheck={false} />
                    <input value={v.container} onChange={e => update({ container: e.target.value })} placeholder="/config" spellCheck={false} />
                    <Switch checked={v.readOnly} onChange={readOnly => update({ readOnly })} label="Read-only" />
                  </>
                )}
              />

              <ListSection
                title="Environment Variables"
                columns={['Key', 'Value']}
                rows={form.env}
                onChange={env => set({ env })}
                onAdd={() => ({ key: '', value: '' })}
                render={(e, update) => (
                  <>
                    <input value={e.key} onChange={ev => update({ key: ev.target.value })} placeholder="TZ" spellCheck={false} />
                    <input value={e.value} onChange={ev => update({ value: ev.target.value })} placeholder="Asia/Jakarta" spellCheck={false} />
                  </>
                )}
              />

              <ListSection
                title="Devices"
                columns={['Host', 'Container']}
                rows={form.devices}
                onChange={devices => set({ devices })}
                onAdd={() => ({ host: '/dev/', container: '' })}
                render={(d, update) => (
                  <>
                    <input value={d.host} onChange={e => update({ host: e.target.value })} placeholder="/dev/dri" spellCheck={false} />
                    <input value={d.container} onChange={e => update({ container: e.target.value })} placeholder="Same as host" spellCheck={false} />
                  </>
                )}
              />

              <button className={`ci-disclosure ${advanced ? 'is-open' : ''}`} onClick={() => setAdvanced(a => !a)}>
                <ChevronDown size={14} /> Advanced
              </button>
              {advanced && (
                <div className="ci-advanced">
                  <Field label="Container Command">
                    <input value={form.command} onChange={e => set({ command: e.target.value })} placeholder="e.g. --port 8080" spellCheck={false} />
                  </Field>
                  <div className="ci-grid">
                    <Field label="Restart Policy">
                      <select value={form.restart} onChange={e => set({ restart: e.target.value as Restart })}>
                        <option value="unless-stopped">Unless stopped</option>
                        <option value="always">Always</option>
                        <option value="on-failure">On failure</option>
                        <option value="no">Never</option>
                      </select>
                    </Field>
                    <Field label="Hostname">
                      <input value={form.hostname} onChange={e => set({ hostname: e.target.value })} placeholder="Container ID" spellCheck={false} />
                    </Field>
                  </div>
                  <div className="ci-grid">
                    <Field label="Memory Limit (MB)">
                      <input value={form.memoryMb} onChange={e => set({ memoryMb: e.target.value.replace(/\D/g, '') })} placeholder="No limit" inputMode="numeric" />
                    </Field>
                    <Field label="CPU Shares">
                      <input value={form.cpuShares} onChange={e => set({ cpuShares: e.target.value.replace(/\D/g, '') })} placeholder="1024" inputMode="numeric" />
                    </Field>
                  </div>
                  <Field label="Capabilities" hint="Comma-separated, e.g. NET_ADMIN, SYS_TIME">
                    <input value={form.capAdd} onChange={e => set({ capAdd: e.target.value })} placeholder="None" spellCheck={false} />
                  </Field>
                  <div className="ci-toggle">
                    <span>
                      Privileged
                      <small>Full access to the server’s devices. Only for apps that need it.</small>
                    </span>
                    <Switch checked={form.privileged} onChange={privileged => set({ privileged })} label="Privileged" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="ci-foot">
          {error ? <p className="form-error">{error}</p> : <p className="form-hint">The image is pulled on the server; big images take a while.</p>}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <LoaderCircle size={13} className="spin" /> : null} Install
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
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

function IconField({ value, title, onChange }: { value: string; title: string; onChange: (url: string) => void }) {
  return (
    <Field label="Icon URL">
      <div className="ci-icon">
        <AppIcon key={value} icon="boxes" iconUrl={value || undefined} color={['#64d2ff', '#2f6bff']} size={28} />
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={title ? `https://…/${slug(title)}.png` : 'Your custom icon URL'} spellCheck={false} />
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

function ListSection<T>({ title, hint, columns, rows, onChange, onAdd, render }: ListSectionProps<T>) {
  return (
    <section className="ci-list">
      <div className="ci-list-head">
        <span className="ci-label">{title}</span>
        <button className="pill-btn" onClick={() => onChange([...rows, onAdd()])}>
          <Plus size={12} /> Add
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
              <button className="icon-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${title} row`}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
