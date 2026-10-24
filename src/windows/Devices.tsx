import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  Copy,
  Cpu,
  Ellipsis,
  Laptop,
  LoaderCircle,
  Monitor,
  MonitorPlay,
  MonitorSmartphone,
  Pencil,
  Plus,
  Power,
  Radar,
  Search,
  Server,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import type { Device, DeviceInput, DeviceKind, DeviceStatus, FoundDevice, RemoteEngine, ScreenProtocol } from '../api/types'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { tr } from '../lib/i18n'

// Devices: the other computers on the network. The server is always on and on the same network,
// so from anywhere (through it) they can be woken up and their screens shown in a window.

const STATUS_POLL_MS = 5000
// While a device is waking, look more often, and give up on "waking" after two minutes.
const WAKING_POLL_MS = 2000
const WAKE_TIMEOUT_MS = 120_000

export const KIND_ICON: Record<DeviceKind, LucideIcon> = { windows: Monitor, mac: Laptop, linux: Server, other: Cpu }
const KIND_LABEL: Record<DeviceKind, string> = { windows: tr('Windows PC'), mac: tr('Mac'), linux: tr('Linux'), other: tr('Other') }
const KINDS: DeviceKind[] = ['windows', 'mac', 'linux', 'other']
const DEFAULT_PORT: Record<Exclude<ScreenProtocol, ''>, number> = { vnc: 5900, rdp: 3389 }

const STEP_LABEL: Record<string, string> = { Downloading: tr('Downloading…'), Starting: tr('Starting…') }

