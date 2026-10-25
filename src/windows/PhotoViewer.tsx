import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Maximize,
  Pause,
  Play,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { api } from '../api'
import { useAppMenus } from '../lib/appMenus'
import { siblingsOf, folderOf, type MediaRequest } from '../lib/media'
import { nameOf } from '../lib/paths'
import { useSettings } from '../lib/settings'
import { ToolbarTitle, useWindowKeys, WindowToolbar } from '../lib/windowChrome'
import { tr } from '../lib/i18n'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]
const SLIDESHOW_MS = 4000
// Touch: a swipe this far (or this fast, in px per ms) goes to the next photo; a double tap
// zooms to this many times the fitted size.
const SWIPE_PX = 60
const SWIPE_FLICK = 0.45
const TAP_ZOOM = 2.5
const DOUBLE_TAP_MS = 300

interface Props {
  request: MediaRequest | null
  onTitle: (title: string) => void
}

/** Preview: photos with zoom, rotate, a filmstrip of the folder and a slideshow. */
export function PhotoViewer({ request, onTitle }: Props) {
  const { update } = useSettings()
  const [list, setList] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  // null = fit to window.
  const [zoom, setZoom] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [broken, setBroken] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  // App re-renders often (live stats); keep the latest callback without re-running effects.
  const titleRef = useRef(onTitle)
  titleRef.current = onTitle

  useEffect(() => {
    if (!request) return
    let alive = true
    setList([request.path])
    setIndex(0)
    siblingsOf(folderOf(request.path), 'image').then(
      files => {
        if (!alive) return
        const all = files.includes(request.path) ? files : [request.path, ...files]
        setList(all)
        setIndex(all.indexOf(request.path))
      },
      () => {},
    )
    stage.current?.focus()
    return () => {
      alive = false
    }
  }, [request])

  const current = list[index] ?? null
  useEffect(() => {
    setZoom(null)
    setRotation(0)
    setBroken(false)
    if (current) titleRef.current(nameOf(current))
    strip.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [current])

  // Which way the new photo slides in.
  const [enter, setEnter] = useState<'next' | 'prev' | null>(null)
  const go = (step: number) => {
    if (list.length < 2) return
    setEnter(step > 0 ? 'next' : 'prev')
    setIndex(i => (i + step + list.length) % list.length)
  }

  const count = list.length
  useEffect(() => {
    if (!playing || count < 2) return
    const timer = setInterval(() => setIndex(i => (i + 1) % count), SLIDESHOW_MS)
    return () => clearInterval(timer)
  }, [playing, count])

  const step = (dir: 1 | -1) =>
    setZoom(z => {
      const now = z ?? 1
      const next = dir > 0 ? ZOOM_STEPS.find(s => s > now + 0.01) : [...ZOOM_STEPS].reverse().find(s => s < now - 0.01)
      return next ?? now
    })

  const setAsWallpaper = async () => {
    if (current) update({ customWallpaper: (await api.wallpaperFromFile(current)).url })
  }
  const download = () => current && window.open(api.rawFileUrl(current, true), '_blank')

  useAppMenus(() => [
    {
      label: tr('View'),
      items: [
        { label: tr('Zoom In'), icon: ZoomIn, onSelect: () => step(1) },
        { label: tr('Zoom Out'), icon: ZoomOut, onSelect: () => step(-1) },
        { label: tr('Actual Size'), checked: zoom === 1, onSelect: () => setZoom(1) },
        { label: tr('Zoom to Fit'), icon: Maximize, checked: zoom === null, onSelect: () => setZoom(null) },
        'separator',
        { label: playing ? tr('Stop Slideshow') : tr('Slideshow'), icon: playing ? Pause : Play, onSelect: () => setPlaying(p => !p) },
      ],
    },
    {
      label: tr('Go'),
      items: [
        { label: tr('Previous Image'), icon: ChevronLeft, disabled: list.length < 2, onSelect: () => go(-1) },
        { label: tr('Next Image'), icon: ChevronRight, disabled: list.length < 2, onSelect: () => go(1) },
      ],
    },
    {
      label: tr('Image'),
      items: [
        { label: tr('Rotate Right'), icon: RotateCw, onSelect: () => setRotation(r => r + 90) },
        'separator',
        { label: tr('Set as Wallpaper'), icon: ImageIcon, disabled: !current, onSelect: () => void setAsWallpaper() },
        { label: tr('Download'), icon: Download, disabled: !current, onSelect: download },
      ],
    },
  ])

  // Arrows browse the folder whenever the viewer is in front.
  useWindowKeys(e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') go(1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1)
    else if (e.key === '+' || e.key === '=') step(1)
    else if (e.key === '-') step(-1)
    else if (e.key === '0') setZoom(null)
    else return false
    return true
  })

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    step(e.deltaY < 0 ? 1 : -1)
  }
  // ----- Touch, like a phone's gallery: swipe to the next photo, pinch or double tap to zoom -----
  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const swipe = useRef<{ x: number; y: number; at: number; axis: 'x' | 'y' | null } | null>(null)
  const pinch = useRef<{ dist: number; zoom: number; fit: number } | null>(null)
  // Where this touch began, and whether a second finger joined it (then it's no tap or swipe).
  const gesture = useRef<{ x: number; y: number; multi: boolean } | null>(null)
  const lastTap = useRef(0)
  const touchedAt = useRef(0)
  const [dragX, setDragX] = useState(0)
  // The scale the photo is drawn at when it fits the stage.
  const fitScale = () => {
    const img = stage.current?.querySelector<HTMLImageElement>('.pv-image')
    const el = stage.current
    if (!img?.naturalWidth || !el) return 1
    return Math.min(1, el.clientWidth / img.naturalWidth, el.clientHeight / img.naturalHeight)
  }
  const spread = () => {
    const [a, b] = [...fingers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current
    if (!el) return
    if (e.pointerType === 'touch') {
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      e.currentTarget.setPointerCapture(e.pointerId)
      if (fingers.current.size === 1) gesture.current = { x: e.clientX, y: e.clientY, multi: false }
      else if (gesture.current) gesture.current.multi = true
      if (fingers.current.size === 2) {
        const fit = fitScale()
        swipe.current = null
        pan.current = null
        setDragX(0)
        pinch.current = { dist: spread() || 1, zoom: zoom ?? fit, fit }
        return
      }
      if (zoom === null) {
        swipe.current = { x: e.clientX, y: e.clientY, at: performance.now(), axis: null }
        return
      }
    }
    if (zoom === null) return
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current
    if (!el) return
    if (e.pointerType === 'touch' && fingers.current.has(e.pointerId)) {
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const p = pinch.current
      if (p && fingers.current.size >= 2) {
        const z = (p.zoom * spread()) / p.dist
        setZoom(z <= p.fit * 1.02 ? null : Math.min(ZOOM_STEPS.at(-1)!, z))
        return
      }
      const s = swipe.current
      if (s) {
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (s.axis === 'x' && list.length > 1) setDragX(dx)
        return
      }
    }
    if (!pan.current) return
    el.scrollLeft = pan.current.left - (e.clientX - pan.current.x)
    el.scrollTop = pan.current.top - (e.clientY - pan.current.y)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    pan.current = null
    if (e.pointerType !== 'touch') return
    // The browser's own double click after a double tap is left to the tap code above.
    touchedAt.current = performance.now()
    fingers.current.delete(e.pointerId)
    if (fingers.current.size < 2) pinch.current = null
    const g = gesture.current
    if (fingers.current.size === 0) gesture.current = null
    const s = swipe.current
    swipe.current = null
    setDragX(0)
    if (cancelled || !g || g.multi) return
    if (s?.axis === 'x') {
      const dx = e.clientX - s.x
      const speed = Math.abs(dx) / Math.max(1, performance.now() - s.at)
      if (Math.abs(dx) > SWIPE_PX || speed > SWIPE_FLICK) go(dx < 0 ? 1 : -1)
      return
    }
    if (s?.axis === 'y' || Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) return
    // A double tap zooms in on the photo, or back out to fit.
    const now = performance.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      setZoom(z => (z === null ? Math.min(ZOOM_STEPS.at(-1)!, fitScale() * TAP_ZOOM) : null))
    } else lastTap.current = now
  }

  if (!current) {
    return (
      <div className="media-empty">
        <ImageIcon size={40} />
        <p>{tr('Open a photo from Files to view it here.')}</p>
      </div>
    )
  }

  return (
    <div className="pv">
      <WindowToolbar>
        <div className="tb-group">
        <button className="tb-btn" onClick={() => go(-1)} disabled={list.length < 2} aria-label={tr('Previous')}>
          <ChevronLeft size={16} />
        </button>
        <button className="tb-btn" onClick={() => go(1)} disabled={list.length < 2} aria-label={tr('Next')}>
          <ChevronRight size={16} />
        </button>
        </div>
        <ToolbarTitle title={nameOf(current)} subtitle={list.length > 1 ? tr('{0} of {1}', index + 1, list.length) : undefined} />
        <span className="tb-spacer" />
        <div className="tb-group">
        {/* Zoom and wallpaper are the desktop's; a phone pinches, and has no wallpaper here. */}
        <button className="tb-btn pv-desk" onClick={() => step(-1)} aria-label={tr('Zoom out')}>
          <ZoomOut size={15} />
        </button>
        <button className="tb-btn tb-text pv-desk" onClick={() => setZoom(z => (z === null ? 1 : null))} title={tr('Toggle actual size / fit')}>
          {zoom === null ? tr('Fit') : `${Math.round(zoom * 100)}%`}
        </button>
        <button className="tb-btn pv-desk" onClick={() => step(1)} aria-label={tr('Zoom in')}>
          <ZoomIn size={15} />
        </button>
        <button className="tb-btn" onClick={() => setRotation(r => r + 90)} aria-label={tr('Rotate')}>
          <RotateCw size={15} />
        </button>
        <button className={`icon-btn ${playing ? 'is-on' : ''}`} onClick={() => setPlaying(p => !p)} aria-label={tr('Slideshow')} title={tr('Slideshow')}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className="tb-btn pv-desk" onClick={() => void setAsWallpaper()} aria-label={tr('Set as wallpaper')} title={tr('Set as Wallpaper')}>
          <ImageIcon size={15} />
        </button>
        <button className="tb-btn" onClick={download} aria-label={tr('Download')} title={tr('Download')}>
          <Download size={15} />
        </button>
        </div>
      </WindowToolbar>

      <div
        ref={stage}
        tabIndex={0}
        className={`pv-stage ${zoom === null ? 'is-fit' : 'is-zoomed'}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => onPointerUp(e)}
        onPointerCancel={e => onPointerUp(e, true)}
        onDoubleClick={() => performance.now() - touchedAt.current > 800 && setZoom(z => (z === null ? 1 : null))}
      >
        {broken ? (
          <div className="media-empty">
            <ImageIcon size={40} />
            <p>{tr('This browser can’t display')} {nameOf(current)}.</p>
            <button className="btn" onClick={download}>
              <Download size={13} /> {tr('Download')}
            </button>
          </div>
        ) : (
          <img
            key={current}
            className={`pv-image ${dragX ? 'is-dragging' : ''} ${enter ? `is-enter-${enter}` : ''}`}
            src={api.rawFileUrl(current)}
            alt={nameOf(current)}
            draggable={false}
            onError={() => setBroken(true)}
            style={{
              transform: [dragX ? `translateX(${dragX}px)` : '', rotation ? `rotate(${rotation}deg)` : ''].join(' ').trim() || undefined,
              ...(zoom === null ? null : { maxWidth: 'none', maxHeight: 'none', zoom }),
            }}
          />
        )}
      </div>

      {list.length > 1 && (
        <div className="pv-strip" ref={strip}>
          {list.map((path, i) => (
            <button key={path} className={i === index ? 'is-current' : ''} onClick={() => setIndex(i)} title={nameOf(path)}>
              <img src={api.thumbUrl(path, '') ?? api.rawFileUrl(path)} alt="" loading="lazy" decoding="async" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
