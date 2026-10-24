import { useEffect, useState, type ReactNode } from 'react'
import { Activity, CalendarClock, Copy, Cpu, EthernetPort, Network, Waypoints, Wifi, Zap, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import type { ProcessInfo, SystemStats } from '../api/types'
import { HISTORY_LENGTH, type StatsHistory } from '../hooks/useSystemStats'
import { copyText } from '../lib/clipboard'
import { formatSpeed } from '../lib/format'
import { language, tr } from '../lib/i18n'
import { Glass } from './Glass'
import { MonthCalendar } from './MonthCalendar'

// The panels that open from the menu bar's status items: processor, power, network, clock.

const locale = language === 'id' ? 'id-ID' : 'en-GB'
const PROCESS_POLL_MS = 3000

function Panel({ icon: Icon, title, subtitle, children, footer }: { icon: LucideIcon; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Glass radius={22} bezel={14} depth={14} blur={18} className="status-panel tint-panel" role="dialog" aria-label={title}>
      <div className="sp-head">
        <span className="sp-icon">
          <Icon size={15} />
        </span>
        <span>
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </span>
      </div>
      {children}
      {footer && <div className="sp-foot">{footer}</div>}
    </Glass>
  )
}

/** A bar graph of the recent readings; slots without one yet are faint. */
function Bars({ values, max, className = '' }: { values: number[]; max: number; className?: string }) {
  const bars = [...Array<number | null>(Math.max(0, HISTORY_LENGTH - values.length)).fill(null), ...values.slice(-HISTORY_LENGTH)]
  return (
    <div className={`sp-bars ${className}`} aria-hidden>
      {bars.map((v, i) => (
        <i key={i} className={v === null ? 'is-empty' : undefined} style={{ height: `${Math.max(4, Math.min(100, ((v ?? 0) / max) * 100))}%` }} />
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sp-row">
      <span>{label}</span>
      <span className="sp-value">{children}</span>
    </div>
  )
}

// ---------- Processor ----------

export function CpuPanel({ stats, history, onOpen }: { stats: SystemStats; history: StatsHistory; onOpen: () => void }) {
  const [top, setTop] = useState<ProcessInfo[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      api.listProcesses().then(
        list => alive && setTop([...list].sort((a, b) => b.cpu - a.cpu).slice(0, 5)),
        () => alive && setTop([]),
      )
    void load()
    const timer = setInterval(load, PROCESS_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  const { cpu } = stats
  return (
    <Panel
      icon={Cpu}
      title={tr('Processor')}
      subtitle={cpu.model}
      footer={
        <button className="btn" onClick={onOpen}>
          <Activity size={13} /> {tr('Open System Monitor')}
        </button>
      }
    >
      <div className="sp-big-row">
        <div className="sp-big">
          {Math.round(cpu.usage)}
          <small>%</small>
        </div>
        <div className="sp-side">
          <span>{tr('{0} cores', cpu.cores)}</span>
          {cpu.temp > 0 && <span>{Math.round(cpu.temp)}°C</span>}
          {stats.load && <span title={tr('Load average over 1, 5 and 15 minutes')}>{stats.load.map(l => l.toFixed(2)).join(' · ')}</span>}
        </div>
      </div>
      <Bars values={history.cpu} max={100} />
      <h4 className="sp-heading">{tr('Using the most CPU')}</h4>
      <div className="sp-list">
        {top === null && <span className="sp-muted">{tr('Loading…')}</span>}
        {top?.map(p => (
          <div key={p.pid} className="sp-proc" title={p.command ?? p.name}>
            <span>{p.name}</span>
            <small>{p.user}</small>
            <b>{p.cpu.toFixed(1)}%</b>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ---------- Power ----------

const PART_NAME: Record<string, string> = { core: tr('Cores'), uncore: tr('Graphics'), dram: tr('Memory'), psys: tr('Platform') }

export function PowerPanel({ power, history }: { power: NonNullable<SystemStats['power']>; history: StatsHistory }) {
  const parts = (power.parts ?? []).filter(p => PART_NAME[p.name])
  const peak = Math.max(10, ...history.power) * 1.25
  const avg = history.power.length ? history.power.reduce((a, b) => a + b, 0) / history.power.length : power.watts
  return (
    <Panel icon={Zap} title={tr('Power')} subtitle={power.source === 'battery' ? tr('From the battery') : tr('CPU and memory')}>
      <div className="sp-big-row">
        <div className="sp-big">
          {power.watts < 10 ? power.watts.toFixed(1) : Math.round(power.watts)}
          <small>W</small>
        </div>
        <div className="sp-side">
          <span>{tr('Average {0} W', avg.toFixed(1))}</span>
          <span>{tr('Peak {0} W', Math.max(power.watts, ...history.power).toFixed(1))}</span>
        </div>
      </div>
      <Bars values={history.power} max={peak} className="is-power" />
      {parts.length > 0 && (
        <div className="sp-rows">
          {parts.map(p => (
            <Row key={p.name} label={PART_NAME[p.name]}>
              {p.watts.toFixed(1)} W
            </Row>
          ))}
        </div>
      )}
      {power.source === 'cpu' && (
        <p className="sp-note">{tr('Measured by the processor itself. The disks, the board and the power supply aren’t included, so the server draws more from the wall.')}</p>
      )}
    </Panel>
  )
}

// ---------- Network ----------

/** Ethernet or Wi-Fi, from the interface's name (wl… is wireless). */
export const isWireless = (iface?: string) => !!iface && /^(wl|wlan|wifi)/.test(iface)

export function NetworkPanel({ stats, history, onOpen }: { stats: SystemStats; history: StatsHistory; onOpen: () => void }) {
  const { lan, tailscale } = stats.addresses
  const wireless = isWireless(lan?.interface)
  // Each direction on its own scale: uploads are often far smaller than downloads.
  const peak = (values: number[]) => Math.max(64 * 1024, ...values) * 1.1
  const copy = (text: string) => (
    <button className="sp-copy" onClick={() => void copyText(text)} aria-label={tr('Copy')} title={tr('Copy')}>
      <Copy size={12} />
    </button>
  )
  return (
    <Panel
      icon={wireless ? Wifi : EthernetPort}
      title={lan ? (wireless ? tr('Wi-Fi') : tr('Ethernet')) : tr('Network')}
      subtitle={lan ? tr('Connected · {0}', lan.interface) : tr('No network address')}
      footer={
        <button className="btn" onClick={onOpen}>
          <Network size={13} /> {tr('Open Network Tools')}
        </button>
      }
    >
      <div className="sp-rows">
        {lan && (
          <Row label={tr('Local IP')}>
            {lan.ipv4} {copy(lan.ipv4)}
          </Row>
        )}
        {tailscale && (
          <Row label="Tailscale">
            <Waypoints size={12} /> {tailscale.ipv4} {copy(tailscale.ipv4)}
          </Row>
        )}
        {tailscale?.dnsName && <Row label={tr('Tailscale name')}>{tailscale.dnsName}</Row>}
      </div>
      <div className="sp-speeds">
        <div>
          <small>↓ {tr('Download')}</small>
          <strong>{formatSpeed(stats.network.rx)}</strong>
          <Bars values={history.rx} max={peak(history.rx)} className="is-rx" />
        </div>
        <div>
          <small>↑ {tr('Upload')}</small>
          <strong>{formatSpeed(stats.network.tx)}</strong>
          <Bars values={history.tx} max={peak(history.tx)} className="is-tx" />
        </div>
      </div>
    </Panel>
  )
}

// ---------- Clock ----------

export function ClockPanel({ now, onSettings }: { now: Date; onSettings: () => void }) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offset = -now.getTimezoneOffset() / 60
  return (
    <Panel
      icon={CalendarClock}
      title={now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      subtitle={`${zone.replace(/_/g, ' ')} · UTC${offset >= 0 ? '+' : ''}${offset}`}
      footer={
        <button className="btn" onClick={onSettings}>
          <CalendarClock size={13} /> {tr('Date & Time Settings…')}
        </button>
      }
    >
      <div className="sp-time">{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
      <div className="sp-month">{now.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</div>
      <MonthCalendar date={now} className="sp-cal" />
    </Panel>
  )
}
