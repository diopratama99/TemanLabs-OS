import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Copy, LoaderCircle, Plus, Shield, ShieldOff, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { FirewallRule, NetConnection, NetInterface } from '../api/types'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { formatBytes, formatSpeed } from '../lib/format'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { tr } from '../lib/i18n'

type Tab = 'info' | 'ping' | 'trace' | 'lookup' | 'connections' | 'firewall'

const TABS: { id: Tab; label: string }[] = [
  { id: 'info', label: tr('Info') },
  { id: 'ping', label: tr('Ping') },
  { id: 'trace', label: tr('Traceroute') },
  { id: 'lookup', label: tr('Lookup') },
  { id: 'connections', label: tr('Connections') },
  { id: 'firewall', label: tr('Firewall') },
]

const INFO_POLL_MS = 2000

/** Network Tools: interfaces, ping, traceroute, DNS lookup, connections and the firewall. */
export function NetworkTools() {
  const [tab, setTab] = useState<Tab>('info')
  useAppMenus(() => [
    { label: tr('View'), items: TABS.map(t => ({ label: t.label, checked: tab === t.id, onSelect: () => setTab(t.id) })) },
  ])
  return (
    <div className="pane nu">
      <WindowToolbar>
        <ToolbarTitle title={tr('Network Tools')} />
        <span className="tb-spacer" />
        <div className="tb-segmented">
          {TABS.map(t => (
            <button key={t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="tb-spacer" />
      </WindowToolbar>
      {tab === 'info' && <InfoTab />}
      {tab === 'ping' && <ToolTab tool="ping" />}
      {tab === 'trace' && <ToolTab tool="traceroute" />}
      {tab === 'lookup' && <LookupTab />}
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'firewall' && <FirewallTab />}
    </div>
  )
}

function InfoTab() {
  const [list, setList] = useState<NetInterface[]>([])
  const [rates, setRates] = useState<Record<string, { rx: number; tx: number }>>({})
  const [showVirtual, setShowVirtual] = useState(false)
  const prev = useRef<{ at: number; list: NetInterface[] } | null>(null)

  useEffect(() => {
    const load = async () => {
      const next = await api.interfaces().catch(() => null)
      if (!next) return
      const now = Date.now()
      if (prev.current) {
        const secs = (now - prev.current.at) / 1000
        const r: Record<string, { rx: number; tx: number }> = {}
        for (const n of next) {
          const p = prev.current.list.find(x => x.name === n.name)
          if (p && secs > 0) r[n.name] = { rx: Math.max(0, (n.rxBytes - p.rxBytes) / secs), tx: Math.max(0, (n.txBytes - p.txBytes) / secs) }
        }
        setRates(r)
      }
      prev.current = { at: now, list: next }
      setList(next)
    }
    void load()
    const timer = setInterval(load, INFO_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const shown = list.filter(n => showVirtual || !n.virtual)
  return (
    <>
      <div className="nu-cards">
        {shown.map(n => (
          <div key={n.name} className="group nu-card">
            <div className="nu-card-head">
              <i className={`nu-dot ${n.state === 'up' || n.state === 'unknown' ? 'is-up' : ''}`} />
              <strong>{n.name === 'tailscale0' ? tr('Tailscale') : n.name}</strong>
              <small>{n.name === 'tailscale0' ? n.name : n.virtual ? tr('Virtual (Docker)') : n.speedMbps ? `${n.speedMbps >= 1000 ? `${n.speedMbps / 1000} Gb/s` : `${n.speedMbps} Mb/s`}` : n.state}</small>
            </div>
            {n.addresses.map(a => (
              <button key={a} className="nu-addr" onClick={() => void copyText(a.split('/')[0])} title={tr('Copy')}>
                {a} <Copy size={11} />
              </button>
            ))}
            {n.mac && <small className="nu-mac">MAC {n.mac}</small>}
            <div className="nu-traffic">
              <span>
                <ArrowDown size={12} /> {formatSpeed(rates[n.name]?.rx ?? 0)}
              </span>
              <span>
                <ArrowUp size={12} /> {formatSpeed(rates[n.name]?.tx ?? 0)}
              </span>
              <small>
                {tr('Total ↓')} {formatBytes(n.rxBytes)} ↑ {formatBytes(n.txBytes)}
              </small>
            </div>
          </div>
        ))}
      </div>
      <label className="pv-toggle nu-virtual">
        <input type="checkbox" checked={showVirtual} onChange={e => setShowVirtual(e.target.checked)} /> {tr('Show Docker’s virtual interfaces (')}
        {list.filter(n => n.virtual).length})
      </label>
    </>
  )
}

function ToolTab({ tool }: { tool: 'ping' | 'traceroute' }) {
  const [host, setHost] = useState(tool === 'ping' ? '1.1.1.1' : 'google.com')
  const [count, setCount] = useState(4)
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const run = async (e: FormEvent) => {
    e.preventDefault()
    setRunning(true)
    setOutput(tool === 'ping' ? `Pinging ${host}…` : `Tracing the route to ${host}… this can take up to a minute.`)
    try {
      const res = await api.netTool(tool, host.trim(), count)
      setOutput(res.output || (res.ok ? 'Done.' : 'No reply.'))
    } catch (err) {
      setOutput(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }
  return (
    <>
      <form className="nu-form" onSubmit={e => void run(e)}>
        <input value={host} onChange={e => setHost(e.target.value)} placeholder={tr('Host name or IP address')} spellCheck={false} />
        {tool === 'ping' && (
          <select value={count} onChange={e => setCount(Number(e.target.value))} aria-label={tr('Number of pings')}>
            {[1, 4, 10, 20].map(n => (
              <option key={n} value={n}>
                {n} ping{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-primary" disabled={running || !host.trim()}>
          {running ? <LoaderCircle size={13} className="spin" /> : null} {tool === 'ping' ? tr('Ping') : tr('Trace')}
        </button>
      </form>
      <p className="pane-note">{tr('From the server: shows whether it can reach the host, and how fast.')}</p>
      <pre className="nu-output">{output || ' '}</pre>
    </>
  )
}

function LookupTab() {
  const [name, setName] = useState('google.com')
  const [result, setResult] = useState<{ records: Record<string, string[]>; resolvers: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const run = async (e: FormEvent) => {
    e.preventDefault()
    setRunning(true)
    setError(null)
    try {
      setResult(await api.dnsLookup(name.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }
  return (
    <>
      <form className="nu-form" onSubmit={e => void run(e)}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={tr('Domain name or IP address')} spellCheck={false} />
        <button className="btn btn-primary" disabled={running || !name.trim()}>
          {running ? <LoaderCircle size={13} className="spin" /> : null} {tr('Lookup')}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {result && (
        <div className="group">
          {Object.keys(result.records).length === 0 && <p className="sh-empty">{tr('No records found.')}</p>}
          {Object.entries(result.records).map(([kind, values]) => (
            <div key={kind} className="row nu-record">
              <span className="nu-kind">{kind}</span>
              <span className="nu-values">
                {values.map(v => (
                  <code key={v}>{v}</code>
                ))}
              </span>
            </div>
          ))}
          <div className="row">
            <span>{tr('Resolver')}</span>
            <span className="row-value">{result.resolvers.join(', ') || tr('system default')}</span>
          </div>
        </div>
      )}
    </>
  )
}

function ConnectionsTab() {
  const [list, setList] = useState<NetConnection[] | null>(null)
  const [onlyEstablished, setOnlyEstablished] = useState(true)
  useEffect(() => {
    const load = () => api.connections().then(setList, () => {})
    void load()
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [])
  const shown = (list ?? []).filter(c => !onlyEstablished || c.state === 'estab')
  // Loopback chatter between local services isn't what people look for here.
  const outside = shown.filter(c => !c.peer.startsWith('127.') && !c.peer.startsWith('[::1]') && !c.peer.startsWith('[::ffff:127.'))
  return (
    <>
      <label className="pv-toggle">
        <input type="checkbox" checked={onlyEstablished} onChange={e => setOnlyEstablished(e.target.checked)} /> {tr('Only open connections')}
      </label>
      <div className="group nu-conns">
        <div className="nu-conn is-head">
          <span>{tr('Process')}</span>
          <span>{tr('Remote')}</span>
          <span>{tr('Local')}</span>
          <span>{tr('State')}</span>
        </div>
        {!list && <p className="sh-empty">{tr('Loading…')}</p>}
        {list && outside.length === 0 && <p className="sh-empty">{tr('No connections from other machines.')}</p>}
        {outside.map((c, i) => (
          <div key={`${c.local}-${c.peer}-${i}`} className="nu-conn">
            <span>
              {c.process ?? '—'}
              {c.pid ? <small> {c.pid}</small> : null}
            </span>
            <span>{c.peer}</span>
            <span>{c.local}</span>
            <span>
              {c.protocol.toUpperCase()} {c.state}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function FirewallTab() {
  const [state, setState] = useState<{ enabled: boolean; rules: FirewallRule[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ action: 'allow', port: '', protocol: 'tcp', from: '' })
  const [confirmOff, setConfirmOff] = useState(false)
  const load = useCallback(async () => {
    try {
      setState(await api.firewall())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const change = async (c: Parameters<typeof api.changeFirewall>[0]) => {
    setError(null)
    try {
      await api.changeFirewall(c)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <>
      <div className={`group fw-status ${state?.enabled ? 'is-on' : ''}`}>
        {state?.enabled ? <Shield size={26} /> : <ShieldOff size={26} />}
        <span>
          <strong>{state ? (state.enabled ? tr('Firewall is on') : tr('Firewall is off')) : '…'}</strong>
          <small>
            {state?.enabled
              ? tr('Only ports allowed below accept connections. SSH and TemanLabsOS stay open.')
              : tr('Every port is reachable from the network. Turning it on keeps SSH (22) and TemanLabsOS open.')}
          </small>
        </span>
        {state &&
          (state.enabled ? (
            <button
              className={`btn ${confirmOff ? 'btn-danger' : ''}`}
              onClick={() => (confirmOff ? void change({ op: 'disable' }).then(() => setConfirmOff(false)) : setConfirmOff(true))}
              onBlur={() => setConfirmOff(false)}
            >
              {confirmOff ? tr('Click Again to Turn Off') : tr('Turn Off')}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void change({ op: 'enable' })}>
              {tr('Turn On')}
            </button>
          ))}
      </div>
      <p className="pane-note">
        {tr('Note: ports published by Docker containers bypass this firewall (Docker adds its own rules).')}
      </p>
      {error && <p className="form-error">{error}</p>}
      <form
        className="nu-form fw-add"
        onSubmit={e => {
          e.preventDefault()
          void change({ op: 'add', ...form }).then(() => setForm(f => ({ ...f, port: '', from: '' })))
        }}
      >
        <select value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} aria-label={tr('Action')}>
          <option value="allow">{tr('Allow')}</option>
          <option value="deny">{tr('Block')}</option>
          <option value="limit">{tr('Limit (anti brute force)')}</option>
        </select>
        <input value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} placeholder={tr('Port, e.g. 8080')} />
        <select value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })} aria-label={tr('Protocol')}>
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
          <option value="">{tr('TCP & UDP')}</option>
        </select>
        <input value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} placeholder={tr('From (any, IP, 192.168.1.0/24)')} />
        <button className="btn" disabled={!form.port}>
          <Plus size={13} /> {tr('Add Rule')}
        </button>
      </form>
      <div className="group">
        {state && state.rules.length === 0 && <p className="sh-empty">{tr('No rules yet.')}</p>}
        {state?.rules.map(r => (
          <div key={r.number} className="row fw-rule">
            <span className={`fw-action is-${r.action.toLowerCase()}`}>{r.action}</span>
            <span className="fw-to">
              {r.to}
              {r.v6 && <small> {tr('IPv6')}</small>}
            </span>
            <span className="fw-from">{tr('from')} {r.from}</span>
            <button className="icon-btn" onClick={() => void change({ op: 'delete', number: r.number })} aria-label={tr('Delete rule')} title={tr('Delete rule')}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
