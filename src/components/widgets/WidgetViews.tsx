import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react'
import type { InstalledApp, SystemStats } from '../../api/types'
import { useClock } from '../../hooks/useClock'
import { HISTORY_LENGTH, type StatsHistory } from '../../hooks/useSystemStats'
import { formatBitrate, formatBytes, formatSpeed } from '../../lib/format'
import { WIDGET_INFO, type WidgetConfig, type WidgetOptions, type WidgetSize } from '../../lib/widgets'
import { AppIcon } from '../AppIcon'
import { tr } from '../../lib/i18n'
import { CalendarWidget, NoteWidget, PowerWidget, ServerWidget, TodoWidget, type OnOptions } from './ExtraWidgets'

export interface WidgetData {
  stats: SystemStats
  history: StatsHistory
  apps: InstalledApp[]
}

export function Head({ icon: Icon, title, aside }: { icon: LucideIcon; title: string; aside?: ReactNode }) {
  return (
    <div className="w-head">
      <Icon size={13} strokeWidth={2.4} />
      {title}
      {aside && <span className="w-aside">{aside}</span>}
    </div>
  )
}

function Ring({ pct, size = 76, label }: { pct: number; size?: number; label?: ReactNode }) {
  const r = 30
  const circumference = 2 * Math.PI * r
  return (
    <div className="w-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 76 76">
        <circle className="ring-track" cx="38" cy="38" r={r} />
        <circle
          className="ring-value"
          cx="38"
          cy="38"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(pct, 100) / 100)}
        />
      </svg>
      <span>{label ?? `${Math.round(pct)}%`}</span>
    </div>
  )
}

function Bar({ pct, warn }: { pct: number; warn?: boolean }) {
  return (
    <div className={`bar ${warn ? 'is-warn' : ''}`}>
      <i style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

// ---------- Clock ----------

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const cityOf = (timeZone: string) => (timeZone || LOCAL_ZONE).split('/').pop()!.replace(/_/g, ' ')

function zonedTime(date: Date, timeZone: string) {
  const zone = timeZone || undefined
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
      .formatToParts(date)
      .map(p => [p.type, p.value]),
  )
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(date)
      .find(p => p.type === 'timeZoneName')?.value ?? ''
  return { h: Number(parts.hour), m: Number(parts.minute), s: Number(parts.second), date: `${parts.weekday} ${parts.day} ${parts.month}`, offset }
}

function AnalogFace({ h, m, s, seconds, city }: { h: number; m: number; s: number; seconds: boolean; city: string }) {
  const min = m + s / 60
  const hour = (h % 12) + min / 60
  return (
    <svg className="clock-face" viewBox="0 0 120 120" aria-hidden>
      <circle className="clock-dial" cx="60" cy="60" r="56" />
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          className={i % 5 ? 'tick' : 'tick-major'}
          x1="60"
          y1="8"
          x2="60"
          y2={i % 5 ? 11 : 13}
          transform={`rotate(${i * 6} 60 60)`}
        />
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = ((i + 1) * Math.PI) / 6
        return (
          <text key={i} className="clock-num" x={60 + 39 * Math.sin(angle)} y={60 - 39 * Math.cos(angle) + 4}>
            {i + 1}
          </text>
        )
      })}
      <text className="clock-city" x="60" y="84">
        {city.toUpperCase()}
      </text>
      <line className="hand-h" x1="60" y1="60" x2="60" y2="34" transform={`rotate(${hour * 30} 60 60)`} />
      <line className="hand-m" x1="60" y1="60" x2="60" y2="19" transform={`rotate(${min * 6} 60 60)`} />
      {seconds && <line className="hand-s" x1="60" y1="70" x2="60" y2="15" transform={`rotate(${s * 6} 60 60)`} />}
      <circle className="hand-cap" cx="60" cy="60" r="3" />
    </svg>
  )
}

function DigitalTime({ h, m, s, seconds, hour24 }: { h: number; m: number; s: number; seconds: boolean; hour24: boolean }) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const hours = hour24 ? pad(h) : String(h % 12 || 12)
  return (
    <div className="clock-digital">
      {hours}:{pad(m)}
      {seconds && <small>:{pad(s)}</small>}
      {!hour24 && <em>{h < 12 ? 'AM' : 'PM'}</em>}
    </div>
  )
}

function ClockWidget({ size, options }: { size: WidgetSize; options: WidgetOptions['clock'] }) {
  const now = useClock()
  const t = zonedTime(now, options.timeZone)
  const city = cityOf(options.timeZone)
  const face =
    options.style === 'analog' ? (
      <AnalogFace h={t.h} m={t.m} s={t.s} seconds={options.seconds} city={city} />
    ) : (
      <DigitalTime h={t.h} m={t.m} s={t.s} seconds={options.seconds} hour24={options.hour24} />
    )

  if (size === 'small') {
    return options.style === 'analog' ? (
      <div className="w-clock-analog">{face}</div>
    ) : (
      <div className="w-clock-digital">
        <span className="w-sub">{city}</span>
        {face}
        <span className="w-sub">{t.date}</span>
      </div>
    )
  }
  return (
    <div className="w-split">
      <div className={options.style === 'analog' ? 'w-clock-analog' : 'w-clock-digital w-center-v'}>{face}</div>
      <div className="w-clock-info">
        <strong>{city}</strong>
        <span>{t.date}</span>
        <small>{t.offset}</small>
      </div>
    </div>
  )
}

