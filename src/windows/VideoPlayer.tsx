import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowRightLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { api } from '../api'
import { useAppMenus } from '../lib/appMenus'
import { folderOf, formatTime, siblingsOf, type MediaRequest } from '../lib/media'
import { nameOf } from '../lib/paths'
import { useWindowKeys } from '../lib/windowChrome'
import { tr } from '../lib/i18n'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SKIP_SECONDS = 5
// The ⟲10 / 10⟳ buttons (and J / L).
const JUMP_SECONDS = 10
// Resuming: not for the first seconds, and a video watched to its last bit counts as finished.
const RESUME_MIN = 15
const RESUME_TAIL = 20
const SAVE_MS = 10_000
const RESUMED_NOTE_MS = 7000
const VOLUME_STEP = 0.1
const FLASH_MS = 700
// The controls fade out this long after the pointer stops moving over a playing video.
const HIDE_MS = 2500
// The backdrop is a tiny copy of the frame, blurred by CSS; a few updates a second are plenty.
const BACKDROP_W = 48
const BACKDROP_MS = 120

interface Props {
  request: MediaRequest | null
  onTitle: (title: string) => void
  /** Opens the file in Remux (for formats the browser can't play, like MKV or TS). */
  onConvert?: (path: string) => void
}

/** Video player for files on the server, with the folder as a playlist. */
export function VideoPlayer({ request, onTitle, onConvert }: Props) {
  const [list, setList] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)
  const [error, setError] = useState(false)
  // What the last key did ("+5s", "Volume 60%"), shown briefly over the video.
  const [flash, setFlash] = useState<{ text: string; n: number } | null>(null)
  // Mirrors of the video element's state, for the controls.
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // Controls: hidden while playing once the pointer rests, never while it's on them or seeking.
  const [idle, setIdle] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const [hover, setHover] = useState<{ at: number; x: number } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const hud = useRef<HTMLDivElement>(null)
  const backdrop = useRef<HTMLCanvasElement>(null)
  const idleTimer = useRef(0)
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
    setTime(0)
    setDuration(0)
    setBuffered(0)
    if (current) titleRef.current(nameOf(current))
  }, [current])

  // ----- Continue where you left off -----
  // Where each video was left is kept on the server, so it follows you to other devices.
  // lastAt is the last known spot of the video on screen, saved when it's left.
  const [resumed, setResumed] = useState<number | null>(null)
  const resumeAt = useRef<number | null>(null)
  const lastAt = useRef<{ path: string; at: number; duration: number } | null>(null)
  const savePoint = (p: { path: string; at: number; duration: number } | null, forget = false) => {
    if (!p || !p.duration || !Number.isFinite(p.duration)) return
    const finished = p.at > p.duration - RESUME_TAIL || p.at / p.duration > 0.95
    // A video only just started isn't worth a resume point (and must not wipe the old one).
    if (!forget && !finished && p.at < RESUME_MIN) return
    void api.saveMediaPosition(p.path, forget || finished ? 0 : p.at, p.duration).catch(() => {})
  }
  const jumpTo = (at: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = at
    setTime(at)
  }
  useEffect(() => {
    resumeAt.current = null
    setResumed(null)
    if (!current) return
    let alive = true
    api.mediaPosition(current).then(
      p => {
        if (!alive || p.position < RESUME_MIN || (p.duration && p.position > p.duration - RESUME_TAIL)) return
        if ((video.current?.readyState ?? 0) >= 1) {
          jumpTo(p.position)
          setResumed(p.position)
        } else resumeAt.current = p.position
      },
      () => {},
    )
    return () => {
      alive = false
      savePoint(lastAt.current)
      lastAt.current = null
    }
  }, [current])
  // Saved every few seconds while playing, and when the tab is hidden or closed.
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => savePoint(lastAt.current), SAVE_MS)
    return () => clearInterval(timer)
  }, [playing])
  useEffect(() => {
    const away = () => document.visibilityState === 'hidden' && savePoint(lastAt.current)
    const leave = () => savePoint(lastAt.current)
    document.addEventListener('visibilitychange', away)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', away)
      window.removeEventListener('pagehide', leave)
    }
  }, [])
  useEffect(() => {
    if (resumed === null) return
    const timer = setTimeout(() => setResumed(null), RESUMED_NOTE_MS)
    return () => clearTimeout(timer)
  }, [resumed])
  const startOver = () => {
    jumpTo(0)
    setResumed(null)
    if (current) savePoint({ path: current, at: 0, duration: duration || 1 }, true)
  }

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed
  }, [speed, current])

  // Smooth progress while playing (timeupdate only fires a few times a second).
  useEffect(() => {
    if (!playing || seeking) return
    let frame = 0
    const tick = () => {
      if (video.current) setTime(video.current.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, seeking])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => () => clearTimeout(idleTimer.current), [])
  // Asks the browser whether the pointer is on the bar rather than tracking enter/leave:
  // React misses the leave when the button under the pointer swaps its icon (play ↔ pause).
  const armIdle = () => {
    clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => (hud.current?.matches(':hover') ? armIdle() : setIdle(true)), HIDE_MS)
  }
  const wake = () => {
    setIdle(false)
    armIdle()
  }
  const shown = !playing || !idle || seeking || error

  // Ambient backdrop: the bars beside a portrait (or wide) video glow with its own colours
  // instead of staying black.
  useEffect(() => {
    const v = video.current
    const ctx = backdrop.current?.getContext('2d')
    if (!v || !ctx) return
    let frame = 0
    let last = 0
    let drawnAt = -1
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (now - last < BACKDROP_MS || v.readyState < 2 || !v.videoWidth || v.currentTime === drawnAt) return
      last = now
      drawnAt = v.currentTime
      const canvas = ctx.canvas
      const h = Math.max(1, Math.round((BACKDROP_W * v.videoHeight) / v.videoWidth))
      if (canvas.width !== BACKDROP_W || canvas.height !== h) {
        canvas.width = BACKDROP_W
        canvas.height = h
      }
      ctx.drawImage(v, 0, 0, BACKDROP_W, h)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [current, error])

  const go = (step: number) => list.length > 1 && setIndex(i => (i + step + list.length) % list.length)
  const download = () => current && window.open(api.rawFileUrl(current, true), '_blank')
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])
  const show = (text: string) => setFlash(f => ({ text, n: (f?.n ?? 0) + 1 }))

  const jump = (seconds: number) => {
    const v = video.current
    if (!v) return
    jumpTo(Math.min(v.duration || Infinity, Math.max(0, v.currentTime + seconds)))
    show(seconds > 0 ? `+${seconds}s` : `−${-seconds}s`)
  }

  const togglePlay = () => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.current?.requestFullscreen?.()
  }
  const setLevel = (level: number) => {
    const v = video.current
    if (!v) return
    v.volume = Math.min(1, Math.max(0, level))
    v.muted = v.volume === 0
  }
  const toggleMute = () => {
    const v = video.current
    if (!v) return
    if (v.muted && v.volume === 0) v.volume = 0.5
    v.muted = !v.muted
  }

  // Keys work whenever the player is in front, like QuickTime and YouTube.
  useWindowKeys(e => {
    const v = video.current
    if (!v) return false
    wake()
    switch (e.key) {
      case 'ArrowRight':
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + SKIP_SECONDS)
        setTime(v.currentTime)
        show(`+${SKIP_SECONDS}s`)
        return true
      case 'ArrowLeft':
        v.currentTime = Math.max(0, v.currentTime - SKIP_SECONDS)
        setTime(v.currentTime)
        show(`−${SKIP_SECONDS}s`)
        return true
      case 'j':
        jump(-JUMP_SECONDS)
        return true
      case 'l':
        jump(JUMP_SECONDS)
        return true
      case ' ':
      case 'k':
        togglePlay()
        show(v.paused ? tr('Paused') : tr('Play'))
        return true
      case 'ArrowUp':
      case 'ArrowDown':
        v.muted = false
        v.volume = Math.min(1, Math.max(0, v.volume + (e.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP)))
        show(`${tr('Volume')} ${Math.round(v.volume * 100)}%`)
        return true
      case 'm':
        v.muted = !v.muted
        show(v.muted ? tr('Muted') : tr('Sound on'))
        return true
      case 'f':
        toggleFullscreen()
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

  // Seek bar: click or drag to seek; hovering shows the time under the pointer.
  const fraction = (e: ReactPointerEvent) => {
    const r = track.current!.getBoundingClientRect()
    return { f: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), x: e.clientX - r.left }
  }
  const seekTo = (e: ReactPointerEvent) => {
    const v = video.current
    if (!v || !duration) return
    const { f } = fraction(e)
    v.currentTime = f * duration
    setTime(f * duration)
  }
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setSeeking(true)
    seekTo(e)
  }
  const onTrackMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return
    const { f, x } = fraction(e)
    setHover({ at: f * duration, x })
    if (seeking) seekTo(e)
  }
  const onTrackUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setSeeking(false)
  }

  // A tap on a touch screen first brings the controls back; a click plays or pauses.
  const onVideoClick = (e: ReactMouseEvent) => {
    if ((e.nativeEvent as PointerEvent).pointerType === 'touch' && !shown) {
      wake()
      return
    }
    togglePlay()
  }

  const updateBuffered = () => {
    const v = video.current
    if (!v) return
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5) setBuffered(v.buffered.end(i))
    }
  }

  useAppMenus(() => [
    {
      label: tr('Playback'),
      items: [
        { label: playing ? tr('Pause') : tr('Play'), icon: playing ? Pause : Play, disabled: error, onSelect: togglePlay },
        { label: tr('Previous Video'), icon: ChevronLeft, disabled: list.length < 2, onSelect: () => go(-1) },
        { label: tr('Next Video'), icon: ChevronRight, disabled: list.length < 2, onSelect: () => go(1) },
        'separator',
        ...SPEEDS.map(s => ({ label: `${s}×`, checked: speed === s, onSelect: () => setSpeed(s) })),
        'separator',
        { label: tr('Loop'), icon: Repeat, checked: loop, onSelect: () => setLoop(l => !l) },
        { label: tr('Picture in Picture'), icon: PictureInPicture2, disabled: !document.pictureInPictureEnabled, onSelect: pip },
        { label: fullscreen ? tr('Exit Full Screen') : tr('Full Screen'), icon: fullscreen ? Minimize : Maximize, onSelect: toggleFullscreen },
      ],
    },
    { label: tr('File'), items: [{ label: tr('Download'), icon: Download, disabled: !current, onSelect: download }] },
  ])

  if (!current) {
    return (
      <div className="media-empty is-dark">
        <Film size={40} />
        <p>{tr('Open a video from Files to play it here.')}</p>
      </div>
    )
  }

  const level = muted ? 0 : volume
  const VolumeIcon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2
  const pct = (t: number) => `${duration ? Math.min(100, (t / duration) * 100) : 0}%`

  return (
    <div className="vp">
      <div
        ref={stage}
        className={`vp-stage ${shown ? '' : 'is-idle'}`}
        onPointerMove={wake}
        onPointerDown={wake}
        onPointerLeave={() => playing && setIdle(true)}
      >
        {!error && <canvas className="vp-backdrop" ref={backdrop} aria-hidden />}
        {flash && (
          <div className="vp-flash" key={flash.n}>
            {flash.text}
          </div>
        )}
        {resumed !== null && !error && (
          <div className="vp-resumed" role="status">
            <span>{tr('Continuing from {0}', formatTime(resumed))}</span>
            <button onClick={startOver}>{tr('Start Over')}</button>
          </div>
        )}
        {error ? (
          <div className="media-empty is-dark">
            <Film size={40} />
            <p>
              {tr('This browser can’t play')} {nameOf(current)}.
              <br />
              <small>{tr('MP4 (H.264) and WebM play everywhere; MKV, AVI and TS usually need remuxing to MP4 first.')}</small>
            </p>
            <div className="vp-error-actions">
              {onConvert && (
                <button className="btn btn-primary" onClick={() => onConvert(current)}>
                  <ArrowRightLeft size={13} /> {tr('Remux to MP4…')}
                </button>
              )}
              <button className="btn" onClick={download}>
                <Download size={13} /> {tr('Download')}
              </button>
            </div>
          </div>
        ) : (
          <video
            key={current}
            ref={video}
            src={api.rawFileUrl(current)}
            autoPlay
            playsInline
            loop={loop}
            onClick={onVideoClick}
            onDoubleClick={toggleFullscreen}
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false)
              savePoint(lastAt.current)
            }}
            onTimeUpdate={e => {
              const v = e.currentTarget
              if (!seeking) setTime(v.currentTime)
              lastAt.current = { path: current, at: v.currentTime, duration: v.duration }
            }}
            onDurationChange={e => setDuration(e.currentTarget.duration || 0)}
            onLoadedMetadata={() => {
              if (resumeAt.current === null) return
              jumpTo(resumeAt.current)
              setResumed(resumeAt.current)
              resumeAt.current = null
            }}
            onProgress={updateBuffered}
            onVolumeChange={e => {
              setVolume(e.currentTarget.volume)
              setMuted(e.currentTarget.muted)
            }}
            onError={() => {
              setError(true)
              setPlaying(false)
            }}
            onEnded={() => {
              // Watched to the end: next time it starts from the beginning.
              savePoint(lastAt.current, true)
              lastAt.current = null
              if (!loop && index < list.length - 1) go(1)
            }}
          />
        )}

        <div ref={hud} className={`vp-hud ${shown ? '' : 'is-hidden'}`}>
          <div className="vp-seek">
            <span className="vp-time">{formatTime(time)}</span>
            <div
              ref={track}
              className={`vp-track ${seeking ? 'is-seeking' : ''}`}
              role="slider"
              aria-label={tr('Playback position')}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(time)}
              aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
              onPointerDown={onTrackDown}
              onPointerMove={onTrackMove}
              onPointerUp={onTrackUp}
              onPointerCancel={onTrackUp}
              onPointerLeave={() => setHover(null)}
            >
              <div className="vp-rail">
                <div className="vp-buffered" style={{ width: pct(buffered) }} />
                <div className="vp-played" style={{ width: pct(time) }} />
              </div>
              <div className="vp-thumb" style={{ left: pct(time) }} />
              {hover && (
                <div className="vp-tip" style={{ left: hover.x }}>
                  {formatTime(hover.at)}
                </div>
              )}
            </div>
            <span className="vp-time">−{formatTime(Math.max(0, duration - time))}</span>
          </div>

          <div className="vp-controls">
            <div className="vp-group">
              <button className="vp-btn" onClick={toggleMute} disabled={error} aria-label={muted ? tr('Unmute') : tr('Mute')} title={muted ? tr('Unmute') : tr('Mute')}>
                <VolumeIcon size={17} />
              </button>
              <input
                className="vp-volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={level}
                disabled={error}
                onChange={e => setLevel(Number(e.target.value))}
                aria-label={tr('Volume')}
                style={{ '--p': `${level * 100}%` } as CSSProperties}
              />
              {list.length > 1 && <span className="vp-count">{tr('{0} of {1}', index + 1, list.length)}</span>}
            </div>

            <div className="vp-group vp-main">
              <button className="vp-btn" onClick={() => go(-1)} disabled={list.length < 2} aria-label={tr('Previous video')} title={tr('Previous video')}>
                <SkipBack size={17} fill="currentColor" />
              </button>
              <button className="vp-btn vp-jump" onClick={() => jump(-JUMP_SECONDS)} disabled={error} aria-label={tr('Back {0} seconds', JUMP_SECONDS)} title={tr('Back {0} seconds', JUMP_SECONDS)}>
                <RotateCcw size={22} strokeWidth={1.8} />
                <b>{JUMP_SECONDS}</b>
              </button>
              <button className="vp-btn vp-play" onClick={togglePlay} disabled={error} aria-label={playing ? tr('Pause') : tr('Play')} title={playing ? tr('Pause') : tr('Play')}>
                {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
              <button className="vp-btn vp-jump" onClick={() => jump(JUMP_SECONDS)} disabled={error} aria-label={tr('Forward {0} seconds', JUMP_SECONDS)} title={tr('Forward {0} seconds', JUMP_SECONDS)}>
                <RotateCw size={22} strokeWidth={1.8} />
                <b>{JUMP_SECONDS}</b>
              </button>
              <button className="vp-btn" onClick={() => go(1)} disabled={list.length < 2} aria-label={tr('Next video')} title={tr('Next video')}>
                <SkipForward size={17} fill="currentColor" />
              </button>
            </div>

            <div className="vp-group vp-end">
              <SpeedMenu speed={speed} onChange={setSpeed} visible={shown} />
              <button className={`vp-btn ${loop ? 'is-on' : ''}`} onClick={() => setLoop(l => !l)} aria-label={tr('Loop')} aria-pressed={loop} title={tr('Loop')}>
                <Repeat size={16} />
              </button>
              {document.pictureInPictureEnabled && (
                <button className="vp-btn vp-optional" onClick={pip} disabled={error} aria-label={tr('Picture in Picture')} title={tr('Picture in Picture')}>
                  <PictureInPicture2 size={16} />
                </button>
              )}
              <button className="vp-btn vp-optional" onClick={download} aria-label={tr('Download')} title={tr('Download')}>
                <Download size={16} />
              </button>
              <button
                className="vp-btn"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? tr('Exit Full Screen') : tr('Full Screen')}
                title={fullscreen ? tr('Exit Full Screen') : tr('Full Screen')}
              >
                {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The speed picker: its menu opens inside the player (not as a page-level menu), so it also
 * works in full screen, where only the player is shown.
 */
function SpeedMenu({ speed, onChange, visible }: { speed: number; onChange: (speed: number) => void; visible: boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!visible) setOpen(false)
  }, [visible])
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])
  return (
    <div className="vp-speed" ref={box}>
      <button
        className={`vp-speed-btn ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tr('Playback speed')}
        title={tr('Playback speed')}
      >
        {speed}×
      </button>
      {open && (
        <div className="vp-menu" role="menu" aria-label={tr('Playback speed')}>
          {SPEEDS.map(s => (
            <button
              key={s}
              className={`vp-menu-item ${s === speed ? 'is-on' : ''}`}
              role="menuitemradio"
              aria-checked={s === speed}
              onClick={() => {
                onChange(s)
                setOpen(false)
              }}
            >
              <span>{s === 1 ? tr('Normal') : `${s}×`}</span>
              {s === speed && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
