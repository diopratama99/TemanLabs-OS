import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, HardDrive, LoaderCircle, Lock, Power, RotateCw, ShieldCheck } from 'lucide-react'
import { api, MOCK_MODE } from '../../api'
import type { AdblockStatus, NetInterface, RemoteEngine, SignedInBrowser, ShareLinks, SmbInfo, StartupApp, SystemStats } from '../../api/types'
import { AppIcon } from '../AppIcon'
import { ShareLinkRow } from '../ShareLinkSheet'
import { useAuth } from '../../lib/auth'
import { useSettings } from '../../lib/settings'
import { PopUpButton } from '../PopUpButton'
import { copyText } from '../../lib/clipboard'
import { formatBytes, formatUptime } from '../../lib/format'
import { tr } from '../../lib/i18n'
import type { WindowId } from '../Window'
import { Switch } from '../Switch'
import { GroupTitle, SettingRow } from './DesktopSections'
import { DeviceArt, deviceTitle } from '../DeviceArt'
import { LogoTile } from '../Logo'
import { shortCPU, useHardware } from '../../windows/AboutServer'

// Settings about the server: its addresses, disks, shares and power. They change the server
// itself (or open the app that does), not just this browser.

const value = (v?: string | number | null) => <span className="value">{v ?? '–'}</span>

function OpenApp({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="set-open">
      <button className="btn" onClick={onClick}>
        {label}
      </button>
    </div>
  )
}