// ---------- CPU ----------

function CpuBars({ history, count }: { history: number[]; count: number }) {
  // null marks slots with no sample yet; they render as faint placeholders.
  const bars = [...Array<number | null>(HISTORY_LENGTH - history.length).fill(null), ...history].slice(-count)
  return (
    <div className="bars" aria-hidden>
      {bars.map((v, i) => (
        <i key={i} className={v === null ? 'is-empty' : undefined} style={{ height: `${Math.max(6, v ?? 0)}%` }} />
      ))}
    </div>
  )
}

function CpuWidget({ size, options, data }: { size: WidgetSize; options: WidgetOptions['cpu']; data: WidgetData }) {
  const { cpu } = data.stats
  const head = <Head icon={WIDGET_INFO.cpu.icon} title="CPU" aside={options.temperature && `${Math.round(cpu.temp)}°C`} />
  const big = (
    <div className="w-big">
      {Math.round(cpu.usage)}
      <small>%</small>
    </div>
  )
  if (size === 'small') {
    return (
      <>
        {head}
        {big}
        <div className="w-sub">{cpu.cores} {tr('cores')}</div>
        {options.graph ? <CpuBars history={data.history.cpu} count={18} /> : <div className="w-foot">{cpu.model}</div>}
      </>
    )
  }
  return (
    <>
      {head}
      <div className="w-split">
        <div className="w-col">
          {big}
          <div className="w-sub">{cpu.cores} {tr('cores')}</div>
          <div className="w-foot">{cpu.model}</div>
        </div>
        {options.graph && (
          <div className="w-graph">
            <CpuBars history={data.history.cpu} count={HISTORY_LENGTH} />
          </div>
        )}
      </div>
    </>
  )
}

// ---------- Memory ----------

function MemoryWidget({ size, options, data }: { size: WidgetSize; options: WidgetOptions['memory']; data: WidgetData }) {
  const { used, total } = data.stats.memory
  const pct = (used / total) * 100
  const head = <Head icon={WIDGET_INFO.memory.icon} title={tr('Memory')} />
  const visual =
    options.display === 'ring' ? (
      <Ring pct={pct} size={size === 'small' ? 76 : 92} />
    ) : (
      <div className="w-col w-grow">
        <div className="w-big">
          {Math.round(pct)}
          <small>%</small>
        </div>
        <Bar pct={pct} warn={pct > 85} />
      </div>
    )
  const details = (
    <dl className="w-details">
      <dt>{tr('Used')}</dt>
      <dd>{formatBytes(used)}</dd>
      <dt>{tr('Free')}</dt>
      <dd>{formatBytes(total - used)}</dd>
      <dt>{tr('Total')}</dt>
      <dd>{formatBytes(total, 0)}</dd>
    </dl>
  )

  if (size === 'small') {
    return (
      <>
        {head}
        <div className={options.display === 'ring' ? 'w-center' : 'w-fill'}>{visual}</div>
        {options.details && (
          <div className="w-sub w-center-text">
            {formatBytes(used)} of {formatBytes(total, 0)}
          </div>
        )}
      </>
    )
  }
  return (
    <>
      {head}
      <div className="w-split">
        <div className="w-center">{visual}</div>
        {options.details && details}
      </div>
    </>
  )
}

// ---------- Apps ----------

