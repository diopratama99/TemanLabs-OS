import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Film, PictureInPicture2, Repeat } from 'lucide-react'
import { api } from '../api'
import { useAppMenus } from '../lib/appMenus'
import { folderOf, siblingsOf, type MediaRequest } from '../lib/media'
import { nameOf } from '../lib/paths'
import { useWindowKeys } from '../lib/windowChrome'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SKIP_SECONDS = 5
const VOLUME_STEP = 0.1
const FLASH_MS = 700

interface Props {
  request: MediaRequest | null
  onTitle: (title: string) => void
}

/** Video player for files on the server, with the folder as a playlist. */
export function VideoPlayer({ request, onTitle }: Props) {
  const [list, setList] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)
  const [error, setError] = useState(false)
  // What the last key did ("+5s", "Volume 60%"), shown briefly over the video.
  const [flash, setFlash] = useState<{ text: string; n: number } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const titleRef = useRef(onTitle)
  titleRef.current = onTitle

  useEffect(() => {
    if (!request) return
    let alive = true
    setList([request.path])
    setIndex(0)
    siblingsOf(folderOf(request.path), 'video').then(
      files => {
        if (!alive) return
        const all = files.includes(request.path) ? files : [request.path, ...files]
        setList(all)
        setIndex(all.indexOf(request.path))
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [request])

  const current = list[index] ?? null
  useEffect(() => {
    setError(false)
    if (current) titleRef.current(nameOf(current))
  }, [current])

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed
  }, [speed, current])

  const go = (step: number) => list.length > 1 && setIndex(i => (i + step + list.length) % list.length)
  const download = () => current && window.open(api.rawFileUrl(current, true), '_blank')
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])
  const show = (text: string) => setFlash(f => ({ text, n: (f?.n ?? 0) + 1 }))

  // Keys work whenever the player is in front, like QuickTime and YouTube.
  useWindowKeys(e => {
    const v = video.current
    if (!v) return false
    switch (e.key) {
      case 'ArrowRight':
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + SKIP_SECONDS)
        show(`+${SKIP_SECONDS}s`)
        return true
      case 'ArrowLeft':
        v.currentTime = Math.max(0, v.currentTime - SKIP_SECONDS)
        show(`−${SKIP_SECONDS}s`)
        return true
      case ' ':
      case 'k':
        if (v.paused) void v.play()
        else v.pause()
        show(v.paused ? 'Paused' : 'Play')
        return true
      case 'ArrowUp':
      case 'ArrowDown':
        v.muted = false
        v.volume = Math.min(1, Math.max(0, v.volume + (e.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP)))
        show(`Volume ${Math.round(v.volume * 100)}%`)
        return true
      case 'm':
        v.muted = !v.muted
        show(v.muted ? 'Muted' : 'Sound on')
        return true
      case 'f':
        if (document.fullscreenElement) void document.exitFullscreen()
        else void v.requestFullscreen?.()
        return true
    }
    return false
  })

  const pip = () => {
    const v = video.current
    if (!v) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void v.requestPictureInPicture?.()
  }

  useAppMenus(() => [
    {
      label: 'Playback',
      items: [
        { label: 'Previous Video', icon: ChevronLeft, disabled: list.length < 2, onSelect: () => go(-1) },
        { label: 'Next Video', icon: ChevronRight, disabled: list.length < 2, onSelect: () => go(1) },
        'separator',
        ...SPEEDS.map(s => ({ label: `${s}×`, checked: speed === s, onSelect: () => setSpeed(s) })),
        'separator',
        { label: 'Loop', icon: Repeat, checked: loop, onSelect: () => setLoop(l => !l) },
        { label: 'Picture in Picture', icon: PictureInPicture2, disabled: !document.pictureInPictureEnabled, onSelect: pip },
      ],
    },
    { label: 'File', items: [{ label: 'Download', icon: Download, disabled: !current, onSelect: download }] },
  ])

  if (!current) {
    return (
      <div className="media-empty is-dark">
        <Film size={40} />
        <p>Open a video from Files to play it here.</p>
      </div>
    )
  }

  return (
    <div className="vp">
      <div className="vp-stage">
        {flash && (
          <div className="vp-flash" key={flash.n}>
            {flash.text}
          </div>
        )}
        {error ? (
          <div className="media-empty is-dark">
            <Film size={40} />
            <p>
              This browser can’t play {nameOf(current)}.
              <br />
              <small>MP4 (H.264) and WebM play everywhere; MKV and AVI often need VLC.</small>
            </p>
            <button className="btn" onClick={download}>
              <Download size={13} /> Download
            </button>
          </div>
        ) : (
          <video
            key={current}
            ref={video}
            src={api.rawFileUrl(current)}
            controls
            autoPlay
            playsInline
            loop={loop}
            onError={() => setError(true)}
            onEnded={() => !loop && index < list.length - 1 && go(1)}
          />
        )}
      </div>
      <div className="media-toolbar is-dark">
        <button className="icon-btn" onClick={() => go(-1)} disabled={list.length < 2} aria-label="Previous video">
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn" onClick={() => go(1)} disabled={list.length < 2} aria-label="Next video">
          <ChevronRight size={16} />
        </button>
        <span className="media-count">
          {index + 1} of {list.length}
        </span>
        <span className="media-spacer" />
        <select className="media-speed" value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="Playback speed">
          {SPEEDS.map(s => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button className={`icon-btn ${loop ? 'is-on' : ''}`} onClick={() => setLoop(l => !l)} aria-label="Loop" title="Loop">
          <Repeat size={15} />
        </button>
        {document.pictureInPictureEnabled && (
          <button className="icon-btn" onClick={pip} aria-label="Picture in picture" title="Picture in Picture">
            <PictureInPicture2 size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={download} aria-label="Download" title="Download">
          <Download size={15} />
        </button>
      </div>
    </div>
  )
}
