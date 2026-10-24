import { tr } from '../lib/i18n'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  BookOpen,
  Box,
  Boxes,
  ChevronDown,
  CircleCheck,
  Copy,
  Database,
  ExternalLink,
  FileCode,
  FileText,
  LayoutDashboard,
  ListTree,
  LoaderCircle,
  Minus,
  Network,
  Plus,
  RotateCw,
  Rocket,
  ScrollText,
  Terminal,
  Trash2,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { Job, K8sActionRequest, K8sPod, K8sResources, K8sStatus, K8sWorkload } from '../api/types'
import { usePresence } from '../hooks/usePresence'
import { PopUpButton } from '../components/PopUpButton'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { formatBytes } from '../lib/format'
import { useContextMenu } from '../lib/contextMenu'
import { K8S_TEMPLATES, quickDeployYaml, type K8sTemplate } from '../lib/k8sTemplates'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

type Section = 'overview' | 'workloads' | 'pods' | 'services' | 'storage' | 'events' | 'deploy' | 'learn'

const SECTIONS: { id: Section; label: string; icon: LucideIcon; group: string }[] = [
  { id: 'overview', label: tr('Overview'), icon: LayoutDashboard, group: 'Cluster' },
  { id: 'workloads', label: tr('Workloads'), icon: Boxes, group: 'Cluster' },
  { id: 'pods', label: tr('Pods'), icon: Box, group: 'Cluster' },
  { id: 'services', label: tr('Services'), icon: Network, group: 'Cluster' },
  { id: 'storage', label: tr('Storage'), icon: Database, group: 'Cluster' },
  { id: 'events', label: tr('Events'), icon: ScrollText, group: 'Cluster' },
  { id: 'deploy', label: tr('Deploy'), icon: Rocket, group: 'Do' },
  { id: 'learn', label: tr('Learn'), icon: BookOpen, group: 'Do' },
]

const POLL_MS = 3000
const ALL = ''