function AppsWidget({ size, options, data }: { size: WidgetSize; options: WidgetOptions['apps']; data: WidgetData }) {
  const running = data.apps.filter(app => app.status === 'running')
  const listed = options.show === 'running' ? running : data.apps
  const head = <Head icon={WIDGET_INFO.apps.icon} title={tr('Apps')} />
  const count = (
    <>
      <div className="w-big">
        {running.length}
        <small>/{data.apps.length}</small>
      </div>
      <div className="w-sub">{tr('running')}</div>
    </>
  )

  if (size === 'small') {
    return (
      <>
        {head}
        {count}
        {options.icons && (
          <div className="mini-icons">
            {listed.slice(0, 4).map(app => (
              <AppIcon key={app.id} icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={26} />
            ))}
            {listed.length > 4 && <span className="mini-more">+{listed.length - 4}</span>}
          </div>
        )}
      </>
    )
  }
  return (
    <>
      {head}
      <div className="w-split">
        <div className="w-col">{count}</div>
        {options.icons && (
          <div className="w-app-grid">
            {listed.slice(0, 8).map(app => (
              <span key={app.id} className={`w-app ${app.status !== 'running' ? 'is-stopped' : ''}`} title={`${app.name} · ${app.status}`}>
                <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={30} />
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ---------- Storage ----------

function StorageWidget({ size, options, data }: { size: WidgetSize; options: WidgetOptions['storage']; data: WidgetData }) {
  const disks = data.stats.disks.filter(d => !d.cloud && !options.hidden.includes(d.mount))
  const head = <Head icon={WIDGET_INFO.storage.icon} title={tr('Storage')} />
  const describe = (used: number, total: number) =>
    options.show === 'free' ? tr('{0} free of {1}', formatBytes(total - used), formatBytes(total, 0)) : tr('{0} used of {1}', formatBytes(used), formatBytes(total, 0))
  const pctOf = (used: number, total: number) => ((options.show === 'free' ? total - used : used) / total) * 100

  if (disks.length === 0) {
    return (
      <>
        {head}
        <div className="w-empty">{tr('No disks selected. Right-click to choose disks.')}</div>
      </>
    )
  }

  if (size === 'small') {
    const disk = disks[0]
    return (
      <>
        {head}
        <div className="w-center">
          <Ring pct={pctOf(disk.used, disk.total)} size={70} />
        </div>
        <div className="w-sub w-center-text">
          <strong>{disk.name}</strong> · {options.show === 'free' ? 'free' : 'used'}
        </div>
      </>
    )
  }
  return (
    <>
      {head}
      <div className="disks">
        {disks.slice(0, 3).map(disk => {
          const used = (disk.used / disk.total) * 100
          return (
            <div className="disk" key={disk.mount}>
              <div className="disk-row">
                <span>
                  {disk.name} <small>{disk.mount}</small>
                  {disk.health && disk.health !== 'ONLINE' && <b className="disk-health">{disk.health}</b>}
                </span>
                <span>{Math.round(pctOf(disk.used, disk.total))}%</span>
              </div>
              <Bar pct={used} warn={used > 85} />
              <div className="w-sub">{describe(disk.used, disk.total)}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---------- Network ----------

function Sparkline({ series }: { series: { data: number[]; className: string }[] }) {
  const max = Math.max(1, ...series.flatMap(s => s.data))
  const toPoints = (data: number[]) => {
    const offset = HISTORY_LENGTH - data.length
    return data.map((v, i) => `${((offset + i) / (HISTORY_LENGTH - 1)) * 100},${48 - (v / max) * 44}`).join(' ')
  }
  return (
    <svg className="sparkline" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden>
      {series.map(s => (
        <polyline key={s.className} className={s.className} points={toPoints(s.data)} />
      ))}
    </svg>
  )
}

function NetworkWidget({ size, options, data }: { size: WidgetSize; options: WidgetOptions['network']; data: WidgetData }) {
  const { rx, tx } = data.stats.network
  const speed = options.units === 'bits' ? formatBitrate : formatSpeed
  const iface = data.stats.addresses.lan?.interface ?? 'eth0'
  const stats = (
    <div className="net-stats">
      <div className="net-stat">
        <small>
          <ArrowDown size={11} strokeWidth={3} className="net-rx" /> {tr('Download')}
        </small>
        <strong>{speed(rx)}</strong>
      </div>
      <div className="net-stat">
        <small>
          <ArrowUp size={11} strokeWidth={3} className="net-tx" /> {tr('Upload')}
        </small>
        <strong>{speed(tx)}</strong>
      </div>
    </div>
  )
  const graph = options.graph && (
    <Sparkline
      series={[
        { data: data.history.rx, className: 'net-rx' },
        { data: data.history.tx, className: 'net-tx' },
      ]}
    />
  )
  return (
    <>
      <Head icon={WIDGET_INFO.network.icon} title={tr('Network')} aside={iface} />
      <div className={size === 'small' ? 'net-body net-body-small' : 'net-body'}>
        {stats}
        {graph}
      </div>
    </>
  )
}

/** Renders the content of one widget for its type, size and options. onOptions saves what a
 * widget keeps itself (a note's text); without it the widget is shown read-only (the gallery). */
export function WidgetContent({ config, data, onOptions }: { config: WidgetConfig; data: WidgetData; onOptions?: OnOptions }) {
  switch (config.type) {
    case 'note':
      return <NoteWidget options={config.options} onOptions={onOptions} />
    case 'todo':
      return <TodoWidget size={config.size} options={config.options} onOptions={onOptions} />
    case 'calendar':
      return <CalendarWidget size={config.size} options={config.options} />
    case 'power':
      return <PowerWidget size={config.size} options={config.options} data={data} />
    case 'server':
      return <ServerWidget size={config.size} options={config.options} data={data} />
    case 'clock':
      return <ClockWidget size={config.size} options={config.options} />
    case 'cpu':
      return <CpuWidget size={config.size} options={config.options} data={data} />
    case 'memory':
      return <MemoryWidget size={config.size} options={config.options} data={data} />
    case 'apps':
      return <AppsWidget size={config.size} options={config.options} data={data} />
    case 'storage':
      return <StorageWidget size={config.size} options={config.options} data={data} />
    case 'network':
      return <NetworkWidget size={config.size} options={config.options} data={data} />
  }
}