/** Share links: every link there is, and the public address they're given out with. */
function ShareLinksGroup() {
  const [data, setData] = useState<ShareLinks | null>(null)
  const [base, setBase] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    api.shareLinks().then(
      r => {
        setData(r)
        setBase(r.baseUrl)
      },
      () => {},
    )
  useEffect(() => {
    void load()
  }, [])
  const saveBase = async () => {
    setError(null)
    try {
      await api.setShareLinkBase(base)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <>
      <GroupTitle>{tr('Share Links')}</GroupTitle>
      <div className="group">
        {!data?.links.length ? (
          <SettingRow label={tr('No links yet')} note={tr('In Files, right-click a file or folder → Share Link…, or a folder → Request Files….')} />
        ) : (
          data.links.map(l => (
            <div key={l.id} className="row sl-settings-row">
              <ShareLinkRow link={l} base={data.baseUrl} showName onDelete={() => void api.deleteShareLink(l.id).then(load)} />
            </div>
          ))
        )}
      </div>
      <GroupTitle>{tr('Public address')}</GroupTitle>
      <div className="group">
        <SettingRow
          label={tr('Address for links')}
          note={tr('Links open at this desktop’s address, for people on your network or Tailscale. To share with anyone, point a public address here (a Cloudflare Tunnel or Tailscale Funnel to this server) and enter it.')}
        >
          <form
            className="set-inline sl-base"
            onSubmit={e => {
              e.preventDefault()
              void saveBase()
            }}
          >
            <input value={base} onChange={e => setBase(e.target.value)} placeholder={location.origin} spellCheck={false} />
            <button className="btn" disabled={base === (data?.baseUrl ?? '')}>
              {saved ? <Check size={13} /> : tr('Save')}
            </button>
          </form>
        </SettingRow>
      </div>
      {error && <p className="form-error">{error}</p>}
    </>
  )
}

/** Settings → General → Startup Apps: what starts by itself when the server boots. */
export function StartupSection() {
  const [apps, setApps] = useState<StartupApp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    api.startupApps().then(setApps, e => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  const toggle = async (app: StartupApp, enabled: boolean) => {
    setBusy(app.id)
    setError(null)
    try {
      await api.setStartupApp(app.id, enabled)
      setApps(list => list?.map(a => (a.id === app.id ? { ...a, enabled } : a)) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <div className="group">
        {!apps && !error && <SettingRow label={tr('Loading…')} />}
        {apps?.length === 0 && <SettingRow label={tr('No apps installed yet.')} />}
        {apps?.map(app => (
          <SettingRow
            key={app.id}
            label={
              <span className="set-inline">
                <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={24} /> {app.name}
              </span>
            }
            note={app.locked ? tr('Keeps the server reachable; always starts.') : undefined}
          >
            {busy === app.id ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Switch label={app.name} checked={app.enabled} disabled={app.locked} onChange={v => void toggle(app, v)} />
            )}
          </SettingRow>
        ))}
      </div>
      <p className="pane-note">{tr('These apps start by themselves when the server turns on. Apps that are off stay stopped until you open them.')}</p>
    </>
  )
}

/** Settings → About: the machine, then TemanLabsOS and the system it runs on. */
export function AboutSection({ stats, version, onUpdates }: { stats: SystemStats | null; version?: string; onUpdates: () => void }) {
  const hw = useHardware()
  const { title, subtitle } = deviceTitle(hw, stats?.hostname)
  return (
    <>
      <div className="about-device">
        <DeviceArt kind={hw?.kind} size={140} />
        <h2>{hw ? title : '…'}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="group">
        <SettingRow label={tr('Name')}>{value(stats?.hostname)}</SettingRow>
        <SettingRow label={tr('Processor')}>{value(stats && `${shortCPU(stats.cpu.model)} · ${tr('{0} cores', stats.cpu.cores)}`)}</SettingRow>
        <SettingRow label={tr('Memory')}>{value(stats && formatBytes(stats.memory.total, 0))}</SettingRow>
        {hw?.serial && <SettingRow label={tr('Serial number')}>{value(hw.serial)}</SettingRow>}
        {hw?.modelNumber && <SettingRow label={tr('Model number')}>{value(hw.modelNumber)}</SettingRow>}
        {hw?.kind === 'virtual' && <SettingRow label={tr('Virtualization')}>{value(hw.virtualization?.toUpperCase())}</SettingRow>}
      </div>

      <GroupTitle>TemanLabsOS</GroupTitle>
      <div className="group">
        <SettingRow label={<span className="set-inline"><LogoTile size={28} /> TemanLabsOS</span>}>
          <span className="value">{tr('Version {0}', version ?? '…')}</span>
        </SettingRow>
        <SettingRow label={tr('Software Update')} note={tr('New versions of TemanLabsOS, and app and system updates.')}>
          <button className="btn" onClick={onUpdates}>
            {tr('Details…')}
          </button>
        </SettingRow>
      </div>
      {MOCK_MODE && <p className="pane-note">{tr('Running on mock data (npm run dev:mock).')}</p>}

      <GroupTitle>{tr('System')}</GroupTitle>
      <div className="group">
        <SettingRow label={tr('Operating system')}>{value(stats?.os)}</SettingRow>
        <SettingRow label={tr('Kernel')}>{value(stats?.kernel)}</SettingRow>
        <SettingRow label={tr('Uptime')}>{value(stats && formatUptime(stats.uptime))}</SettingRow>
      </div>
    </>
  )
}

export function NetworkSection({ stats, onOpenWindow }: { stats: SystemStats | null; onOpenWindow: (id: WindowId) => void }) {
  const [ifaces, setIfaces] = useState<NetInterface[] | null>(null)
  useEffect(() => {
    api.interfaces().then(setIfaces, () => setIfaces([]))
  }, [])
  const lan = stats?.addresses.lan
  const ts = stats?.addresses.tailscale
  const copy = (text: string) => (
    <button className="icon-btn" onClick={() => void copyText(text)} aria-label={tr('Copy')} title={tr('Copy')}>
      <Copy size={13} />
    </button>
  )
  return (
    <>
      <div className="group">
        <SettingRow label={tr('Local IP')} note={lan?.interface}>
          <span className="value set-inline">
            {lan?.ipv4 ?? '–'} {lan && copy(lan.ipv4)}
          </span>
        </SettingRow>
        <SettingRow label={tr('Tailscale')} note={ts?.dnsName}>
          <span className="value set-inline">
            {ts ? ts.ipv4 : tr('Not connected')} {ts && copy(ts.ipv4)}
          </span>
        </SettingRow>
        <SettingRow label={tr('TemanLabsOS address')} note={tr('Where this desktop is open.')}>
          <span className="value set-inline">
            {location.host} {copy(location.origin)}
          </span>
        </SettingRow>
      </div>
      <GroupTitle>{tr('Interfaces')}</GroupTitle>
      <div className="group">
        {ifaces === null && (
          <SettingRow label={tr('Loading…')}>
            <LoaderCircle size={14} className="spin" />
          </SettingRow>
        )}
        {ifaces
          ?.filter(i => !i.virtual)
          .map(i => (
            <SettingRow key={i.name} label={i.name} note={[i.mac, i.speedMbps ? `${i.speedMbps} Mb/s` : null].filter(Boolean).join(' · ')}>
              <span className="value set-iface">
                <i className={`set-dot ${i.state === 'up' ? 'is-on' : ''}`} />
                {i.addresses.filter(a => !a.includes(':')).join(', ') || (i.state === 'up' ? tr('Connected') : tr('Not connected'))}
              </span>
            </SettingRow>
          ))}
      </div>
      <OpenApp label={tr('Open Network Tools…')} onClick={() => onOpenWindow('network')} />
    </>
  )
}

export function StorageSection({ stats, onOpenWindow }: { stats: SystemStats | null; onOpenWindow: (id: WindowId) => void }) {
  const [usb, setUsb] = useState<boolean | null>(null)
  useEffect(() => {
    api.storage().then(
      s => setUsb(s.usbAutomount),
      () => {},
    )
  }, [])
  const disks = stats?.disks ?? []
  return (
    <>
      <div className="group">
        {disks.map(d => {
          const used = d.total ? d.used / d.total : 0
          return (
            <div key={d.mount} className="row set-disk">
              <HardDrive size={22} className="set-disk-icon" />
              <span className="set-disk-body">
                <strong>
                  {d.name} <small>{d.mount}</small>
                </strong>
                <span className="set-bar">
                  <i style={{ width: `${Math.round(used * 100)}%` }} className={used > 0.9 ? 'is-full' : ''} />
                </span>
                <small>{tr('{0} free of {1}', formatBytes(d.total - d.used), formatBytes(d.total))}</small>
              </span>
            </div>
          )
        })}
        {disks.length === 0 && <SettingRow label={tr('Loading…')} />}
      </div>
      <div className="group">
        <SettingRow label={tr('Mount USB drives automatically')} note={tr('Drives plugged into the server appear under /media.')}>
          <Switch
            label={tr('Mount USB drives automatically')}
            checked={!!usb}
            disabled={usb === null}
            onChange={v => {
              setUsb(v)
              api.setUsbAutomount(v).catch(() => setUsb(!v))
            }}
          />
        </SettingRow>
      </div>
      <OpenApp label={tr('Open Disk Manager…')} onClick={() => onOpenWindow('disks')} />
    </>
  )
}

export function SharingSection({ onOpenWindow }: { onOpenWindow: (id: WindowId) => void }) {
  const [smb, setSmb] = useState<SmbInfo | null>(null)
  const [sessions, setSessions] = useState<number | null>(null)
  const [engine, setEngine] = useState<RemoteEngine | null>(null)
  const [devices, setDevices] = useState(0)
  useEffect(() => {
    api.smbInfo().then(setSmb, () => {})
    api.smbStatus().then(
      s => setSessions(s.sessions.length),
      () => {},
    )
    api.devices().then(
      r => {
        setEngine(r.engine)
        setDevices(r.devices.length)
      },
      () => {},
    )
  }, [])
  return (
    <>
      <GroupTitle>{tr('File Sharing')}</GroupTitle>
      <div className="group">
        <SettingRow
          label={tr('Windows file sharing (SMB)')}
          note={
            smb
              ? smb.installed
                ? smb.running
                  ? tr('Running · Samba {0}', smb.version)
                  : tr('Stopped')
                : tr('Samba isn’t installed')
              : undefined
          }
        >
          <i className={`set-dot ${smb?.running ? 'is-on' : ''}`} />
        </SettingRow>
        <SettingRow label={tr('Shared folders')}>{value(smb?.shares.length)}</SettingRow>
        <SettingRow label={tr('Users')}>{value(smb?.users.length)}</SettingRow>
        <SettingRow label={tr('Connected now')}>{value(sessions)}</SettingRow>
      </div>
      <OpenApp label={tr('Open File Sharing…')} onClick={() => onOpenWindow('sharing')} />

      <ShareLinksGroup />

      <GroupTitle>{tr('Remote screens')}</GroupTitle>
      <div className="group">
        <SettingRow
          label={tr('Remote desktop engine')}
          note={engine ? (engine.running ? tr('Running') : engine.installed ? tr('Stopped') : tr('Not installed')) : undefined}
        >
          <i className={`set-dot ${engine?.running ? 'is-on' : ''}`} />
        </SettingRow>
        <SettingRow label={tr('Devices')}>{value(devices)}</SettingRow>
      </div>
      <OpenApp label={tr('Open Devices…')} onClick={() => onOpenWindow('devices')} />
    </>
  )
}

const PART_NAME: Record<string, string> = { core: tr('Cores'), uncore: tr('Graphics'), dram: tr('Memory'), psys: tr('Platform') }

export function PowerSection({ stats, onPower }: { stats: SystemStats | null; onPower: (action: 'restart' | 'shutdown') => void }) {
  const [confirm, setConfirm] = useState<'restart' | 'shutdown' | null>(null)
  const power = stats?.power
  const act = (action: 'restart' | 'shutdown') => {
    if (confirm !== action) return setConfirm(action)
    setConfirm(null)
    onPower(action)
  }
  return (
    <>
      <div className="group">
        <SettingRow
          label={tr('Power draw now')}
          note={
            power
              ? power.source === 'battery'
                ? tr('From the battery')
                : tr('CPU and memory, as the processor measures them')
              : tr('This server doesn’t report its power draw.')
          }
        >
          {value(power ? `${power.watts.toFixed(1)} W` : null)}
        </SettingRow>
        {(power?.parts ?? [])
          .filter(p => PART_NAME[p.name])
          .map(p => (
            <SettingRow key={p.name} label={PART_NAME[p.name]}>
              {value(`${p.watts.toFixed(1)} W`)}
            </SettingRow>
          ))}
        <SettingRow label={tr('Uptime')}>{value(stats && formatUptime(stats.uptime))}</SettingRow>
        {stats?.load && (
          <SettingRow label={tr('Load average')} note={tr('Over 1, 5 and 15 minutes')}>
            {value(stats.load.map(l => l.toFixed(2)).join(' · '))}
          </SettingRow>
        )}
      </div>
      <GroupTitle>{tr('Server')}</GroupTitle>
      <div className="group">
        <SettingRow label={tr('Restart the server')} note={tr('Apps start again on their own; open sessions reconnect.')}>
          <button
            className={`btn ${confirm === 'restart' ? 'btn-danger' : ''}`}
            onClick={() => act('restart')}
            onBlur={() => setConfirm(null)}
            disabled={MOCK_MODE}
          >
            <RotateCw size={13} /> {confirm === 'restart' ? tr('Click Again to Restart') : tr('Restart…')}
          </button>
        </SettingRow>
        <SettingRow
          label={tr('Shut down the server')}
          note={tr('It stays off until someone presses its power button (or wakes it over the network).')}
        >
          <button
            className={`btn ${confirm === 'shutdown' ? 'btn-danger' : ''}`}
            onClick={() => act('shutdown')}
            onBlur={() => setConfirm(null)}
            disabled={MOCK_MODE}
          >
            <Power size={13} /> {confirm === 'shutdown' ? tr('Click Again to Shut Down') : tr('Shut Down…')}
          </button>
        </SettingRow>
      </div>
    </>
  )
}

// ---------- Ad blocking ----------

// The extra block lists the server knows (see adblockLists in server/adblock.go).
// How hard ads and trackers are blocked; Standard is the list AdGuard Home starts with.
const LEVELS = [
  { id: '', label: tr('Standard'), note: tr('The standard list. Blocks the common ad and tracking servers.') },
  { id: 'strong', label: tr('Strong'), note: tr('About what a browser ad blocker blocks by network, for every device. Recommended.') },
  { id: 'strongest', label: tr('Strongest'), note: tr('Blocks even more; now and then a site or app needs allowing below.') },
]

const EXTRA_LISTS = [
  { id: 'gambling', label: tr('Online gambling sites'), note: tr('Gambling and betting sites (judi online), including the ones ads and search results lead to.') },
  { id: 'popups', label: tr('Pop-up and redirect ads'), note: tr('Ads that open a new tab or jump to another site, such as fake shop and app offers.') },
  { id: 'phones', label: tr('Ads built into phones'), note: tr('The ads and tracking phone makers put in their own apps: Xiaomi, OPPO, realme, vivo, Samsung and Huawei.') },
  { id: 'indonesia', label: tr('Indonesian ad servers'), note: tr('Ad networks that Indonesian sites use.') },
  { id: 'bypass', label: tr('Stop devices going around it'), note: tr('Blocks Secure DNS, VPN and proxy services that skip the blocker. VPN apps stop working.') },
]

const PAUSES = [
  { minutes: 5, label: tr('5 minutes') },
  { minutes: 60, label: tr('1 hour') },
]

export function AdblockSection({ stats }: { stats: SystemStats | null }) {
  const [st, setSt] = useState<AdblockStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<{ answered: boolean; blocked: boolean } | 'running' | null>(null)
  const [allow, setAllow] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [listBusy, setListBusy] = useState<string | null>(null)
  const load = useCallback(() => api.adblock().then(setSt, e => setError(e instanceof Error ? e.message : String(e))), [])
  useEffect(() => {
    void load()
  }, [load])
  // Follow an install, a pause counting down and the numbers.
  useEffect(() => {
    const timer = setInterval(() => void load(), st?.installing || st?.unresponsive ? 1500 : 5000)
    return () => clearInterval(timer)
  }, [load, st?.installing, st?.unresponsive])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    await load()
  }
  const lan = stats?.addresses.lan?.ipv4
  const ts = stats?.addresses.tailscale?.ipv4
  const on = !!st?.running && st.protection
  const copy = (text: string) => (
    <button className="icon-btn" onClick={() => void copyText(text)} aria-label={tr('Copy')} title={tr('Copy')}>
      <Copy size={13} />
    </button>
  )

  if (!st) {
    return error ? <p className="form-error">{error}</p> : <LoaderCircle size={16} className="spin" />
  }
  return (
    <>
      <div className="group">
        <SettingRow
          label={tr('Block ads and trackers')}
          note={
            st.installing
              ? (({ Downloading: tr('Downloading…'), Starting: tr('Starting…') } as Record<string, string>)[st.step ?? ''] ??
                tr('Setting up…'))
              : !st.installed
                ? tr('For every device at home: the server filters ads and trackers out before they load.')
                : !st.running
                  ? tr('Stopped.')
                  : st.unresponsive
                    ? tr('Starting…')
                    : st.pausedFor
                      ? tr('Paused · back on in {0}', formatCountdown(st.pausedFor))
                      : on
                        ? tr('On · {0} rules in the block list', st.rules.toLocaleString())
                        : tr('Off')
          }
        >
          {!st.installed || !st.running ? (
            <button className="btn btn-primary" onClick={() => void act(() => api.installAdblock())} disabled={st.installing || !st.docker}>
              {st.installing ? <LoaderCircle size={13} className="spin" /> : <ShieldCheck size={13} />}{' '}
              {st.installed ? tr('Start') : tr('Turn On')}
            </button>
          ) : (
            <Switch
              label={tr('Block ads and trackers')}
              checked={on}
              disabled={st.unresponsive}
              onChange={v => void act(() => api.setAdblock(v))}
            />
          )}
        </SettingRow>
        {st.running && !st.unresponsive && (
          <SettingRow label={tr('Pause for a while')} note={tr('When a site doesn’t work, pause blocking and try again.')}>
            <span className="set-inline">
              {st.pausedFor ? (
                <button className="btn" onClick={() => void act(() => api.setAdblock(true))}>
                  {tr('Resume Now')}
                </button>
              ) : (
                PAUSES.map(p => (
                  <button key={p.minutes} className="btn" onClick={() => void act(() => api.setAdblock(false, p.minutes))} disabled={!on}>
                    {p.label}
                  </button>
                ))
              )}
            </span>
          </SettingRow>
        )}
        {st.error && <SettingRow label={tr('Couldn’t turn it on')} note={st.error} />}
        {!st.docker && (
          <SettingRow label={tr('Needs Docker')} note={tr('Ad blocking runs in Docker, which isn’t available on this server.')} />
        )}
      </div>
      {error && <p className="form-error">{error}</p>}

      {st.running && st.stats && (
        <>
          <GroupTitle>{tr('Last 24 hours')}</GroupTitle>
          <div className="group set-stats">
            <div>
              <strong>{st.stats.queries.toLocaleString()}</strong>
              <small>{tr('Lookups')}</small>
            </div>
            <div>
              <strong>{st.stats.blocked.toLocaleString()}</strong>
              <small>{tr('Blocked ({0}%)', st.stats.queries ? Math.round((st.stats.blocked / st.stats.queries) * 100) : 0)}</small>
            </div>
            <div>
              <strong>{st.stats.avgMs.toFixed(1)} ms</strong>
              <small>{tr('Average answer')}</small>
            </div>
          </div>
        </>
      )}

      {st.installed && (
        <>
          <GroupTitle>{tr('Use it on every device')}</GroupTitle>
          <div className="group set-steps">
            <div className="set-step">
              <span className="set-step-n">1</span>
              <span>
                <strong>{tr('At home: set your router’s DNS server')}</strong>
                <small>
                  {tr(
                    'In the router’s settings (often under LAN or DHCP), set the DNS server to the server’s address. Every phone, laptop and TV that joins the Wi-Fi then gets ads blocked.',
                  )}
                </small>
              </span>
              {lan && (
                <span className="set-inline value">
                  {lan} {copy(lan)}
                </span>
              )}
            </div>
            <div className="set-step">
              <span className="set-step-n">2</span>
              <span>
                <strong>{tr('Anywhere: through Tailscale')}</strong>
                <small>
                  {tr(
                    'In the Tailscale admin console → DNS → Add nameserver → Custom, enter this address and turn on Override local DNS. Your devices on Tailscale then block ads on any network.',
                  )}{' '}
                  <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer">
                    {tr('Open the admin console')}
                  </a>
                </small>
              </span>
              {ts && (
                <span className="set-inline value">
                  {ts} {copy(ts)}
                </span>
              )}
            </div>
            <div className="set-step">
              <span className="set-step-n">3</span>
              <span>
                <strong>{tr('Check it works')}</strong>
                <small>
                  {test === 'running'
                    ? tr('Asking the server for an ad address…')
                    : test
                      ? test.blocked
                        ? tr('Working: the server blocks ads.')
                        : test.answered
                          ? tr('The server answered but didn’t block it. Is blocking on?')
                          : tr('The server didn’t answer on port 53.')
                      : tr('Asks the server for an ad address and checks that it’s blocked.')}
                </small>
              </span>
              <button
                className="btn"
                disabled={test === 'running'}
                onClick={() => {
                  setTest('running')
                  api.testAdblock().then(setTest, () => setTest({ answered: false, blocked: false }))
                }}
              >
                {tr('Test')}
              </button>
            </div>
          </div>
        </>
      )}

      {st.running && !st.unresponsive && (
        <>
          <GroupTitle>{tr('Block lists')}</GroupTitle>
          <div className="group">
            {(() => {
              const level = LEVELS.find(l => l.id && st.lists?.[l.id] !== undefined) ?? LEVELS[0]
              return (
                <SettingRow label={tr('Strength')} note={`${level.note} ${tr('{0} rules in all.', st.rules.toLocaleString())}`}>
                  {listBusy === 'level' ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <div className="segmented set-segmented" role="radiogroup" aria-label={tr('Strength')}>
                      {LEVELS.map(l => (
                        <button
                          key={l.id || 'standard'}
                          role="radio"
                          aria-checked={level === l}
                          className={level === l ? 'is-active' : ''}
                          onClick={() => {
                            if (level === l) return
                            setListBusy('level')
                            // Standard: switch the level that's on off; a level replaces the other one.
                            void act(() => api.setAdblockList(l.id || level.id, !!l.id)).finally(() => setListBusy(null))
                          }}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  )}
                </SettingRow>
              )
            })()}
            {EXTRA_LISTS.map(l => {
              const on = st.lists?.[l.id] !== undefined
              return (
                <SettingRow key={l.id} label={l.label} note={on && st.lists[l.id] ? `${l.note} ${tr('{0} rules.', st.lists[l.id].toLocaleString())}` : l.note}>
                  {listBusy === l.id ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Switch
                      label={l.label}
                      checked={on}
                      onChange={v => {
                        setListBusy(l.id)
                        void act(() => api.setAdblockList(l.id, v)).finally(() => setListBusy(null))
                      }}
                    />
                  )}
                </SettingRow>
              )
            })}
          </div>
        </>
      )}

      {st.running && !!st.stats?.topClients?.length && (
        <>
          <GroupTitle>{tr('Devices using it')}</GroupTitle>
          <div className="group">
            {st.stats.topClients.map(c => (
              <SettingRow key={c.name} label={c.label || c.name} note={c.label ? c.name : undefined}>
                <span className="value">{tr('{0} lookups', c.count.toLocaleString())}</span>
              </SettingRow>
            ))}
          </div>
          <p className="pane-note">{tr('A phone or computer missing here still asks another DNS server; see “Still seeing ads?” below.')}</p>
        </>
      )}

      {st.installed && (
        <>
          <GroupTitle>{tr('Still seeing ads?')}</GroupTitle>
          <div className="group set-steps">
            <Step n={1} title={tr('Reconnect the device to the Wi-Fi')}>
              {tr('Devices pick up the new DNS server when they reconnect, or when their lease renews (up to a day).')}
            </Step>
            <Step n={2} title={tr('Turn off Secure DNS and Private DNS')}>
              {tr('These send lookups straight to Google or Cloudflare, around the blocker. Chrome and Edge: Settings → Privacy → Use secure DNS → off. Android: Settings → Network → Private DNS → Off. iPhone and Mac: turn off Private Relay. Or switch on “Stop devices going around it” above.')}
            </Step>
            <Step n={3} title={tr('Check the router’s IPv6 DNS')}>
              {tr('Many routers also hand out the internet provider’s IPv6 DNS server, which devices then use instead. In the router’s IPv6 (DHCPv6) settings, set the DNS source to a fixed server or leave it empty.')}
            </Step>
            <Step n={4} title={tr('Some ads can’t be blocked this way')}>
              {tr('Ads inside Google search results, YouTube, TikTok, Instagram or Shopee come from the same servers as the app itself, so blocking them would break it. The gambling list still blocks the sites those ads lead to.')}
            </Step>
            <Step n={5} title={tr('Hide the leftover boxes on phones')}>
              {tr('A browser ad blocker also hides the empty ad spaces and sponsored posts on a page, which no network blocker can see. On Android, use Firefox with uBlock Origin, or Brave. On iPhone, use a browser with a built-in ad blocker, such as Brave or AdGuard.')}
            </Step>
          </div>
        </>
      )}

      {st.running && !!st.stats?.topBlocked?.length && (
        <>
          <GroupTitle>{tr('Blocked most often')}</GroupTitle>
          <div className="group">
            {st.stats.topBlocked.map(d => (
              <SettingRow key={d.name} label={d.name} note={tr('{0} times', d.count.toLocaleString())}>
                <button className="btn" onClick={() => void act(() => api.allowDomain(d.name))} disabled={st.allowed.includes(d.name)}>
                  {st.allowed.includes(d.name) ? tr('Allowed') : tr('Allow')}
                </button>
              </SettingRow>
            ))}
          </div>
        </>
      )}

      {st.running && (
        <>
          <GroupTitle>{tr('Always allowed')}</GroupTitle>
          <div className="group">
            {st.allowed.map(d => (
              <SettingRow key={d} label={d}>
                <button className="btn" onClick={() => void act(() => api.blockDomainAgain(d))}>
                  {tr('Block Again')}
                </button>
              </SettingRow>
            ))}
            <form
              className="row set-allow"
              onSubmit={e => {
                e.preventDefault()
                const d = allow.trim()
                if (!d) return
                void act(() => api.allowDomain(d)).then(() => setAllow(''))
              }}
            >
              <input
                value={allow}
                onChange={e => setAllow(e.target.value)}
                placeholder={tr('A site that must keep working, like example.com')}
                spellCheck={false}
              />
              <button className="btn" type="submit" disabled={!allow.trim()}>
                {tr('Allow')}
              </button>
            </form>
          </div>

          <div className="set-open">
            <button
              className={`btn ${confirmRemove ? 'btn-danger' : ''}`}
              onClick={() => {
                if (!confirmRemove) return setConfirmRemove(true)
                setConfirmRemove(false)
                void act(() => api.removeAdblock())
              }}
              onBlur={() => setConfirmRemove(false)}
            >
              {confirmRemove ? tr('Click Again to Turn Off') : tr('Turn Off Completely…')}
            </button>
          </div>
          <p className="pane-note">
            {tr(
              'Powered by AdGuard Home, running in a container on this server. Turning it off completely stops it; devices that use it as their DNS server then need another one.',
            )}
          </p>
        </>
      )}
    </>
  )
}

function formatCountdown(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`
}

// ---------- Remote access (Tailscale) ----------

export function RemoteAccessSection({ stats }: { stats: SystemStats | null }) {
  const ts = stats?.addresses.tailscale
  const port = location.port && location.port !== '80' ? `:${location.port}` : ''
  const urls: { label: string; url: string }[] = ts
    ? [
        { label: tr('Address on Tailscale'), url: `http://${ts.ipv4}${port}/` },
        ...(ts.dnsName ? [{ label: tr('Name on Tailscale'), url: `http://${ts.dnsName.replace(/\.$/, '')}${port}/` }] : []),
      ]
    : []
  return (
    <>
      <div className="group">
        <SettingRow label={tr('Tailscale')} note={ts ? tr('Connected · {0}', ts.dnsName ?? ts.ipv4) : tr('Not connected on this server.')}>
          <i className={`set-dot ${ts ? 'is-on' : ''}`} />
        </SettingRow>
        {urls.map(({ label, url }) => (
          <SettingRow key={url} label={label}>
            <span className="set-inline value">
              {url}
              <button className="icon-btn" onClick={() => void copyText(url)} aria-label={tr('Copy')} title={tr('Copy')}>
                <Copy size={13} />
              </button>
            </span>
          </SettingRow>
        ))}
      </div>

      <GroupTitle>{ts ? tr('Open TemanLabsOS from anywhere') : tr('Set up Tailscale on the server')}</GroupTitle>
      <div className="group set-steps">
        {ts ? (
          <>
            <Step n={1} title={tr('Install Tailscale on your phone or laptop')}>
              {tr('From tailscale.com/download, or your phone’s app store.')}{' '}
              <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                tailscale.com/download
              </a>
            </Step>
            <Step n={2} title={tr('Sign in with the same account as the server')}>
              {tr('The device joins your private network (your tailnet); nothing on your router needs opening.')}
            </Step>
            <Step n={3} title={tr('Open the address above')}>
              {tr('In any browser, from any network: at work, on mobile data, abroad. The connection is encrypted end to end.')}
            </Step>
          </>
        ) : (
          <>
            <Step n={1} title={tr('Install Tailscale')}>
              {tr('From the App Center (Tailscale), or in the Terminal:')} <code>curl -fsSL https://tailscale.com/install.sh | sh</code>
            </Step>
            <Step n={2} title={tr('Sign the server in')}>
              {tr('Run')} <code>sudo tailscale up</code>{' '}
              {tr('and open the link it prints. Use the account you’ll use on your other devices.')}
            </Step>
            <Step n={3} title={tr('Come back here')}>
              {tr('The server’s Tailscale address appears above once it’s connected.')}
            </Step>
          </>
        )}
      </div>
      <p className="pane-note">{tr('Tip: Settings → Ad Blocking can use Tailscale too, so your devices block ads on any network.')}</p>
    </>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="set-step">
      <span className="set-step-n">{n}</span>
      <span>
        <strong>{title}</strong>
        <small>{children}</small>
      </span>
    </div>
  )
}

// ---------- Lock Screen ----------

const LOCK_AFTER = [0, 1, 5, 15, 30, 60]

export function LockScreenSection() {
  const { settings, update } = useSettings()
  const { lock } = useAuth()
  return (
    <>
      <div className="group">
        <SettingRow
          label={tr('Lock the screen when inactive')}
          note={tr('After this long without a key press, click or pointer move, in this browser.')}
        >
          <PopUpButton
            value={String(settings.lockAfter ?? 0)}
            aria-label={tr('Lock the screen when inactive')}
            options={LOCK_AFTER.map(m => ({
              value: String(m),
              label: m === 0 ? tr('Never') : m === 60 ? tr('After 1 hour') : tr('After {0} minutes', m),
            }))}
            onChange={v => update({ lockAfter: Number(v) })}
          />
        </SettingRow>
        <SettingRow label={tr('Lock now')} note={tr('Windows stay open behind the lock screen; your password opens it again.')}>
          <button className="btn" onClick={lock}>
            <Lock size={13} /> {tr('Lock Screen')}
          </button>
        </SettingRow>
      </div>
      <p className="pane-note">
        {tr(
          'A locked screen is enforced by the server: nothing on the desktop, the terminal or app windows works until the password is entered.',
        )}
      </p>
    </>
  )
}

/** "Chrome on Windows" from a user agent string. */
function describeAgent(agent?: string) {
  if (!agent) return tr('Unknown browser')
  const os = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(agent)
            ? 'Mac'
            : /CrOS/.test(agent)
              ? 'ChromeOS'
              : /Linux/.test(agent)
                ? 'Linux'
                : ''
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : tr('Browser')
  return os ? tr('{0} on {1}', browser, os) : browser
}

const ago = (iso?: string) => {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return tr('just now')
  if (s < 3600) return tr('{0} min ago', Math.round(s / 60))
  if (s < 86400) return tr('{0} h ago', Math.round(s / 3600))
  const days = Math.floor(s / 86400)
  return days === 1 ? tr('yesterday') : tr('{0} days ago', days)
}

/** Signed-in browsers, with a way to sign the others out (Login & Password). */
export function SignedInBrowsers() {
  const [list, setList] = useState<SignedInBrowser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => api.signedInBrowsers().then(setList, e => setError(e instanceof Error ? e.message : String(e))), [])
  useEffect(() => {
    void load()
  }, [load])
  const others = list?.filter(b => !b.current).length ?? 0
  return (
    <>
      <GroupTitle>{tr('Signed-in browsers')}</GroupTitle>
      <div className="group">
        {list === null && !error && <SettingRow label={tr('Loading…')} />}
        {list?.map(b => (
          <SettingRow
            key={b.id}
            label={describeAgent(b.agent) + (b.current ? ` · ${tr('This browser')}` : '')}
            note={[b.addr, b.current ? tr('In use now') : tr('Last used {0}', ago(b.seen)), b.locked ? tr('Locked') : null]
              .filter(Boolean)
              .join(' · ')}
          >
            {!b.current && (
              <button className="btn" onClick={() => void api.signOutBrowser(b.id).then(load)}>
                {tr('Sign Out')}
              </button>
            )}
          </SettingRow>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      {others > 0 && (
        <div className="set-open">
          <button className="btn" onClick={() => void api.signOutOtherBrowsers().then(load)}>
            {tr('Sign Out All Others')}
          </button>
        </div>
      )}
    </>
  )
}
