import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { HistoryData, HistoryPoint, HistoryRange } from '../api/types'
import { HistoryChart } from '../components/HistoryChart'
import { formatBytes } from '../lib/format'
import { tr } from '../lib/i18n'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

const RANGES: { id: HistoryRange; label: string }[] = [
  { id: '1h', label: tr('1 hour') },
  { id: '24h', label: tr('24 hours') },
  { id: '7d', label: tr('7 days') },
  { id: '30d', label: tr('30 days') },
]

const pct = (v: number) => `${Math.round(v)}%`
const speed = (v: number) => `${formatBytes(v, v < 1e6 ? 0 : 1)}/s`
const deg = (v: number) => `${Math.round(v)}°C`
const watts = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} W`

function stats(points: (HistoryPoint | null)[], key: keyof HistoryPoint, peakKey: keyof HistoryPoint = key) {
  const real = points.filter((p): p is HistoryPoint => !!p)
  if (!real.length) return null
  const avg = real.reduce((s, p) => s + p[key], 0) / real.length
  const top = real.reduce((best, p) => (p[peakKey] > best[peakKey] ? p : best), real[0])
  return { avg, peak: top[peakKey], at: top.t }
}

/** System Monitor → History: the last hour to 30 days of CPU, memory, temperature, network and disk. */
export function HistoryView({ tabs }: { tabs: ReactNode }) {
  const [range, setRange] = useState<HistoryRange>('24h')
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      api.history(range).then(
        d => alive && (setData(d), setError(null)),
        e => alive && setError(e instanceof Error ? e.message : String(e)),
      )
    void load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [range])

  const points = data?.points ?? []
  const long = range === '7d' || range === '30d'
  const at = (t: number) =>
    new Date(t * 1000).toLocaleString([], long ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
  const sum = (key: keyof HistoryPoint, f: (v: number) => string, peakKey?: keyof HistoryPoint) => {
    const s = stats(points, key, peakKey)
    return s ? tr('Average {0} · peak {1} at {2}', f(s.avg), f(s.peak), at(s.at)) : undefined
  }
  const has = (key: keyof HistoryPoint) => points.some(p => p && p[key] > 0)
  const recordedFor = data?.since ? (Date.now() / 1000 - data.since) / 3600 : 0

  return (
    <div className="am">
      <WindowToolbar>
        <span className="hv-side">
          <ToolbarTitle title={tr('System Monitor')} subtitle={tr('History')} />
        </span>
        {tabs}
        <span className="hv-side is-end" />
      </WindowToolbar>
      <div className="hv">
        {/* The time range, in one row above the charts it filters. */}
        <div className="hv-bar">
          <p className="hv-note">
            {data && recordedFor < 2
              ? tr('History is recorded from now on, a point a minute, and kept for 30 days. Check back in a while.')
              : tr('A point a minute, kept for 30 days.')}
          </p>
          <div className="segmented hv-range" role="radiogroup" aria-label={tr('Time range')}>
            {RANGES.map(r => (
              <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? 'is-active' : ''} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        {data && (
          <div className="hv-grid">
            <HistoryChart
              title={tr('CPU')}
              points={points}
              series={[{ key: 'cpu', label: tr('CPU'), slot: 1 }]}
              format={pct}
              max={100}
              long={long}
              summary={sum('cpu', pct, 'cpuMax')}
              detail={p => tr('Busiest moment {0}', pct(p.cpuMax))}
            />
            <HistoryChart title={tr('Memory')} points={points} series={[{ key: 'mem', label: tr('Memory'), slot: 1 }]} format={pct} max={100} long={long} summary={sum('mem', pct)} />
            {has('temp') && (
              <HistoryChart title={tr('Temperature')} points={points} series={[{ key: 'temp', label: tr('CPU temperature'), slot: 1 }]} format={deg} long={long} summary={sum('temp', deg)} />
            )}
            <HistoryChart
              title={tr('Network')}
              points={points}
              series={[
                { key: 'rx', label: tr('Download'), slot: 1 },
                { key: 'tx', label: tr('Upload'), slot: 2 },
              ]}
              format={speed}
              bytes
              long={long}
            />
            <HistoryChart
              title={tr('Disk')}
              points={points}
              series={[
                { key: 'read', label: tr('Read'), slot: 1 },
                { key: 'write', label: tr('Write'), slot: 2 },
              ]}
              format={speed}
              bytes
              long={long}
            />
            {has('watts') && (
              <HistoryChart title={tr('Power')} points={points} series={[{ key: 'watts', label: tr('Power draw'), slot: 1 }]} format={watts} long={long} summary={sum('watts', watts)} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
