import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { HistoryPoint } from '../api/types'
import { tr } from '../lib/i18n'

export interface ChartSeries {
  key: keyof HistoryPoint
  label: string
  /** A categorical slot: 1 (blue) or 2 (orange), see .hc in app.css. */
  slot: 1 | 2
}

interface Props {
  title: string
  points: (HistoryPoint | null)[]
  series: ChartSeries[]
  format: (v: number) => string
  /** A fixed top (100 for percentages); else the data's peak, rounded up. */
  max?: number
  /** Sizes (bytes a second): the top rounds in steps of 1024, as the labels count. */
  bytes?: boolean
  /** Time labels: clock times for a day or less, dates beyond. */
  long: boolean
  /** A line under the title: average and peak, or the like. */
  summary?: string
  /** Extra lines in the tooltip for one point (CPU's peak). */
  detail?: (p: HistoryPoint) => string | null
}

const H = 150
const PAD = { top: 10, right: 10, bottom: 22, left: 52 }

/** Rounds a top value up to 1, 2 or 5 times a power of ten, so the axis reads well. */
function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}

/** niceMax for sizes: 1, 2, 5, 10… KB, MB or GB. */
function niceBytes(v: number) {
  if (v <= 0) return 1024
  const unit = 1024 ** Math.max(0, Math.floor(Math.log(v) / Math.log(1024)))
  return niceMax(v / unit) * unit
}

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (t: number) => new Date(t * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })
const when = (t: number, long: boolean) =>
  long ? new Date(t * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : clock(t)

/**
 * A line chart of one or two measures over time: one axis, thin lines, a light fill under a
 * single line, gaps where the server was off, and a crosshair with the values under the pointer.
 */
export function HistoryChart({ title, points, series, format, max, bytes, long, summary, detail }: Props) {
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

  const n = points.length
  const peak = Math.max(0, ...points.flatMap(p => (p ? series.map(s => p[s.key]) : [])))
  const top = max ?? (bytes ? niceBytes(peak * 1.1) : niceMax(peak * 1.1))
  const plotW = width - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (Math.min(v, top) / top) * plotH

  // A path per series, broken where points are missing.
  const paths = series.map(s => {
    let line = ''
    let area = ''
    let run: [number, number][] = []
    const flush = () => {
      if (!run.length) return
      line += run.map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
      area += `M${run[0][0].toFixed(1)},${y(0)}` + run.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('') + `L${run[run.length - 1][0].toFixed(1)},${y(0)}Z`
      run = []
    }
    points.forEach((p, i) => {
      if (p) run.push([x(i), y(p[s.key])])
      else flush()
    })
    flush()
    return { s, line, area }
  })

  const ticks = [0, top / 2, top]
  const labelEvery = Math.max(1, Math.round(n / Math.max(2, Math.floor(plotW / 90))))
  const xLabels = points
    .map((p, i) => ({ i, t: p?.t }))
    .filter(({ i }) => i % labelEvery === 0 && i > 0 && i < n - 1)
  const tStart = points.find(p => p)?.t
  const stepT = n > 1 && points[0] && points[1] ? points[1].t - points[0].t : 0

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * width
    const i = Math.round(((px - PAD.left) / plotW) * (n - 1))
    setHover(i >= 0 && i < n ? i : null)
  }
  const hp = hover !== null ? points[hover] : null
  // The time under the pointer, even in a gap.
  const hoverT = hover !== null ? (points[hover]?.t ?? (tStart !== undefined ? tStart + (hover - points.findIndex(p => p)) * stepT : undefined)) : undefined

  return (
    <figure className="hc">
      <figcaption>
        <strong>{title}</strong>
        {summary && <small>{summary}</small>}
        {series.length > 1 && (
          <span className="hc-legend">
            {series.map(s => (
              <span key={s.key}>
                <i className={`hc-swatch is-${s.slot}`} /> {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div className="hc-plot" ref={box}>
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={title}>
          {ticks.map(t => (
            <g key={t}>
              <line className="hc-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="hc-axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {xLabels.map(({ i, t }) =>
            t ? (
              <text key={i} className="hc-axis" x={x(i)} y={H - 6} textAnchor="middle">
                {long ? day(t) : clock(t)}
              </text>
            ) : null,
          )}
          {paths.map(({ s, area }) => (series.length === 1 ? <path key={`a${s.key}`} className={`hc-area is-${s.slot}`} d={area} /> : null))}
          {paths.map(({ s, line }) => (
            <path key={s.key} className={`hc-line is-${s.slot}`} d={line} />
          ))}
          {hover !== null && (
            <g>
              <line className="hc-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
              {hp && series.map(s => <circle key={s.key} className={`hc-dot is-${s.slot}`} cx={x(hover)} cy={y(hp[s.key])} r={4} />)}
            </g>
          )}
          {/* The whole plot answers the pointer, not just the thin line. */}
          <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" />
        </svg>
        {hover !== null && hoverT !== undefined && (
          <div className={`hc-tip ${x(hover) > width / 2 ? 'is-left' : ''}`} style={{ left: x(hover) }}>
            <span className="hc-tip-time">{when(hoverT, long)}</span>
            {hp ? (
              <>
                {series.map(s => (
                  <span key={s.key} className="hc-tip-row">
                    <i className={`hc-swatch is-${s.slot}`} /> {s.label} <b>{format(hp[s.key])}</b>
                  </span>
                ))}
                {detail?.(hp) && <span className="hc-tip-row is-dim">{detail(hp)}</span>}
              </>
            ) : (
              <span className="hc-tip-row is-dim">{tr('The server was off')}</span>
            )}
          </div>
        )}
      </div>
    </figure>
  )
}
