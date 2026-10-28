import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowDown, ArrowUp, CalendarClock, Download, ExternalLink, Gauge, LoaderCircle, Play, Settings2, Square, Timer, Trash2, TriangleAlert, X } from 'lucide-react'
import { api } from '../api'
import type { OoklaServer, SpeedConfig, SpeedInfo, SpeedRange, SpeedResult, SpeedRun } from '../api/types'
import { HistoryChart } from '../components/HistoryChart'
import { formatBytes, formatFileDate, formatUptime } from '../lib/format'
import { tr } from '../lib/i18n'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

// Speed Test: the internet's speed, by hand or on a schedule (see server/speedtest.go), with the
// results over time compared with the plan the ISP sells, and the hours the line slows down.

const RANGES: { id: SpeedRange; label: string; hours: number }[] = [
  { id: '24h', label: tr('24 hours'), hours: 24 },
  { id: '7d', label: tr('7 days'), hours: 168 },
  { id: '30d', label: tr('30 days'), hours: 720 },
  { id: '90d', label: tr('90 days'), hours: 2160 },
]

const INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 0, label: tr('Only when I run one') },
  { minutes: 15, label: tr('Every 15 minutes') },
  { minutes: 30, label: tr('Every 30 minutes') },
  { minutes: 60, label: tr('Every hour') },
  { minutes: 120, label: tr('Every 2 hours') },
  { minutes: 180, label: tr('Every 3 hours') },
  { minutes: 360, label: tr('Every 6 hours') },
  { minutes: 720, label: tr('Every 12 hours') },
  { minutes: 1440, label: tr('Once a day') },
]

const PROVIDER_NAME = { cloudflare: 'Cloudflare', ookla: 'Ookla Speedtest' }
const PHASE_LABEL = { starting: tr('Connecting…'), ping: tr('Measuring ping…'), download: tr('Download'), upload: tr('Upload') }

const mbps = (v: number) => tr('{0} Mbps', v >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 }))
const ms = (v: number) => tr('{0} ms', v >= 10 ? Math.round(v) : v.toLocaleString(undefined, { maximumFractionDigits: 1 }))
const ago = (iso: string) => {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000
  return sec < 60 ? tr('just now') : tr('{0} ago', formatUptime(sec))
}
const ofPlan = (v: number, plan: number) => (plan > 0 ? Math.round((v / plan) * 100) : null)