function age(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

const statusClass = (s: string) =>
  s === 'Running' || s === 'Succeeded' || s === 'Bound'
    ? 'is-ok'
    : /Pending|ContainerCreating|PodInitializing|Terminating/.test(s)
      ? 'is-wait'
      : 'is-bad'

interface CommandLog {
  command: string
  output: string
  ok: boolean
  at: number
}

/** Kubernetes (k3s): run and learn container orchestration, with the kubectl behind every click. */
export function Kubernetes() {
  const [status, setStatus] = useState<K8sStatus | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [namespace, setNamespace] = useState('lab')
  const [res, setRes] = useState<K8sResources | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<CommandLog[]>([])
  const [logOpen, setLogOpen] = useState(true)
  const [text, setText] = useState<{ title: string; body: string; command: string } | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  // Removing k3s (job "k8s"): while it runs the cluster stops answering on purpose, so the
  // window shows the removal instead of the errors that come with it.
  const [removal, setRemoval] = useState<Job | null>(null)
  const { show } = useContextMenu()
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, logOpen])

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.k8s()
      setStatus(s)
      // Start in the lab namespace when it exists, else everything.
      if (s.namespaces && !s.namespaces.includes(namespace) && namespace !== ALL) setNamespace(ALL)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    api.job('k8s').then(j => j.running && j.title?.startsWith('Removing') && setRemoval(j), () => {})
  }, [])
  useEffect(() => {
    if (!removal?.running) return
    const timer = setInterval(async () => {
      const next = await api.job('k8s').catch(() => null)
      if (!next) return
      setRemoval(next)
      if (!next.running) {
        setError(null)
        setRes(null)
        void loadStatus()
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [removal?.running, loadStatus])
  const remove = async () => {
    try {
      await api.uninstallK8s()
      setError(null)
      setRemoval(await api.job('k8s'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const removing = !!removal?.running

  const ready = !!status?.installed && !!status.nodes?.length && !removing
  const loadResources = useCallback(async () => {
    try {
      setRes(await api.k8sResources(namespace))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [namespace])
  useEffect(() => {
    if (!ready) return
    void loadResources()
    const timer = setInterval(() => {
      void loadResources()
      void api.k8s().then(setStatus, () => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [ready, loadResources])

  const record = (entry: Omit<CommandLog, 'at'>) => setLog(l => [...l.slice(-30), { ...entry, at: Date.now() }])

  /** Runs an action, remembers the kubectl it took, and refreshes. */
  const act = async (a: K8sActionRequest, key = `${a.kind}/${a.name}`) => {
    setBusy(b => new Set(b).add(key))
    try {
      const out = await api.k8sAction(a)
      record({ command: out.command, output: out.output, ok: true })
      return out
    } catch (err) {
      record({ command: `kubectl ${a.action} ${a.kind ?? ''} ${a.name ?? ''}`.trim(), output: err instanceof Error ? err.message : String(err), ok: false })
      throw err
    } finally {
      setBusy(b => {
        const next = new Set(b)
        next.delete(key)
        return next
      })
      void loadResources()
      void loadStatus()
    }
  }

  const view = async (v: 'logs' | 'describe' | 'yaml', kind: string, name: string, ns: string) => {
    const out = await api.k8sText(v, kind, name, ns)
    record({ command: out.command, output: '', ok: true })
    setText({ title: `${v === 'yaml' ? 'YAML' : v === 'logs' ? 'Logs' : 'Describe'} · ${kind}/${name}`, body: out.text, command: out.command })
  }

  useAppMenus(() => [
    {
      label: tr('View'),
      items: [
        ...SECTIONS.map(s => ({ label: s.label, icon: s.icon, checked: section === s.id, onSelect: () => setSection(s.id) })),
        'separator',
        { label: logOpen ? tr('Hide kubectl Log') : tr('Show kubectl Log'), icon: Terminal, onSelect: () => setLogOpen(o => !o) },
      ],
    },
  ])

  const current = SECTIONS.find(s => s.id === section)!
  const host = location.hostname

  return (
    <div className="split">
      <aside className="sidebar">
        {ready && (
          <div className="k8s-ns">
            <span>{tr('Namespace')}</span>
            <PopUpButton
              value={namespace}
              onChange={setNamespace}
              aria-label={tr('Namespace')}
              options={[{ value: ALL, label: tr('All namespaces') }, ...(status?.namespaces ?? []).map(n => ({ value: n, label: n }))]}
            />
          </div>
        )}
        {['Cluster', 'Do'].map(group => (
          <div key={group}>
            <div className="sidebar-group">{group === 'Do' ? tr('Get started') : group}</div>
            {SECTIONS.filter(s => s.group === group).map(({ id, label, icon: Icon }) => (
              <button key={id} className={`sidebar-item ${section === id ? 'is-active' : ''}`} onClick={() => setSection(id)} disabled={!ready && id !== 'learn' && id !== 'overview'}>
                <Icon size={15} /> {label}
                {id === 'pods' && res && <span className="sidebar-badge">{res.pods.length}</span>}
                {id === 'events' && res && res.events.some(e => e.type === 'Warning') && <span className="sidebar-badge is-warn">!</span>}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="pane k8s">
        <WindowToolbar>
          <ToolbarTitle title={current.label} subtitle={ready ? `k3s · ${namespace || tr('all namespaces')}` : tr('Kubernetes')} />
          <span className="tb-spacer" />
          {ready && (
            <div className="tb-group">
              <button className="tb-btn" onClick={() => setSection('deploy')} aria-label={tr('Deploy')} title={tr('Deploy')}>
                <Plus size={17} />
              </button>
              <button className={`tb-btn ${logOpen ? 'is-on' : ''}`} onClick={() => setLogOpen(o => !o)} aria-label={tr('kubectl log')} title={tr('Show the kubectl commands')}>
                <Terminal size={15} />
              </button>
            </div>
          )}
        </WindowToolbar>

        {error && !removing && <p className="form-error">{error}</p>}

        {removal && (removing || removal.exit !== 0) ? (
          <div className="su-job">
            <div className="su-job-head">
              {removing ? <LoaderCircle size={14} className="spin" /> : <TriangleAlert size={14} className="is-bad" />}
              <strong>{tr('Removing Kubernetes (k3s)')}</strong>
              <small>{removing ? tr('Working…') : tr('Failed')}</small>
            </div>
            <pre className="su-log">{removal.log.slice(-200).join('\n') || '…'}</pre>
          </div>
        ) : !status ? (
          <p className="am-empty">{tr('Checking the cluster…')}</p>
        ) : !status.installed ? (
          section === 'learn' ? <Learn /> : <InstallPanel onDone={() => void loadStatus()} />
        ) : !ready ? (
          <div className="group k8s-starting">
            <LoaderCircle size={16} className="spin" /> {status.error ? tr('The cluster isn’t answering: {0}', status.error) : tr('The cluster is starting…')}
          </div>
        ) : (
          <>
            {section === 'overview' && <Overview status={status} res={res} onSection={setSection} onRemove={() => void remove()} />}
            {section === 'workloads' && res && (
              <Workloads
                list={res.workloads}
                pods={res.pods}
                busy={busy}
                onAct={act}
                onView={view}
                onMenu={(e, items) => show(e, items)}
              />
            )}
            {section === 'pods' && res && <Pods list={res.pods} busy={busy} onAct={act} onView={view} />}
            {section === 'services' && res && (
              <div className="group k8s-list">
                {res.services.length === 0 && <p className="sh-empty">{tr('No services in this namespace.')}</p>}
                {res.services.map(s => (
                  <div key={`${s.namespace}/${s.name}`} className="k8s-row">
                    <span className={`k8s-kind is-svc`}>{s.type}</span>
                    <span className="k8s-main">
                      <strong>{s.name}</strong>
                      <small>
                        {s.namespace} · {s.clusterIP} {tr('· selects')} {Object.entries(s.selector ?? {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
                      </small>
                    </span>
                    <span className="k8s-ports">
                      {s.ports.map(p =>
                        p.nodePort ? (
                          <a key={p.port} href={`http://${host}:${p.nodePort}`} target="_blank" rel="noreferrer" className="pill-btn" title={tr('Port {0} inside the cluster, {1} on the server', p.port, p.nodePort)}>
                            <ExternalLink size={11} /> {host}:{p.nodePort}
                          </a>
                        ) : (
                          <code key={p.port}>
                            {p.port}→{p.targetPort}/{p.protocol}
                          </code>
                        ),
                      )}
                    </span>
                    <button className="icon-btn" onClick={() => void view('yaml', 'service', s.name, s.namespace)} title="YAML">
                      <FileCode size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {section === 'storage' && res && (
              <div className="group k8s-list">
                {res.volumes.length === 0 && <p className="sh-empty">{tr('No persistent volume claims.')}</p>}
                {res.volumes.map(v => (
                  <div key={`${v.namespace}/${v.name}`} className="k8s-row">
                    <span className="k8s-kind is-pvc">PVC</span>
                    <span className="k8s-main">
                      <strong>{v.name}</strong>
                      <small>
                        {v.namespace} · {v.storageClass} · {v.volume || tr('waiting for a pod')}
                      </small>
                    </span>
                    <span className={`k8s-status ${statusClass(v.status)}`}>{v.status}</span>
                    <span className="k8s-cap">{v.capacity}</span>
                  </div>
                ))}
                <p className="pane-note k8s-note">{tr('k3s stores volumes on the server’s disk (local-path) under /var/lib/rancher/k3s/storage.')}</p>
              </div>
            )}
            {section === 'events' && res && (
              <div className="group k8s-list">
                {res.events.length === 0 && <p className="sh-empty">{tr('No recent events.')}</p>}
                {res.events.map((e, i) => (
                  <div key={i} className={`k8s-event ${e.type === 'Warning' ? 'is-warn' : ''}`}>
                    <span className="k8s-event-time">{age(e.last)}</span>
                    <strong>{e.reason}</strong>
                    <code>{e.object}</code>
                    <span>
                      {e.message}
                      {e.count > 1 ? ` (×${e.count})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {section === 'deploy' && <Deploy namespace={namespace} onApply={act} onDone={ns => { setNamespace(ns); setSection('workloads') }} />}
            {section === 'learn' && <Learn />}
          </>
        )}

        {ready && logOpen && log.length > 0 && (
          <div className="k8s-log">
            <div className="k8s-log-head">
              <Terminal size={13} /> <strong>kubectl</strong>
              <small>{tr('the commands behind what you clicked')}</small>
              <button className="icon-btn" onClick={() => setLog([])} aria-label={tr('Clear')}>
                <Trash2 size={12} />
              </button>
            </div>
            <div className="k8s-log-body" ref={logRef}>
              {log.map(l => (
                <div key={l.at} className={l.ok ? '' : 'is-bad'}>
                  <button className="k8s-cmd" onClick={() => void copyText(l.command)} title={tr('Copy')}>
                    $ {l.command}
                  </button>
                  {l.output && <pre>{l.output}</pre>}
                </div>
              ))}
            </div>
          </div>
        )}

        <TextSheet text={text} onClose={() => setText(null)} />
      </div>
    </div>
  )
}

// ----- Install -----

function InstallPanel({ onDone }: { onDone: () => void }) {
  const [job, setJob] = useState<Job | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    api.job('k8s').then(setJob, () => {})
  }, [])
  useEffect(() => {
    if (!job?.running) return
    const timer = setInterval(async () => {
      const next = await api.job('k8s').catch(() => null)
      if (!next) return
      setJob(next)
      if (!next.running) onDone()
    }, 1500)
    return () => clearInterval(timer)
  }, [job?.running, onDone])
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log.length])

  return (
    <>
      <div className="group k8s-install">
        <Boxes size={40} />
        <div>
          <strong>{tr('Kubernetes isn’t installed yet')}</strong>
          <p>
            {tr('TemanLabsOS installs')} <b>k3s</b>{tr(', a certified, lightweight Kubernetes made for single servers. It runs next to Docker and CasaOS without touching them:')}
          </p>
          <ul>
            <li>{tr('Its own container runtime (containerd), separate from your Docker containers.')}</li>
            <li>{tr('Traefik is left out so port 80 stays with CasaOS; apps are opened on NodePorts (30000–32767).')}</li>
            <li>{tr('Uses about 500 MB of memory. It can be removed again from this window.')}</li>
          </ul>
          <button className="btn btn-primary" onClick={() => void api.installK8s().then(() => api.job('k8s').then(setJob))} disabled={!!job?.running}>
            {job?.running ? <LoaderCircle size={13} className="spin" /> : <Rocket size={13} />} {tr('Install Kubernetes (k3s)')}
          </button>
        </div>
      </div>
      {job && job.log.length > 0 && (
        <div className="su-job">
          <div className="su-job-head">
            {job.running ? <LoaderCircle size={14} className="spin" /> : job.exit === 0 ? <CircleCheck size={14} className="is-ok" /> : <TriangleAlert size={14} className="is-bad" />}
            <strong>{job.title}</strong>
          </div>
          <pre className="su-log" ref={logRef}>
            {job.log.join('\n')}
          </pre>
        </div>
      )}
    </>
  )
}

// ----- Overview -----

const CONFIRM_DELAY_MS = 600

function Overview({ status, res, onSection, onRemove }: { status: K8sStatus; res: K8sResources | null; onSection: (s: Section) => void; onRemove: () => void }) {
  // Two clicks, the second at least a moment after the first: a double-click can't remove k3s.
  const [armedAt, setArmedAt] = useState<number | null>(null)
  const confirmRemove = armedAt !== null
  const counts = [
    { label: tr('Workloads'), value: res?.workloads.length, section: 'workloads' as Section },
    { label: tr('Pods'), value: res?.pods.length, section: 'pods' as Section },
    { label: tr('Running'), value: res?.pods.filter(p => p.status === 'Running').length, section: 'pods' as Section },
    { label: tr('Services'), value: res?.services.length, section: 'services' as Section },
    { label: tr('Warnings'), value: res?.events.filter(e => e.type === 'Warning').length, section: 'events' as Section },
  ]
  return (
    <>
      {status.nodes?.map(n => (
        <div key={n.name} className="group k8s-node">
          <span className={`k8s-node-dot ${n.ready ? 'is-ok' : 'is-bad'}`} />
          <div className="k8s-node-main">
            <strong>
              {n.name} <small>{n.roles || 'worker'}</small>
            </strong>
            <span>
              {n.ready ? tr('Ready') : tr('Not ready')} {tr('· Kubernetes')} {n.version} · {n.runtime.replace('://', ' ')} · {n.ip}
            </span>
          </div>
          <div className="k8s-gauges">
            <Gauge label="CPU" pct={n.cpuPct} detail={tr('{0} of {1} cores', n.cpuUse ? cores(n.cpuUse).toFixed(2) : '—', cores(n.cpu))} />
            <Gauge label={tr('Memory')} pct={n.memPct} detail={`${n.memUse ? formatBytes(bytes(n.memUse)) : '—'} of ${formatBytes(bytes(n.memory))}`} />
          </div>
        </div>
      ))}
      <div className="k8s-counts">
        {counts.map(c => (
          <button key={c.label} className="group k8s-count" onClick={() => onSection(c.section)}>
            <strong>{c.value ?? '—'}</strong>
            <small>{c.label}</small>
          </button>
        ))}
      </div>
      {res && res.workloads.length === 0 && (
        <div className="group k8s-empty">
          <Rocket size={22} />
          <span>
            {tr('Nothing deployed here yet.')} <b>{tr('Deploy → Lab Stack')}</b> {tr('sets up web, database and monitoring in one click.')}
          </span>
          <button className="btn btn-primary" onClick={() => onSection('deploy')}>
            {tr('Deploy')}
          </button>
        </div>
      )}
      <div className="du-actions">
        <button
          className={`btn ${confirmRemove ? 'btn-danger' : ''}`}
          onClick={() => {
            if (armedAt === null) setArmedAt(Date.now())
            else if (Date.now() - armedAt > CONFIRM_DELAY_MS) onRemove()
          }}
          onBlur={() => setArmedAt(null)}
        >
          <Trash2 size={13} /> {confirmRemove ? tr('Click Again: removes k3s and everything in it') : tr('Remove Kubernetes…')}
        </button>
      </div>
    </>
  )
}

// Kubernetes quantities: CPU in cores or millicores ("803m"), memory with binary or decimal suffixes.
const cores = (q: string) => (q.endsWith('m') ? Number.parseFloat(q) / 1000 : Number.parseFloat(q))
const UNITS: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, k: 1e3, M: 1e6, G: 1e9, T: 1e12 }
const bytes = (q: string) => {
  const m = /^([\d.]+)([A-Za-z]*)$/.exec(q)
  return m ? Number.parseFloat(m[1]) * (UNITS[m[2]] ?? 1) : 0
}

function Gauge({ label, pct, detail }: { label: string; pct?: string; detail: string }) {
  const value = Number.parseInt(pct ?? '', 10) || 0
  return (
    <div className="k8s-gauge">
      <span>
        {label} <b>{pct ?? '—'}</b>
      </span>
      <i>
        <em style={{ width: `${Math.min(100, value)}%` }} />
      </i>
      <small>{detail}</small>
    </div>
  )
}

// ----- Workloads and pods -----

type Act = (a: K8sActionRequest, key?: string) => Promise<unknown>
type View = (v: 'logs' | 'describe' | 'yaml', kind: string, name: string, ns: string) => Promise<void>

function Workloads({
  list,
  pods,
  busy,
  onAct,
  onView,
  onMenu,
}: {
  list: K8sWorkload[]
  pods: K8sPod[]
  busy: ReadonlySet<string>
  onAct: Act
  onView: View
  onMenu: (e: React.MouseEvent, items: Parameters<ReturnType<typeof useContextMenu>['show']>[1]) => void
}) {
  const [imageFor, setImageFor] = useState<K8sWorkload | null>(null)
  const kindKey = (w: K8sWorkload) => w.kind.toLowerCase()
  return (
    <>
      <div className="group k8s-list">
        {list.length === 0 && <p className="sh-empty">{tr('No workloads. Deploy something from Deploy.')}</p>}
        {list.map(w => {
          const kind = kindKey(w)
          const key = `${kind}/${w.name}`
          const scalable = w.kind !== 'DaemonSet'
          const podCount = pods.filter(p => p.name.startsWith(`${w.name}-`)).length
          return (
            <div
              key={`${w.namespace}/${w.name}`}
              className="k8s-row"
              onContextMenu={e =>
                onMenu(e, [
                  { label: tr('Rolling Restart'), icon: RotateCw, onSelect: () => void onAct({ action: 'restart', kind, name: w.name, namespace: w.namespace }) },
                  { label: tr('Update Image…'), icon: Rocket, onSelect: () => setImageFor(w) },
                  { label: tr('Roll Back to Previous Version'), icon: Undo2, disabled: w.kind !== 'Deployment', onSelect: () => void onAct({ action: 'undo', kind, name: w.name, namespace: w.namespace }) },
                  'separator',
                  { label: tr('Describe'), icon: FileText, onSelect: () => void onView('describe', kind, w.name, w.namespace) },
                  { label: tr('View YAML'), icon: FileCode, onSelect: () => void onView('yaml', kind, w.name, w.namespace) },
                  'separator',
                  { label: tr('Delete {0}', w.kind), icon: Trash2, danger: true, confirm: tr('Click Again to Delete'), onSelect: () => void onAct({ action: 'delete', kind, name: w.name, namespace: w.namespace }) },
                ])
              }
            >
              <span className={`k8s-kind is-${kind}`}>{w.kind === 'StatefulSet' ? 'STS' : w.kind === 'DaemonSet' ? 'DS' : tr('DEPLOY')}</span>
              <span className="k8s-main">
                <strong>{w.name}</strong>
                <small>
                  {w.namespace} · {w.images.join(', ')} · {age(w.created)}
                </small>
              </span>
              <span className="k8s-ready" title={tr('{0} of {1} ready · {2} pods', w.ready, w.desired, podCount)}>
                <i>
                  <em className={w.ready >= w.desired ? 'is-ok' : 'is-wait'} style={{ width: `${w.desired ? (w.ready / w.desired) * 100 : 0}%` }} />
                </i>
                {w.ready}/{w.desired}
              </span>
              {scalable ? (
                <span className="k8s-stepper" title={tr('Replicas')}>
                  <button onClick={() => void onAct({ action: 'scale', kind, name: w.name, namespace: w.namespace, replicas: Math.max(0, w.desired - 1) }, key)} disabled={busy.has(key) || w.desired === 0} aria-label={tr('Fewer replicas')}>
                    <Minus size={12} />
                  </button>
                  <b>{w.desired}</b>
                  <button onClick={() => void onAct({ action: 'scale', kind, name: w.name, namespace: w.namespace, replicas: w.desired + 1 }, key)} disabled={busy.has(key) || w.desired >= 20} aria-label={tr('More replicas')}>
                    <Plus size={12} />
                  </button>
                </span>
              ) : (
                <span className="k8s-stepper is-auto" title={tr('A DaemonSet runs one pod on every node')}>{tr('1 per node')}</span>
              )}
              <button className="icon-btn" onClick={() => void onAct({ action: 'restart', kind, name: w.name, namespace: w.namespace }, key)} title={tr('Rolling restart')} aria-label={tr('Rolling restart')}>
                <RotateCw size={14} className={busy.has(key) ? 'spin' : ''} />
              </button>
              <button className="icon-btn" onClick={() => void onView('describe', kind, w.name, w.namespace)} title={tr('Describe')} aria-label={tr('Describe')}>
                <FileText size={14} />
              </button>
            </div>
          )
        })}
      </div>
      <p className="pane-note">
        {tr('Change the replicas and watch Pods: Kubernetes creates or removes pods until the actual state matches what you asked for. Right-click for rolling updates and rollbacks.')}
      </p>
      {imageFor && <ImageSheet workload={imageFor} onClose={() => setImageFor(null)} onSave={async (container, image) => {
        await onAct({ action: 'image', kind: kindKey(imageFor), name: imageFor.name, namespace: imageFor.namespace, container, image })
        setImageFor(null)
      }} />}
    </>
  )
}

function ImageSheet({ workload, onClose, onSave }: { workload: K8sWorkload; onClose: () => void; onSave: (container: string, image: string) => Promise<void> }) {
  const [image, setImage] = useState(workload.images[0] ?? '')
  const [container, setContainer] = useState(workload.name === 'web' ? 'nginx' : workload.name)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <form
        className="sheet sh-sheet ci"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          onSave(container, image).catch((err: Error) => setError(err.message))
        }}
      >
        <header className="ci-head">
          <strong>{tr('Rolling update ·')} {workload.name}</strong>
        </header>
        <div className="ci-body">
          <p className="pane-note">
            {tr('Kubernetes replaces pods a few at a time with the new image, so the service stays up. Try')} <code>nginx:1.26-alpine</code>{tr(', then roll back.')}
          </p>
          <label className="ci-field">
            <span className="ci-label">{tr('Container')}</span>
            <input value={container} onChange={e => setContainer(e.target.value)} spellCheck={false} />
          </label>
          <label className="ci-field">
            <span className="ci-label">{tr('New image')}</span>
            <input value={image} onChange={e => setImage(e.target.value)} spellCheck={false} autoFocus />
          </label>
        </div>
        <footer className="ci-foot">
          {error ? <p className="form-error">{error}</p> : <p className="form-hint">{tr('kubectl set image')} {workload.kind.toLowerCase()}/{workload.name} {container}={image}</p>}
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary">{tr('Update')}</button>
        </footer>
      </form>
    </div>
  )
}

function Pods({ list, busy, onAct, onView }: { list: K8sPod[]; busy: ReadonlySet<string>; onAct: Act; onView: View }) {
  const [hideSystem, setHideSystem] = useState(true)
  const shown = list.filter(p => !hideSystem || p.namespace !== 'kube-system')
  return (
    <>
      <label className="pv-toggle">
        <input type="checkbox" checked={hideSystem} onChange={e => setHideSystem(e.target.checked)} /> {tr('Hide Kubernetes’ own pods (kube-system)')}
      </label>
      <div className="group k8s-list">
        <div className="k8s-pod is-head">
          <span>{tr('Pod')}</span>
          <span>{tr('Status')}</span>
          <span>{tr('Ready')}</span>
          <span>{tr('Restarts')}</span>
          <span>CPU</span>
          <span>{tr('Memory')}</span>
          <span>IP</span>
          <span />
        </div>
        {shown.length === 0 && <p className="sh-empty">{tr('No pods.')}</p>}
        {shown.map(p => {
          const key = `pod/${p.name}`
          return (
            <div key={`${p.namespace}/${p.name}`} className="k8s-pod">
              <span className="k8s-main">
                <strong>{p.name}</strong>
                <small>
                  {p.namespace} · {p.owner ?? 'standalone'} · {age(p.created)}
                </small>
              </span>
              <span>
                <i className={`k8s-status ${statusClass(p.status)}`}>{p.status}</i>
              </span>
              <span>{p.ready}</span>
              <span className={p.restarts > 0 ? 'is-warn' : ''}>{p.restarts}</span>
              <span>{p.cpu ?? '—'}</span>
              <span>{p.memory ?? '—'}</span>
              <span>
                <code>{p.ip || '—'}</code>
              </span>
              <span className="k8s-pod-actions">
                <button className="icon-btn" onClick={() => void onView('logs', 'pod', p.name, p.namespace)} title={tr('Logs')} aria-label={tr('Logs')}>
                  <ScrollText size={13} />
                </button>
                <button className="icon-btn" onClick={() => void onView('describe', 'pod', p.name, p.namespace)} title={tr('Describe')} aria-label={tr('Describe')}>
                  <FileText size={13} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => void onAct({ action: 'delete', kind: 'pod', name: p.name, namespace: p.namespace }, key)}
                  disabled={busy.has(key)}
                  title={p.owner ? tr('Delete: its controller makes a new one (self-healing)') : tr('Delete')}
                  aria-label={tr('Delete pod')}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
      <p className="pane-note">
        {tr('Delete a pod that belongs to a ReplicaSet or StatefulSet: a replacement appears within seconds. That’s self-healing.')}
      </p>
    </>
  )
}

// ----- Deploy -----

function Deploy({ namespace, onApply, onDone }: { namespace: string; onApply: Act; onDone: (ns: string) => void }) {
  const [preview, setPreview] = useState<K8sTemplate | null>(null)
  const [yaml, setYaml] = useState('')
  const [quick, setQuick] = useState({ name: 'hello', image: 'traefik/whoami', replicas: 2, port: 80, nodePort: '30100' })
  const [done, setDone] = useState<K8sTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ns = namespace || 'default'

  const apply = async (text: string, template?: K8sTemplate) => {
    setError(null)
    try {
      await onApply({ action: 'apply', yaml: text, namespace: template ? '' : ns }, 'apply')
      setPreview(null)
      if (template) setDone(template)
      else onDone(ns)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {done && (
        <div className="group k8s-done">
          <CircleCheck size={20} className="is-ok" />
          <span>
            <strong>{done.name} {tr('deployed.')}</strong> {tr('Pods take a minute to pull their images. Open:')}
          </span>
          {done.opens?.map(o => (
            <a key={o.nodePort} className="pill-btn" href={`http://${location.hostname}:${o.nodePort}`} target="_blank" rel="noreferrer">
              <ExternalLink size={11} /> {o.label}
            </a>
          ))}
          <button className="btn" onClick={() => onDone(done.namespace)}>
            {tr('Watch the pods')}
          </button>
        </div>
      )}
      {error && <p className="form-error k8s-error">{error}</p>}

      <h4 className="du-heading">{tr('Templates')}</h4>
      <div className="k8s-templates">
        {K8S_TEMPLATES.map(t => (
          <div key={t.id} className={`group k8s-template ${t.id === 'lab' ? 'is-featured' : ''}`}>
            <strong>{t.name}</strong>
            <p>{t.description}</p>
            <div className="k8s-template-actions">
              <button className="btn" onClick={() => setPreview(t)}>
                <FileCode size={13} /> {tr('View YAML')}
              </button>
              <button className="btn btn-primary" onClick={() => void apply(t.yaml, t)}>
                <Rocket size={13} /> {tr('Deploy')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <h4 className="du-heading">{tr('Quick deploy')}</h4>
      <form
        className="group k8s-quick"
        onSubmit={e => {
          e.preventDefault()
          void apply(quickDeployYaml({ ...quick, namespace: ns, nodePort: Number(quick.nodePort) || undefined }))
        }}
      >
        <input value={quick.name} onChange={e => setQuick({ ...quick, name: e.target.value.toLowerCase() })} placeholder="name" aria-label={tr('Name')} />
        <input value={quick.image} onChange={e => setQuick({ ...quick, image: e.target.value })} placeholder="image" aria-label={tr('Image')} />
        <label>
          {tr('replicas')} <input type="number" min={1} max={20} value={quick.replicas} onChange={e => setQuick({ ...quick, replicas: Number(e.target.value) })} />
        </label>
        <label>
          {tr('port')} <input type="number" value={quick.port} onChange={e => setQuick({ ...quick, port: Number(e.target.value) })} />
        </label>
        <label>
          {tr('NodePort')} <input value={quick.nodePort} onChange={e => setQuick({ ...quick, nodePort: e.target.value.replace(/\D/g, '') })} placeholder="30000–32767" />
        </label>
        <button className="btn btn-primary">{tr('Deploy to')} {ns}</button>
      </form>

      <h4 className="du-heading">{tr('Apply YAML')}</h4>
      <div className="group k8s-yaml">
        <textarea value={yaml} onChange={e => setYaml(e.target.value)} spellCheck={false} placeholder={tr("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\ndata:\n  hello: world")} />
        <div className="k8s-template-actions">
          <small className="form-hint">{tr('kubectl apply -f - (namespace')} {ns} {tr('unless the manifest names one)')}</small>
          <button className="btn btn-primary" onClick={() => void apply(yaml)} disabled={!yaml.trim()}>
            {tr('Apply')}
          </button>
        </div>
      </div>

      {preview && (
        <TextSheet
          text={{ title: tr('{0} · YAML', preview.name), body: preview.yaml, command: 'kubectl apply -f lab.yaml' }}
          onClose={() => setPreview(null)}
          action={
            <button className="btn btn-primary" onClick={() => void apply(preview.yaml, preview)}>
              <Rocket size={13} /> {tr('Deploy')}
            </button>
          }
        />
      )}
    </>
  )
}

// ----- Learn -----

const CONCEPTS: { term: string; text: string; command: string }[] = [
  { term: 'Cluster & Node', text: tr('A cluster is the set of machines Kubernetes manages; each machine is a node. Here it’s one node: this server.'), command: 'kubectl get nodes -o wide' },
  { term: 'Pod', text: tr('The smallest unit: one or more containers that share an IP address and storage. Pods are disposable.'), command: 'kubectl get pods -n lab' },
  { term: 'Deployment', text: tr('Keeps a number of identical pods (replicas) running through a ReplicaSet, and replaces them gradually on updates.'), command: 'kubectl get deployments -n lab' },
  { term: 'StatefulSet', text: tr('Like a Deployment, for databases: stable pod names (db-0) and a volume of their own per pod.'), command: 'kubectl get statefulsets -n lab' },
  { term: 'DaemonSet', text: tr('Runs exactly one pod on every node, for agents like node-exporter.'), command: 'kubectl get daemonsets -n lab' },
  { term: 'Service', text: tr('A stable name and IP in front of a set of pods (chosen by labels), spreading traffic over them. NodePort also opens it on the server.'), command: 'kubectl get svc -n lab' },
  { term: 'ConfigMap & Secret', text: tr('Configuration and passwords kept outside the image, given to pods as files or environment variables.'), command: 'kubectl get configmaps,secrets -n lab' },
  { term: 'PersistentVolumeClaim', text: tr('A request for storage that outlives the pod, so the database keeps its data across restarts.'), command: 'kubectl get pvc -n lab' },
  { term: 'Namespace', text: tr('A folder for resources: “lab” keeps the assignment apart from Kubernetes’ own kube-system.'), command: 'kubectl get namespaces' },
  { term: 'Desired state', text: tr('You declare what should exist (YAML); controllers keep working until reality matches. That loop is orchestration.'), command: 'kubectl apply -f lab.yaml' },
]

const EXERCISES: { title: string; steps: string; command: string }[] = [
  { title: tr('1. Deploy the lab'), steps: tr('Deploy → Lab Stack. Watch Pods go from ContainerCreating to Running.'), command: 'kubectl apply -f lab.yaml && kubectl get pods -n lab -w' },
  { title: tr('2. Load balancing'), steps: tr('Open the web NodePort and reload: the pod name on the page changes between replicas.'), command: 'curl -s http://SERVER:30080 | grep -o "web-[a-z0-9-]*"' },
  { title: tr('3. Scaling'), steps: tr('Workloads → web → +/−. Kubernetes adds or removes pods to match.'), command: 'kubectl scale deployment web -n lab --replicas=5' },
  { title: tr('4. Self-healing'), steps: tr('Pods → delete a web pod. A new one is created straight away.'), command: 'kubectl delete pod -n lab -l app=web --wait=false' },
  { title: tr('5. Rolling update & rollback'), steps: tr('Right-click web → Update Image → nginx:1.26-alpine; then Roll Back.'), command: 'kubectl set image deployment/web nginx=nginx:1.26-alpine -n lab && kubectl rollout undo deployment/web -n lab' },
  { title: tr('6. Persistence'), steps: tr('Create a table in Adminer (server db, user lab, password lab-password), delete pod db-0, check the table is still there.'), command: 'kubectl delete pod db-0 -n lab' },
  { title: tr('7. Monitoring'), steps: tr('Open Grafana (admin/admin): the Server dashboard shows CPU, memory, network and disk from Prometheus.'), command: 'kubectl port-forward -n lab svc/grafana 3000:3000' },
]

function Learn() {
  const [open, setOpen] = useState<string | null>(CONCEPTS[0].term)
  return (
    <>
      <p className="pane-note">
        {tr('Kubernetes orchestrates containers: you describe the services you want, and it schedules, connects, scales and heals them. Docker runs containers; Kubernetes decides where and how many, and keeps them that way.')}
      </p>
      <h4 className="du-heading">{tr('Concepts')}</h4>
      <div className="group k8s-learn">
        {CONCEPTS.map(c => (
          <div key={c.term} className={`k8s-concept ${open === c.term ? 'is-open' : ''}`}>
            <button onClick={() => setOpen(o => (o === c.term ? null : c.term))}>
              <ChevronDown size={13} /> {c.term}
            </button>
            {open === c.term && (
              <div>
                <p>{c.text}</p>
                <CopyCommand command={c.command} />
              </div>
            )}
          </div>
        ))}
      </div>
      <h4 className="du-heading">{tr('Exercises for the assignment')}</h4>
      <div className="group k8s-learn">
        {EXERCISES.map(e => (
          <div key={e.title} className="k8s-exercise">
            <strong>{e.title}</strong>
            <p>{e.steps}</p>
            <CopyCommand command={e.command} />
          </div>
        ))}
      </div>
      <p className="pane-note">
        <ListTree size={12} /> {tr('Every button in this window shows the kubectl command it ran in the kubectl panel; Terminal has')}{' '}
        <code>sudo k3s kubectl</code> {tr('for trying them by hand.')}
      </p>
    </>
  )
}

function CopyCommand({ command }: { command: string }) {
  return (
    <button className="k8s-copy" onClick={() => void copyText(command)} title={tr('Copy')}>
      <code>$ {command}</code> <Copy size={11} />
    </button>
  )
}

// ----- Text viewer (logs, describe, YAML) -----

function TextSheet({ text, onClose, action }: { text: { title: string; body: string; command: string } | null; onClose: () => void; action?: ReactNode }) {
  const { mounted, closing } = usePresence(!!text, 220)
  const [last, setLast] = useState(text)
  if (text && text !== last) setLast(text)
  if (!mounted || !last) return null
  return (
    <div className={`sheet-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet k8s-text">
        <header className="ci-head">
          <strong>{last.title}</strong>
          <button className="icon-btn" onClick={() => void copyText(last.body)} title={tr('Copy')} aria-label={tr('Copy')}>
            <Copy size={14} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            ×
          </button>
        </header>
        <pre>{last.body || '(empty)'}</pre>
        <footer className="ci-foot">
          <code className="k8s-text-cmd">$ {last.command}</code>
          {action}
          <button className="btn" onClick={onClose}>
            {tr('Close')}
          </button>
        </footer>
      </div>
    </div>
  )
}

