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

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]
const SLIDESHOW_MS = 4000

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

  const go = (step: number) => list.length > 1 && setIndex(i => (i + step + list.length) % list.length)

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
      label: 'View',
      items: [
        { label: 'Zoom In', icon: ZoomIn, onSelect: () => step(1) },
        { label: 'Zoom Out', icon: ZoomOut, onSelect: () => step(-1) },
        { label: 'Actual Size', checked: zoom === 1, onSelect: () => setZoom(1) },
        { label: 'Zoom to Fit', icon: Maximize, checked: zoom === null, onSelect: () => setZoom(null) },
        'separator',
        { label: playing ? 'Stop Slideshow' : 'Slideshow', icon: playing ? Pause : Play, onSelect: () => setPlaying(p => !p) },
      ],
    },
    {
      label: 'Go',
      items: [
        { label: 'Previous Image', icon: ChevronLeft, disabled: list.length < 2, onSelect: () => go(-1) },
        { label: 'Next Image', icon: ChevronRight, disabled: list.length < 2, onSelect: () => go(1) },
      ],
    },
    {
      label: 'Image',
      items: [
        { label: 'Rotate Right', icon: RotateCw, onSelect: () => setRotation(r => r + 90) },
        'separator',
        { label: 'Set as Wallpaper', icon: ImageIcon, disabled: !current, onSelect: () => void setAsWallpaper() },
        { label: 'Download', icon: Download, disabled: !current, onSelect: download },
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
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current
    if (!el || zoom === null) return
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current
    if (!el || !pan.current) return
    el.scrollLeft = pan.current.left - (e.clientX - pan.current.x)
    el.scrollTop = pan.current.top - (e.clientY - pan.current.y)
  }

  if (!current) {
    return (
      <div className="media-empty">
        <ImageIcon size={40} />
        <p>Open a photo from Files to view it here.</p>
      </div>
    )
  }

  return (
    <div className="pv">
      <WindowToolbar>
        <div className="tb-group">
        <button className="tb-btn" onClick={() => go(-1)} disabled={list.length < 2} aria-label="Previous">
          <ChevronLeft size={16} />
        </button>
        <button className="tb-btn" onClick={() => go(1)} disabled={list.length < 2} aria-label="Next">
          <ChevronRight size={16} />
        </button>
        </div>
        <ToolbarTitle title={nameOf(current)} subtitle={list.length > 1 ? `${index + 1} of ${list.length}` : undefined} />
        <span className="tb-spacer" />
        <div className="tb-group">
        <button className="tb-btn" onClick={() => step(-1)} aria-label="Zoom out">
          <ZoomOut size={15} />
        </button>
        <button className="tb-btn tb-text" onClick={() => setZoom(z => (z === null ? 1 : null))} title="Toggle actual size / fit">
          {zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}
        </button>
        <button className="tb-btn" onClick={() => step(1)} aria-label="Zoom in">
          <ZoomIn size={15} />
        </button>
        <button className="tb-btn" onClick={() => setRotation(r => r + 90)} aria-label="Rotate">
          <RotateCw size={15} />
        </button>
        <button className={`icon-btn ${playing ? 'is-on' : ''}`} onClick={() => setPlaying(p => !p)} aria-label="Slideshow" title="Slideshow">
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className="tb-btn" onClick={() => void setAsWallpaper()} aria-label="Set as wallpaper" title="Set as Wallpaper">
          <ImageIcon size={15} />
        </button>
        <button className="tb-btn" onClick={download} aria-label="Download" title="Download">
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
        onPointerUp={() => (pan.current = null)}
        onDoubleClick={() => setZoom(z => (z === null ? 1 : null))}
      >
        {broken ? (
          <div className="media-empty">
            <ImageIcon size={40} />
            <p>This browser can’t display {nameOf(current)}.</p>
            <button className="btn" onClick={download}>
              <Download size={13} /> Download
            </button>
          </div>
        ) : (
          <img
            key={current}
            className="pv-image"
            src={api.rawFileUrl(current)}
            alt={nameOf(current)}
            draggable={false}
            onError={() => setBroken(true)}
            style={{
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
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