function median(v: number[]) {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** A stretch of time on the charts: the median of the tests in it. */
interface SpeedPoint {
  t: number
  down: number
  up: number
  ping: number
  jitter: number
  tests: number
}

// Stretches to group tests in (minutes): the schedule's own, or longer for a long range.
const STEPS = [15, 30, 60, 120, 180, 360, 720, 1440]

function stretches(results: SpeedResult[], hours: number, interval: number): (SpeedPoint | null)[] {
  const want = Math.max(interval || 60, (hours * 60) / 200)
  const step = (STEPS.find(s => s >= want) ?? 1440) * 60
  // In local time, so a day starts at midnight here.
  const off = -new Date().getTimezoneOffset() * 60
  const end = Math.ceil((Date.now() / 1000 + off) / step) * step - off
  const n = Math.ceil((hours * 3600) / step)
  const start = end - n * step
  const groups: SpeedResult[][] = Array.from({ length: n }, () => [])
  for (const r of results) {
    if (r.error) continue
    const i = Math.floor((new Date(r.time).getTime() / 1000 - start) / step)
    if (i >= 0 && i < n) groups[i].push(r)
  }
  return groups.map((g, i) =>
    g.length
      ? {
          t: start + i * step,
          down: median(g.map(r => r.down)),
          up: median(g.map(r => r.up)),
          ping: median(g.map(r => r.ping)),
          jitter: median(g.map(r => r.jitter)),
          tests: g.length,
        }
      : null,
  )
}

/** The data a test uses, from the last few of the provider in use. */
function perTest(results: SpeedResult[], config: SpeedConfig) {
  const same = results.filter(r => !r.error && r.provider === config.provider && r.bytes > 0).slice(-8)
  return same.length ? same.reduce((s, r) => s + r.bytes, 0) / same.length : null
}

export function SpeedTest() {
  const [range, setRange] = useState<SpeedRange>('7d')
  const [info, setInfo] = useState<SpeedInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<SpeedRun | null>(null)
  const [settings, setSettings] = useState(false)
  const [starting, setStarting] = useState(false)

  const load = useCallback(() => {
    api.speedTest(range).then(
      i => {
        setInfo(i)
        setRun(i.running)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [range])
  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  // While a test runs (by hand or on schedule), follow it closely; reload when it's done.
  const running = !!run
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      api.speedTest().then(
        i => {
          setRun(i.running)
          if (!i.running) load()
        },
        () => {},
      )
    }, 600)
    return () => clearInterval(timer)
  }, [running, load])

  const start = async () => {
    setStarting(true)
    try {
      await api.runSpeedTest()
      const i = await api.speedTest()
      setRun(i.running)
      if (!i.running) load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }
  const stop = async () => {
    await api.stopSpeedTest().catch(() => {})
    setRun(null)
    load()
  }

  const config = info?.config
  const results = info?.results ?? []
  const last = info?.last ?? null
  const schedule = config ? INTERVALS.find(i => i.minutes === config.interval)?.label : ''

  return (
    <div className="dv st">
      <WindowToolbar>
        <ToolbarTitle
          title={tr('Speed Test')}
          subtitle={config ? (config.interval ? `${schedule} · ${PROVIDER_NAME[config.provider]}` : tr('Tests only when you run one')) : undefined}
        />
        <span className="tb-spacer" />
        <button className="pill-btn" onClick={() => setSettings(true)} disabled={!info}>
          <Settings2 size={13} /> {tr('Settings')}
        </button>
        {run ? (
          <button className="pill-btn" onClick={() => void stop()}>
            <Square size={12} /> {tr('Stop')}
          </button>
        ) : (
          <button className="pill-btn is-on" onClick={() => void start()} disabled={!info || starting}>
            <Play size={12} /> {tr('Run Test')}
          </button>
        )}
      </WindowToolbar>
      <div className="dv-body st-body">
        {error && (
          <p className="form-error dv-error">
            <TriangleAlert size={13} /> {error}
          </p>
        )}
        {info === null && !error && (
          <div className="dv-empty">
            <LoaderCircle size={20} className="spin" />
          </div>
        )}
        {info && (run ? <Live run={run} config={info.config} /> : last ? <LastResult result={last} config={info.config} /> : <FirstTest config={info.config} onRun={() => void start()} onSettings={() => setSettings(true)} />)}
        {info && info.total > 0 && (
          <>
            <div className="hv-bar st-range">
              <p className="hv-note">
                {info.since ? tr('{0} tests since {1}, kept for 180 days.', info.total.toLocaleString(), formatFileDate(info.since)) : ''}
              </p>
              <div className="segmented hv-range" role="radiogroup" aria-label={tr('Time range')}>
                {RANGES.map(r => (
                  <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? 'is-active' : ''} onClick={() => setRange(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <History results={results} config={info.config} hours={RANGES.find(r => r.id === range)?.hours ?? 168} />
            <ResultList results={results} onCleared={load} />
          </>
        )}
      </div>
      {settings && info && (
        <SettingsSheet
          info={info}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false)
            load()
          }}
          onChanged={load}
        />
      )}
    </div>
  )
}

function Live({ run, config }: { run: SpeedRun; config: SpeedConfig }) {
  const plan = run.phase === 'upload' ? config.planUp : config.planDown
  const measuring = run.phase === 'download' || run.phase === 'upload'
  return (
    <section className="st-live" aria-live="polite">
      <span className="st-live-phase">
        {run.phase === 'download' ? <ArrowDown size={14} /> : run.phase === 'upload' ? <ArrowUp size={14} /> : <Timer size={14} />}
        {PHASE_LABEL[run.phase]}
      </span>
      <strong className="st-live-speed">{measuring ? mbps(run.mbps) : '…'}</strong>
      <span className="st-meter" role="progressbar" aria-valuenow={Math.round(run.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.round(run.progress * 100)}%` }} />
      </span>
      <small>
        {PROVIDER_NAME[run.provider]}
        {measuring && plan > 0 ? ` · ${tr('{0}% of the plan', ofPlan(run.mbps, plan) ?? 0)}` : ''}
        {!run.manual ? ` · ${tr('Scheduled test')}` : ''}
      </small>
    </section>
  )
}

function Stat({ icon: Icon, label, value, note }: { icon: typeof ArrowDown; label: string; value: string; note?: string | null }) {
  return (
    <div className="st-stat">
      <span className="st-stat-label">
        <Icon size={13} /> {label}
      </span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

function LastResult({ result: r, config }: { result: SpeedResult; config: SpeedConfig }) {
  const planNote = (v: number, plan: number) => (plan > 0 ? tr('{0}% of {1}', ofPlan(v, plan) ?? 0, mbps(plan)) : null)
  return (
    <section className="st-last">
      {r.error ? (
        <p className="st-failed">
          <TriangleAlert size={15} />
          <span>
            <strong>{tr('The last test failed')}</strong>
            <small>{r.error}</small>
          </span>
        </p>
      ) : (
        <div className="st-stats">
          <Stat icon={ArrowDown} label={tr('Download')} value={mbps(r.down)} note={planNote(r.down, config.planDown)} />
          <Stat icon={ArrowUp} label={tr('Upload')} value={mbps(r.up)} note={planNote(r.up, config.planUp)} />
          <Stat icon={Timer} label={tr('Ping')} value={ms(r.ping)} note={tr('jitter {0}', ms(r.jitter))} />
          {r.loaded ? <Stat icon={Gauge} label={tr('Ping while busy')} value={ms(r.loaded)} note={r.loss !== undefined ? tr('{0}% packets lost', r.loss.toLocaleString()) : null} /> : null}
        </div>
      )}
      <small className="st-meta">
        {[
          `${ago(r.time)}${r.manual ? '' : ` · ${tr('scheduled')}`}`,
          r.server,
          r.isp,
          r.ip,
          r.bytes > 0 ? tr('{0} of data', formatBytes(r.bytes)) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer">
            {tr('Result on speedtest.net')} <ExternalLink size={11} />
          </a>
        )}
      </small>
    </section>
  )
}

function FirstTest({ config, onRun, onSettings }: { config: SpeedConfig; onRun: () => void; onSettings: () => void }) {
  return (
    <div className="dv-empty">
      <span className="dv-empty-icon">
        <Gauge size={30} />
      </span>
      <h2>{tr('How fast is your internet?')}</h2>
      <p>
        {tr('Test it now, or every hour or so: the server keeps the results for 180 days, shows when the line slows down, and how it compares with the plan you pay for.')}
      </p>
      <div className="dv-empty-actions">
        <button className="btn" onClick={onSettings}>
          <CalendarClock size={13} /> {config.interval ? tr('Schedule') : tr('Test on a Schedule')}
        </button>
        <button className="btn btn-primary" onClick={onRun}>
          <Play size={12} /> {tr('Run First Test')}
        </button>
      </div>
    </div>
  )
}

function History({ results, config, hours }: { results: SpeedResult[]; config: SpeedConfig; hours: number }) {
  const ok = results.filter(r => !r.error)
  const failed = results.length - ok.length
  const points = stretches(results, hours, config.interval)
  const long = hours > 24
  if (!ok.length)
    return <p className="dv-muted st-none">{failed ? tr('Every test in this range failed.') : tr('No tests in this range.')}</p>

  const downs = ok.map(r => r.down)
  const slowest = ok.reduce((a, b) => (b.down < a.down ? b : a))
  const below = config.planDown > 0 ? ok.filter(r => r.down < config.planDown * 0.8).length : 0
  return (
    <>
      <div className="st-summary">
        <Stat icon={ArrowDown} label={tr('Typical download')} value={mbps(median(downs))} note={config.planDown ? tr('{0}% of the plan', ofPlan(median(downs), config.planDown) ?? 0) : null} />
        <Stat icon={ArrowUp} label={tr('Typical upload')} value={mbps(median(ok.map(r => r.up)))} note={config.planUp ? tr('{0}% of the plan', ofPlan(median(ok.map(r => r.up)), config.planUp) ?? 0) : null} />
        <Stat icon={ArrowDown} label={tr('Slowest')} value={mbps(slowest.down)} note={formatFileDate(slowest.time)} />
        <Stat
          icon={TriangleAlert}
          label={config.planDown ? tr('Under 80% of the plan') : tr('Failed tests')}
          value={config.planDown ? `${below} / ${ok.length}` : String(failed)}
          note={config.planDown ? (failed ? tr('{0} failed', failed) : tr('none failed')) : tr('of {0} tests', results.length)}
        />
      </div>
      <div className="hv-grid st-charts">
        <HistoryChart<SpeedPoint>
          title={tr('Speed')}
          points={points}
          series={[
            { key: 'down', label: tr('Download'), slot: 1 },
            { key: 'up', label: tr('Upload'), slot: 2 },
          ]}
          format={mbps}
          long={long}
          summary={tr('Median of the tests in each stretch')}
          reference={config.planDown ? { value: config.planDown, label: tr('Plan {0}', mbps(config.planDown)) } : undefined}
          gapLabel={tr('No test')}
          detail={p => (p.tests > 1 ? tr('{0} tests', p.tests) : null)}
        />
        <HistoryChart<SpeedPoint>
          title={tr('Ping')}
          points={points}
          series={[
            { key: 'ping', label: tr('Ping'), slot: 1 },
            { key: 'jitter', label: tr('Jitter'), slot: 2 },
          ]}
          format={ms}
          long={long}
          gapLabel={tr('No test')}
        />
      </div>
      <ByHour results={ok} plan={config.planDown} />
    </>
  )
}

const BAR_H = 150
const BAR_PAD = { top: 12, right: 10, bottom: 22, left: 52 }

/** The typical download at each hour of the day: when the line slows down (evenings, often). */
function ByHour({ results, plan }: { results: SpeedResult[]; plan: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const days = new Set(results.map(r => new Date(r.time).toDateString())).size
  if (days < 2) return null
  const hours = Array.from({ length: 24 }, (_, h) => results.filter(r => new Date(r.time).getHours() === h).map(r => r.down))
  const values = hours.map(median)
  const peak = Math.max(plan, ...values)
  const top = peak <= 0 ? 1 : niceTop(peak * 1.1)
  const plotW = width - BAR_PAD.left - BAR_PAD.right
  const plotH = BAR_H - BAR_PAD.top - BAR_PAD.bottom
  const slot = plotW / 24
  const barW = Math.max(3, slot - 2)
  const y = (v: number) => BAR_PAD.top + plotH - (Math.min(v, top) / top) * plotH
  const withTests = values.map((v, h) => ({ v, h })).filter(x => hours[x.h].length)
  const worst = withTests.reduce((a, b) => (b.v < a.v ? b : a), withTests[0])
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const h = Math.floor((((e.clientX - r.left) / r.width) * width - BAR_PAD.left) / slot)
    setHover(h >= 0 && h < 24 ? h : null)
  }
  return (
    <figure className="hc st-hours">
      <figcaption>
        <strong>{tr('Download by hour of the day')}</strong>
        {worst && <small>{tr('Slowest around {0}: typically {1}', hourLabel(worst.h), mbps(worst.v))}</small>}
      </figcaption>
      <div className="hc-plot" ref={box}>
        <svg width={width} height={BAR_H} viewBox={`0 0 ${width} ${BAR_H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={tr('Download by hour of the day')}>
          {[0, top / 2, top].map(t => (
            <g key={t}>
              <line className="hc-grid" x1={BAR_PAD.left} x2={width - BAR_PAD.right} y1={y(t)} y2={y(t)} />
              <text className="hc-axis" x={BAR_PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {mbps(t)}
              </text>
            </g>
          ))}
          {values.map((v, h) => {
            const x = BAR_PAD.left + h * slot + (slot - barW) / 2
            const h0 = y(0) - y(v)
            return v > 0 ? <path key={h} className={`st-bar ${hover === h ? 'is-hover' : ''}`} d={barPath(x, y(v), barW, h0, Math.min(4, barW / 2))} /> : null
          })}
          {[0, 6, 12, 18].map(h => (
            <text key={h} className="hc-axis" x={BAR_PAD.left + h * slot + slot / 2} y={BAR_H - 6} textAnchor="middle">
              {hourLabel(h)}
            </text>
          ))}
          {plan > 0 && (
            <g>
              <line className="hc-ref" x1={BAR_PAD.left} x2={width - BAR_PAD.right} y1={y(plan)} y2={y(plan)} />
              <text className="hc-axis hc-ref-label" x={width - BAR_PAD.right - 4} y={y(plan) - 5} textAnchor="end">
                {tr('Plan {0}', mbps(plan))}
              </text>
            </g>
          )}
          <rect x={BAR_PAD.left} y={BAR_PAD.top} width={plotW} height={plotH} fill="transparent" />
        </svg>
        {hover !== null && (
          <div className={`hc-tip ${hover >= 12 ? 'is-left' : ''}`} style={{ left: BAR_PAD.left + hover * slot + slot / 2 }}>
            <span className="hc-tip-time">
              {hourLabel(hover)}–{hourLabel((hover + 1) % 24)}
            </span>
            {hours[hover].length ? (
              <>
                <span className="hc-tip-row">
                  <i className="hc-swatch" /> {tr('Typical download')} <b>{mbps(values[hover])}</b>
                </span>
                <span className="hc-tip-row is-dim">{tr('{0} tests', hours[hover].length)}</span>
              </>
            ) : (
              <span className="hc-tip-row is-dim">{tr('No test')}</span>
            )}
          </div>
        )}
      </div>
    </figure>
  )
}

function niceTop(v: number) {
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}

/** A bar with its top corners rounded, standing on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

function ResultList({ results, onCleared }: { results: SpeedResult[]; onCleared: () => void }) {
  const [all, setAll] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const newest = [...results].reverse()
  const shown = all ? newest : newest.slice(0, 12)
  return (
    <section className="st-results">
      <header>
        <h4 className="dv-subhead">{tr('Tests')}</h4>
        <span className="tb-spacer" />
        <a className="btn" href={api.speedExportUrl()} download="speedtest.csv">
          <Download size={13} /> {tr('Export CSV')}
        </a>
        <button
          className={`btn ${confirm ? 'btn-danger' : ''}`}
          onClick={() => {
            if (!confirm) return setConfirm(true)
            setConfirm(false)
            void api.clearSpeedResults().then(onCleared)
          }}
          onBlur={() => setConfirm(false)}
        >
          <Trash2 size={13} /> {confirm ? tr('Clear All Results?') : tr('Clear')}
        </button>
      </header>
      <div className="st-table" role="table">
        <div className="st-row is-head" role="row">
          <span role="columnheader">{tr('Time')}</span>
          <span role="columnheader">{tr('Download')}</span>
          <span role="columnheader">{tr('Upload')}</span>
          <span role="columnheader">{tr('Ping')}</span>
          <span role="columnheader">{tr('Server')}</span>
        </div>
        {shown.map(r => (
          <div key={r.time} className={`st-row ${r.error ? 'is-failed' : ''}`} role="row">
            <span role="cell">
              {formatFileDate(r.time)}
              {r.manual && <small>{tr('by hand')}</small>}
            </span>
            {r.error ? (
              <span role="cell" className="st-row-error">
                <TriangleAlert size={12} /> {r.error}
              </span>
            ) : (
              <>
                <span role="cell">{mbps(r.down)}</span>
                <span role="cell">{mbps(r.up)}</span>
                <span role="cell">{ms(r.ping)}</span>
                <span role="cell" className="st-row-server">
                  {r.server}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" aria-label={tr('Result on speedtest.net')} title={tr('Result on speedtest.net')}>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      {newest.length > shown.length && (
        <button className="link-btn st-more" onClick={() => setAll(true)}>
          {tr('Show all {0}', newest.length)}
        </button>
      )}
    </section>
  )
}

function SettingsSheet({ info, onClose, onSaved, onChanged }: { info: SpeedInfo; onClose: () => void; onSaved: () => void; onChanged: () => void }) {
  const [d, setD] = useState<SpeedConfig>(info.config)
  const [ookla, setOokla] = useState(info.ookla.installed && info.config.ooklaAccepted)
  const [accept, setAccept] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [servers, setServers] = useState<OoklaServer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<SpeedConfig>) => setD(c => ({ ...c, ...patch }))

  useEffect(() => {
    if (!ookla || d.provider !== 'ookla' || servers) return
    api.ooklaServers().then(setServers, () => setServers([]))
  }, [ookla, d.provider, servers])

  const install = async () => {
    setInstalling(true)
    setError(null)
    try {
      await api.installOokla()
      setOokla(true)
      set({ provider: 'ookla', ooklaAccepted: true })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(false)
    }
  }
  const remove = async () => {
    await api.removeOokla()
    setOokla(false)
    setServers(null)
    set({ provider: 'cloudflare', ooklaServer: 0, ooklaAccepted: false })
    onChanged()
  }
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.saveSpeedConfig(d)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  // What the schedule costs in data: from the last tests of this provider, else a guess.
  const measured = perTest(info.results, d)
  const guess = d.provider === 'ookla' ? Math.max(150e6, ((d.planDown || 100) + (d.planUp || 50)) * 1.5e6) : d.size === 'light' ? 95e6 : Math.max(200e6, ((d.planDown || 100) * 10 + (d.planUp || 50) * 8) / 8 * 1e6)
  const each = measured ?? guess
  const perDay = d.interval ? (1440 / d.interval) * each : 0
  const plan = (v: number) => (v > 0 ? String(v) : '')
  const num = (s: string) => Math.max(0, Number(s.replace(/[^\d.]/g, '')) || 0)

  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci dv-sheet" role="dialog" aria-label={tr('Speed Test Settings')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{tr('Speed Test Settings')}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <form
          className="ci-body cm-form dv-form st-form"
          onSubmit={e => {
            e.preventDefault()
            void save()
          }}
        >
          <label>
            <span>{tr('Test')}</span>
            <select value={d.interval} onChange={e => set({ interval: Number(e.target.value) })}>
              {INTERVALS.map(i => (
                <option key={i.minutes} value={i.minutes}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>

          <h4 className="dv-subhead">{tr('Tested with')}</h4>
          <div className="st-providers" role="radiogroup" aria-label={tr('Tested with')}>
            <button type="button" role="radio" aria-checked={d.provider === 'cloudflare'} className={`st-provider ${d.provider === 'cloudflare' ? 'is-active' : ''}`} onClick={() => set({ provider: 'cloudflare' })}>
              <strong>Cloudflare</strong>
              <small>{tr('Built in, nothing to install. Measures to Cloudflare’s nearest data centre (from Indonesia often Singapore, so the ping is higher). It turns away tests that come too often: best every hour or less often.')}</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={d.provider === 'ookla'}
              className={`st-provider ${d.provider === 'ookla' ? 'is-active' : ''}`}
              onClick={() => set({ provider: 'ookla' })}
              disabled={!info.ookla.available}
            >
              <strong>Ookla Speedtest</strong>
              <small>{tr('The test of speedtest.net, with its official app: a server near you (often your ISP’s own), and each result gets a speedtest.net link to show your ISP. Fine for frequent tests.')}</small>
            </button>
          </div>

          {d.provider === 'ookla' && !ookla && (
            <div className="st-license">
              <p>
                {tr('Ookla’s Speedtest CLI is free for personal, non-commercial use. The server downloads it from Ookla (about 1 MB); using it means accepting Ookla’s terms and privacy policy.')}{' '}
                <a href="https://www.speedtest.net/about/eula" target="_blank" rel="noreferrer">
                  {tr('Terms')}
                </a>{' '}
                ·{' '}
                <a href="https://www.speedtest.net/about/privacy" target="_blank" rel="noreferrer">
                  {tr('Privacy policy')}
                </a>
              </p>
              <label className="st-check">
                <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} />
                <span>{tr('I accept Ookla’s terms and privacy policy')}</span>
              </label>
              <button type="button" className="btn btn-primary" disabled={!accept || installing} onClick={() => void install()}>
                {installing ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />} {tr('Install Speedtest')}
              </button>
            </div>
          )}
          {d.provider === 'ookla' && ookla && (
            <div className="dv-row">
              <label>
                <span>{tr('Server')}</span>
                <select value={d.ooklaServer} onChange={e => set({ ooklaServer: Number(e.target.value) })}>
                  <option value={0}>{tr('The nearest (picked each time)')}</option>
                  {servers?.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} – {s.location}
                    </option>
                  ))}
                  {servers === null && d.ooklaServer > 0 && <option value={d.ooklaServer}>#{d.ooklaServer}</option>}
                </select>
              </label>
              <button type="button" className="link-btn st-remove" onClick={() => void remove()}>
                {tr('Remove Speedtest')}
              </button>
            </div>
          )}
          {d.provider === 'cloudflare' && (
            <>
              <div className="segmented" role="radiogroup" aria-label={tr('Test size')}>
                {(['light', 'full'] as const).map(s => (
                  <button key={s} type="button" role="radio" aria-checked={d.size === s} className={d.size === s ? 'is-active' : ''} onClick={() => set({ size: s })}>
                    {s === 'light' ? tr('Light') : tr('Full')}
                  </button>
                ))}
              </div>
              <small>
                {d.size === 'light'
                  ? tr('At most about 90 MB a test. Enough for lines up to about 300 Mbps.')
                  : tr('Up to 10 seconds each way (up to 900 MB), for fast lines.')}
              </small>
            </>
          )}

          <h4 className="dv-subhead">{tr('Your plan')}</h4>
          <div className="dv-row">
            <label>
              <span>{tr('Download (Mbps)')}</span>
              <input inputMode="decimal" value={plan(d.planDown)} onChange={e => set({ planDown: num(e.target.value) })} placeholder="100" />
            </label>
            <label>
              <span>{tr('Upload (Mbps)')}</span>
              <input inputMode="decimal" value={plan(d.planUp)} onChange={e => set({ planUp: num(e.target.value) })} placeholder="50" />
            </label>
          </div>
          <small>{tr('The speeds on your ISP’s bill, to compare the results with.')}</small>

          {d.interval > 0 && (
            <p className={`st-data ${perDay > 5e9 ? 'is-warn' : ''}`}>
              {perDay > 5e9 && <TriangleAlert size={13} />}
              <span>
                {tr('About {0} of data a day, {1} a month ({2} a test{3}).', formatBytes(perDay), formatBytes(perDay * 30), formatBytes(each), measured ? '' : tr(', estimated'))}
                {perDay > 5e9 && ` ${tr('If your plan has a data limit (FUP), test less often.')}`}
              </span>
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </form>
        <footer className="ci-foot">
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || (d.provider === 'ookla' && !ookla)}>
            {tr('Save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