export function Devices({ onConnect }: { onConnect: (device: Device) => void }) {
  const { show } = useContextMenu()
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [engine, setEngine] = useState<RemoteEngine | null>(null)
  const [status, setStatus] = useState<Record<string, DeviceStatus>>({})
  const [error, setError] = useState<string | null>(null)
  const [waking, setWaking] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState<{ device?: Device; draft: DeviceInput } | null>(null)
  const [finding, setFinding] = useState(false)

  const load = useCallback(
    () =>
      api.devices().then(
        r => {
          setDevices(r.devices)
          setEngine(r.engine)
          setError(null)
        },
        e => setError(e instanceof Error ? e.message : String(e)),
      ),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  // The engine installs in the background; follow it.
  useEffect(() => {
    if (!engine?.installing) return
    const timer = setInterval(() => void load(), 1500)
    return () => clearInterval(timer)
  }, [engine?.installing, load])

  const anyWaking = Object.keys(waking).length > 0
  useEffect(() => {
    if (!devices?.length) return
    let alive = true
    const check = () =>
      api.deviceStatus().then(
        s => {
          if (!alive) return
          setStatus(s)
          // Up again: no longer waking.
          setWaking(w => {
            const next = Object.fromEntries(Object.entries(w).filter(([id, since]) => !s[id]?.online && Date.now() - since < WAKE_TIMEOUT_MS))
            return Object.keys(next).length === Object.keys(w).length ? w : next
          })
        },
        () => {},
      )
    void check()
    const timer = setInterval(check, anyWaking ? WAKING_POLL_MS : STATUS_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [devices, anyWaking])

  const wake = async (d: Device) => {
    try {
      await api.wakeDevice(d.id)
      setWaking(w => ({ ...w, [d.id]: Date.now() }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (d: Device) => {
    await api.deleteDevice(d.id)
    setDevices(list => list?.filter(x => x.id !== d.id) ?? null)
  }

  const save = async (draft: DeviceInput, device?: Device) => {
    const saved = device ? await api.updateDevice(device.id, draft) : await api.createDevice(draft)
    setDevices(list => (device ? (list ?? []).map(x => (x.id === saved.id ? saved : x)) : [...(list ?? []), saved]))
    setEditing(null)
  }

  const blank = (): DeviceInput => ({ name: '', kind: 'windows', host: '', mac: '', protocol: 'vnc', port: 5900, username: '' })
  const needsEngine = !!devices?.some(d => d.protocol) && !!engine && !(engine.installed && engine.running)
  const online = devices?.filter(d => status[d.id]?.online).length ?? 0

  return (
    <div className="dv">
      <header className="dv-bar">
        <span className="dv-title">{!!devices?.length && <small>{tr('{0} of {1} on', online, devices.length)}</small>}</span>
        <span className="tb-spacer" />
        <button className="btn" onClick={() => setFinding(true)}>
          <Radar size={13} /> {tr('Find on Network')}
        </button>
        <button className="btn btn-primary" onClick={() => setEditing({ draft: blank() })}>
          <Plus size={13} /> {tr('Add Device')}
        </button>
      </header>

      <div className="dv-body">
        {error && (
          <p className="form-error dv-error">
            <TriangleAlert size={13} /> {error}
          </p>
        )}
        {needsEngine && engine && <EngineBanner engine={engine} onInstall={() => void api.installRemoteEngine().then(load, e => setError(String(e?.message ?? e)))} />}

        {devices === null && !error && (
          <div className="dv-empty">
            <LoaderCircle size={20} className="spin" />
          </div>
        )}
        {devices?.length === 0 && (
          <div className="dv-empty">
            <span className="dv-empty-icon">
              <MonitorSmartphone size={30} />
            </span>
            <h2>{tr('Your other computers')}</h2>
            <p>{tr('Add your PC or laptop to switch it on from anywhere and use its screen in a window.')}</p>
            <div className="dv-empty-actions">
              <button className="btn" onClick={() => setFinding(true)}>
                <Radar size={13} /> {tr('Find on Network')}
              </button>
              <button className="btn btn-primary" onClick={() => setEditing({ draft: blank() })}>
                <Plus size={13} /> {tr('Add Device')}
              </button>
            </div>
          </div>
        )}
        {!!devices?.length && (
          <div className="dv-grid">
            {devices.map(d => (
              <DeviceCard
                key={d.id}
                device={d}
                status={status[d.id]}
                waking={!!waking[d.id]}
                engineReady={!!engine?.running}
                onConnect={() => onConnect(d)}
                onWake={() => void wake(d)}
                onEdit={() => setEditing({ device: d, draft: toInput(d) })}
                onMenu={e =>
                  show(e, [
                    { label: tr('Edit…'), icon: Pencil, onSelect: () => setEditing({ device: d, draft: toInput(d) }) },
                    { label: tr('Copy IP Address'), icon: Copy, onSelect: () => void copyText(d.host) },
                    ...(d.mac ? [{ label: tr('Copy MAC Address'), icon: Copy, onSelect: () => void copyText(d.mac) }] : []),
                    'separator',
                    { label: tr('Remove Device'), icon: Trash2, danger: true, onSelect: () => void remove(d) },
                  ])
                }
              />
            ))}
          </div>
        )}
      </div>

      {editing && <DeviceSheet device={editing.device} initial={editing.draft} onSave={save} onDelete={editing.device ? () => void remove(editing.device!).then(() => setEditing(null)) : undefined} onClose={() => setEditing(null)} />}
      {finding && (
        <FindSheet
          known={devices ?? []}
          onAdd={f => {
            setFinding(false)
            setEditing({ draft: fromFound(f) })
          }}
          onClose={() => setFinding(false)}
        />
      )}
    </div>
  )
}

const toInput = (d: Device): DeviceInput => ({ name: d.name, kind: d.kind, host: d.host, mac: d.mac, protocol: d.protocol, port: d.port, username: d.username })

// What to fill in for a computer found on the network: Windows Home and Macs share their
// screens over VNC; a computer with RDP open offers that.
function fromFound(f: FoundDevice): DeviceInput {
  const ports = f.ports ?? []
  const protocol: ScreenProtocol = ports.includes(3389) ? 'rdp' : ports.includes(5900) || f.kind === 'windows' || f.kind === 'mac' ? 'vnc' : ''
  return { name: f.name || f.ip, kind: f.kind, host: f.ip, mac: f.mac, protocol, port: protocol ? DEFAULT_PORT[protocol] : 0, username: '' }
}

function EngineBanner({ engine, onInstall }: { engine: RemoteEngine; onInstall: () => void }) {
  return (
    <div className="group dv-banner">
      <MonitorPlay size={18} />
      <span>
        <strong>{engine.installed ? tr('The remote desktop engine is stopped') : tr('Remote screens need the remote desktop engine')}</strong>
        <small>
          {engine.docker
            ? tr('A small container (about 130 MB) that runs on this server. Only the server itself can reach it.')
            : tr('It runs in Docker, which isn’t available on this server.')}
        </small>
        {engine.error && <small className="form-error">{engine.error}</small>}
      </span>
      {engine.docker && (
        <button className="btn btn-primary" onClick={onInstall} disabled={engine.installing}>
          {engine.installing ? <LoaderCircle size={13} className="spin" /> : null}{' '}
          {engine.installing ? (STEP_LABEL[engine.step ?? ''] ?? tr('Installing…')) : engine.installed ? tr('Start') : tr('Install')}
        </button>
      )}
    </div>
  )
}

function DeviceCard({
  device: d,
  status,
  waking,
  engineReady,
  onConnect,
  onWake,
  onEdit,
  onMenu,
}: {
  device: Device
  status?: DeviceStatus
  waking: boolean
  engineReady: boolean
  onConnect: () => void
  onWake: () => void
  onEdit: () => void
  onMenu: (e: MouseEvent) => void
}) {
  const Icon = KIND_ICON[d.kind]
  const on = !!status?.online
  const state = !status ? 'checking' : on ? 'online' : waking ? 'waking' : 'offline'
  const label =
    state === 'checking'
      ? tr('Checking…')
      : state === 'waking'
        ? tr('Waking up…')
        : state === 'offline'
          ? tr('Off or asleep')
          : !d.protocol
            ? tr('Switched on')
            : status?.screen
              ? tr('On · Screen sharing ready')
              : tr('On · Screen sharing is off')
  return (
    <div className={`dv-card is-${state}`} onContextMenu={onMenu} onDoubleClick={() => d.protocol && on && onConnect()}>
      <div className="dv-card-top">
        <span className={`dv-kind is-${d.kind}`}>
          <Icon size={22} />
          <i className={`dv-dot is-${state}`} />
        </span>
        <span className="dv-card-name">
          <strong>{d.name}</strong>
          <small>
            {KIND_LABEL[d.kind]} · {d.host}
          </small>
        </span>
        <button className="icon-btn" onClick={onMenu} aria-label={tr('More')}>
          <Ellipsis size={15} />
        </button>
      </div>
      <div className="dv-state">
        {state === 'waking' || state === 'checking' ? <LoaderCircle size={12} className="spin" /> : null}
        <span>{label}</span>
        {on && status?.latency ? <small>{tr('{0} ms', status.latency)}</small> : null}
      </div>
      {on && d.protocol && !status?.screen && (
        <p className="dv-hint">
          {tr('Turn on screen sharing on it, then it can be shown here.')}{' '}
          <button className="dv-link" onClick={onEdit}>
            {tr('How?')}
          </button>
        </p>
      )}
      <div className="dv-actions">
        {d.mac && !on && (
          <button className="btn" onClick={onWake} disabled={waking}>
            <Power size={13} /> {waking ? tr('Waking…') : tr('Wake')}
          </button>
        )}
        {d.protocol && (
          <button className="btn btn-primary" onClick={onConnect} disabled={!on || !engineReady} title={!engineReady ? tr('Install the remote desktop engine first') : undefined}>
            <MonitorPlay size={13} /> {tr('Connect')}
          </button>
        )}
        {!d.mac && !d.protocol && <small className="dv-muted">{tr('Add a MAC address to wake it, or a screen-sharing method to use it.')}</small>}
      </div>
    </div>
  )
}

// ---------- Add / edit ----------

function DeviceSheet({
  device,
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  device?: Device
  initial: DeviceInput
  onSave: (d: DeviceInput, device?: Device) => Promise<void>
  onDelete?: () => void
  onClose: () => void
}) {
  const [d, setD] = useState(initial)
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<DeviceInput>) => setD(x => ({ ...x, ...patch }))
  const ok = d.name.trim() && d.host.trim()

  const findMac = async () => {
    setLookingUp(true)
    setError(null)
    try {
      set({ mac: (await api.lookupMac(d.host.trim())).mac })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLookingUp(false)
    }
  }

  const submit = async () => {
    if (!ok) return
    setSaving(true)
    setError(null)
    try {
      // An empty password field keeps the saved one (unless asked to remove it).
      await onSave({ ...d, password: clearPassword ? '' : password || (device ? undefined : '') }, device)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci dv-sheet" role="dialog" aria-label={device ? tr('Edit Device') : tr('Add Device')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{device ? tr('Edit Device') : tr('Add Device')}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <form
          className="ci-body cm-form dv-form"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="segmented dv-kinds" role="radiogroup" aria-label={tr('Kind')}>
            {KINDS.map(k => {
              const Icon = KIND_ICON[k]
              return (
                <button key={k} type="button" role="radio" aria-checked={d.kind === k} className={d.kind === k ? 'is-active' : ''} onClick={() => set({ kind: k })}>
                  <Icon size={13} /> {KIND_LABEL[k]}
                </button>
              )
            })}
          </div>
          <label>
            <span>{tr('Name')}</span>
            <input autoFocus={!device} value={d.name} onChange={e => set({ name: e.target.value })} placeholder={tr('Gaming PC')} />
          </label>
          <div className="dv-row">
            <label>
              <span>{tr('IP address')}</span>
              <input value={d.host} onChange={e => set({ host: e.target.value })} placeholder="192.168.1.11" spellCheck={false} />
            </label>
            <label>
              <span>{tr('MAC address (to wake it)')}</span>
              <span className="dv-inline">
                <input value={d.mac} onChange={e => set({ mac: e.target.value })} placeholder="9c:6b:00:68:7d:27" spellCheck={false} />
                <button type="button" className="btn" onClick={() => void findMac()} disabled={!d.host.trim() || lookingUp} title={tr('Look it up (the device must be on)')}>
                  {lookingUp ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}
                </button>
              </span>
            </label>
          </div>

          <h4 className="dv-subhead">{tr('Screen')}</h4>
          <div className="segmented" role="radiogroup" aria-label={tr('Screen sharing')}>
            {(
              [
                ['vnc', tr('VNC')],
                ['rdp', tr('RDP')],
                ['', tr('Don’t show')],
              ] as [ScreenProtocol, string][]
            ).map(([p, label]) => (
              <button
                key={p || 'none'}
                type="button"
                role="radio"
                aria-checked={d.protocol === p}
                className={d.protocol === p ? 'is-active' : ''}
                onClick={() => set({ protocol: p, port: p ? DEFAULT_PORT[p] : 0 })}
              >
                {label}
              </button>
            ))}
          </div>
          {d.protocol && (
            <>
              <div className="dv-row">
                <label>
                  <span>{tr('User name')}</span>
                  <input value={d.username} onChange={e => set({ username: e.target.value })} placeholder={d.protocol === 'rdp' ? tr('Windows account') : tr('Optional')} spellCheck={false} autoComplete="off" />
                </label>
                <label>
                  <span>{tr('Password')}</span>
                  <input
                    type="password"
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value)
                      setClearPassword(false)
                    }}
                    placeholder={device?.hasPassword && !clearPassword ? tr('Saved (type to change)') : ''}
                    autoComplete="new-password"
                  />
                </label>
                <label className="dv-port">
                  <span>{tr('Port')}</span>
                  <input inputMode="numeric" value={d.port || ''} onChange={e => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                </label>
              </div>
              {device?.hasPassword && !password && (
                <label className="dv-check">
                  <input type="checkbox" checked={clearPassword} onChange={e => setClearPassword(e.target.checked)} /> {tr('Remove the saved password')}
                </label>
              )}
              <small>{tr('The password stays on the server; this browser never gets it back.')}</small>
            </>
          )}

          <details className="dv-help" open={!device}>
            <summary>{tr('How to set it up')}</summary>
            <SetupHelp kind={d.kind} protocol={d.protocol} />
          </details>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" hidden />
        </form>
        <footer className="ci-foot">
          {onDelete && (
            <button className={`btn ${confirmDelete ? 'btn-danger' : ''}`} onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)}>
              <Trash2 size={13} /> {confirmDelete ? tr('Click Again to Remove') : tr('Remove')}
            </button>
          )}
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={!ok || saving}>
            {saving ? <LoaderCircle size={13} className="spin" /> : null} {device ? tr('Save') : tr('Add')}
          </button>
        </footer>
      </div>
    </div>
  )
}

function SetupHelp({ kind, protocol }: { kind: DeviceKind; protocol: ScreenProtocol }) {
  const screen: Record<DeviceKind, string | null> = {
    windows:
      protocol === 'rdp'
        ? tr('RDP needs Windows Pro: Settings → System → Remote Desktop → On. Sign in with your Windows account.')
        : tr('Windows Home can’t share its screen over RDP, but a free VNC server can: install TightVNC Server (or UltraVNC), set a password for full control, and allow it through the firewall when asked.'),
    mac: tr('On the Mac: System Settings → General → Sharing → Screen Sharing → ⓘ → turn on “VNC viewers may control screen with password” and set one. Use that password here and leave the user name empty.'),
    linux: tr('Turn on screen sharing (VNC or RDP) in the desktop’s settings, or install a VNC server such as x11vnc or TigerVNC.'),
    other: null,
  }
  const wake: Record<DeviceKind, string> = {
    windows: tr('To wake it: turn on Wake-on-LAN in the BIOS; in Device Manager → the network adapter → Power Management, allow it to wake the computer (and under Advanced, turn on Wake on Magic Packet); and turn off Fast Startup in the power options, so it can wake from shut down. It works over a network cable.'),
    mac: tr('A Mac wakes from sleep when “Wake for network access” is on in its energy settings. It can’t be woken once shut down.'),
    linux: tr('To wake it: turn on Wake-on-LAN in the BIOS, and on the network card (for example: sudo ethtool -s eth0 wol g).'),
    other: tr('Wake-on-LAN works if the device supports it and is on a network cable.'),
  }
  return (
    <div className="dv-help-body">
      {protocol && screen[kind] && (
        <p>
          <MonitorPlay size={13} /> {screen[kind]}
          {protocol === 'vnc' && <small>{tr(' VNC passwords use only their first 8 characters.')}</small>}
        </p>
      )}
      <p>
        <Power size={13} /> {wake[kind]}
      </p>
    </div>
  )
}

// ---------- Find on the network ----------

function FindSheet({ known, onAdd, onClose }: { known: Device[]; onAdd: (f: FoundDevice) => void; onClose: () => void }) {
  const [found, setFound] = useState<FoundDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useRef(0)
  const scan = useCallback(() => {
    const id = ++run.current
    setFound(null)
    setError(null)
    api.discoverDevices().then(
      list => id === run.current && setFound(list),
      e => id === run.current && setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])
  useEffect(scan, [scan])
  const isKnown = (f: FoundDevice) => known.some(d => d.host === f.ip || (f.mac && d.mac === f.mac))
  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci dv-sheet" role="dialog" aria-label={tr('Find on Network')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{tr('Find on Network')}</strong>
          <span className="tb-spacer" />
          <button className="pill-btn" onClick={scan} disabled={found === null && !error}>
            {tr('Search Again')}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body dv-found">
          {found === null && !error && (
            <div className="dv-scanning">
              <Radar size={26} className="dv-radar" />
              <span>{tr('Looking for computers on the network…')}</span>
              <small>{tr('This takes about ten seconds.')}</small>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          {found?.length === 0 && <p className="dv-muted">{tr('Nothing found.')}</p>}
          {found?.map(f => {
            const Icon = KIND_ICON[f.kind]
            const added = isKnown(f)
            return (
              <div key={f.ip} className="dv-found-row">
                <span className={`dv-kind is-${f.kind}`}>
                  <Icon size={16} />
                </span>
                <span className="dv-found-name">
                  <strong>{f.name || f.ip}</strong>
                  <small>
                    {[f.name ? f.ip : null, f.mac || null, f.self ? tr('This server') : f.router ? tr('Router') : f.kind !== 'other' ? KIND_LABEL[f.kind] : null].filter(Boolean).join(' · ')}
                  </small>
                </span>
                {f.self || f.router ? null : added ? (
                  <small className="dv-muted">{tr('Added')}</small>
                ) : (
                  <button className="btn" onClick={() => onAdd(f)}>
                    <Plus size={13} /> {tr('Add')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <footer className="ci-foot">
          <p>{tr('Computers that are off or asleep don’t show up; switch them on to find them.')}</p>
        </footer>
      </div>
    </div>
  )
}
