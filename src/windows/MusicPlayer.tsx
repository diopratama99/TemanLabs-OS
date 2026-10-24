import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowUp,
  Folder,
  ListMusic,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { api } from '../api'
import type { FileEntry } from '../api/types'
import { useAppMenus } from '../lib/appMenus'
import { DATA_ROOT } from '../lib/places'
import { folderOf, formatTime, trackTitle, type MediaRequest } from '../lib/media'
import { displayName, joinPath, nameOf, parentOf } from '../lib/paths'

type RepeatMode = 'off' | 'all' | 'one'

const LIBRARY_CANDIDATES = [`${DATA_ROOT}/Media/Music`, `${DATA_ROOT}/Music`, `${DATA_ROOT}/Media`, DATA_ROOT]
const COVER_NAMES = /^(cover|folder|front|album|albumart)\.(jpe?g|png|webp)$/i
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

interface Props {
  request: MediaRequest | null
  onTitle: (title: string) => void
}

/** Music: browse folders of audio files and play them, with a queue, shuffle and repeat. */
export function MusicPlayer({ request, onTitle }: Props) {
  const [dir, setDir] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ current: 0, duration: 0 })
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const titleRef = useRef(onTitle)
  titleRef.current = onTitle

  const track = queue[pos] ?? null

  // Library: the folder of an opened file, else the first music folder that exists.
  useEffect(() => {
    if (request) return
    let alive = true
    ;(async () => {
      for (const candidate of LIBRARY_CANDIDATES) {
        try {
          await api.listFiles(candidate)
          if (alive) setDir(d => d ?? candidate)
          return
        } catch {
          // Try the next one.
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [request])

  useEffect(() => {
    if (!dir) return
    let alive = true
    api.listFiles(dir).then(
      list => {
        if (!alive) return
        setEntries(list.filter(e => e.kind === 'folder' || e.kind === 'audio'))
        setLoadError(null)
        const cover = list.find(e => COVER_NAMES.test(e.name))
        setCovers(c => ({ ...c, [dir]: cover ? joinPath(dir, cover.name) : null }))
      },
      err => alive && setLoadError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
    }
  }, [dir])

  const tracksIn = (list: FileEntry[], folder: string) =>
    list
      .filter(e => e.kind === 'audio')
      .map(e => e.name)
      .sort(byName)
      .map(name => joinPath(folder, name))

  const playQueue = useCallback((paths: string[], start: number) => {
    setQueue(paths)
    setPos(start)
    setPlaying(true)
  }, [])

  // Opening a song from Files plays its folder from that song.
  useEffect(() => {
    if (!request) return
    const folder = folderOf(request.path)
    setDir(folder)
    api.listFiles(folder).then(
      list => {
        const tracks = tracksIn(list, folder)
        const all = tracks.includes(request.path) ? tracks : [request.path, ...tracks]
        playQueue(all, all.indexOf(request.path))
      },
      () => playQueue([request.path], 0),
    )
  }, [request, playQueue])

  // The album cover of the playing track's folder.
  const trackFolder = track ? folderOf(track) : null
  useEffect(() => {
    if (!trackFolder || trackFolder in covers) return
    api.listFiles(trackFolder).then(
      list => {
        const cover = list.find(e => COVER_NAMES.test(e.name))
        setCovers(c => ({ ...c, [trackFolder]: cover ? joinPath(trackFolder, cover.name) : null }))
      },
      () => setCovers(c => ({ ...c, [trackFolder]: null })),
    )
  }, [trackFolder, covers])
  const cover = trackFolder ? covers[trackFolder] : null

  useEffect(() => {
    setError(null)
    titleRef.current(track ? trackTitle(track) : 'Music Player')
  }, [track])

  // Keep the element in sync with the play state (autoplay can be refused until a click).
  useEffect(() => {
    const el = audio.current
    if (!el || !track) return
    // Skipping tracks aborts the previous play(); that isn't the user stopping playback.
    if (playing) el.play().catch((err: DOMException) => err.name !== 'AbortError' && setPlaying(false))
    else el.pause()
  }, [playing, track])

  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume
      audio.current.muted = muted
    }
  }, [volume, muted, track])

  const next = useCallback(
    (auto = false) => {
      if (!queue.length) return
      if (auto && repeat === 'one') {
        if (audio.current) audio.current.currentTime = 0
        void audio.current?.play()
        return
      }
      // The element pauses itself at the end of a song, so moving on resumes playback.
      if (shuffle && queue.length > 1) {
        let n = pos
        while (n === pos) n = Math.floor(Math.random() * queue.length)
        setPos(n)
        setPlaying(true)
      } else if (pos < queue.length - 1) {
        setPos(pos + 1)
        setPlaying(true)
      } else if (repeat !== 'off' || !auto) {
        setPos(0)
        setPlaying(true)
      } else setPlaying(false)
    },
    [queue, pos, shuffle, repeat],
  )
  const previous = useCallback(() => {
    // Like every music app: restart the song unless it has only just begun.
    if (audio.current && audio.current.currentTime > 3) audio.current.currentTime = 0
    else if (queue.length) setPos(p => (p - 1 + queue.length) % queue.length)
  }, [queue.length])

  // Media keys and the browser's / OS's Now Playing controls.
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || !track) return
    ms.metadata = new MediaMetadata({
      title: trackTitle(track),
      album: displayName(folderOf(track)),
      artwork: cover ? [{ src: api.rawFileUrl(cover) }] : [],
    })
    ms.setActionHandler('play', () => setPlaying(true))
    ms.setActionHandler('pause', () => setPlaying(false))
    ms.setActionHandler('nexttrack', () => next())
    ms.setActionHandler('previoustrack', previous)
    return () => {
      for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) ms.setActionHandler(action, null)
    }
  }, [track, cover, next, previous])

  const seek = (value: number) => {
    if (audio.current) audio.current.currentTime = value
    setTime(t => ({ ...t, current: value }))
  }

  const repeatNext: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
  useAppMenus(() => [
    {
      label: 'Controls',
      items: [
        { label: playing ? 'Pause' : 'Play', icon: playing ? Pause : Play, disabled: !track, onSelect: () => setPlaying(p => !p) },
        { label: 'Next', icon: SkipForward, disabled: !track, onSelect: () => next() },
        { label: 'Previous', icon: SkipBack, disabled: !track, onSelect: previous },
        'separator',
        { label: 'Shuffle', icon: Shuffle, checked: shuffle, onSelect: () => setShuffle(s => !s) },
        { label: 'Repeat All', checked: repeat === 'all', onSelect: () => setRepeat(r => (r === 'all' ? 'off' : 'all')) },
        { label: 'Repeat One', checked: repeat === 'one', onSelect: () => setRepeat(r => (r === 'one' ? 'off' : 'one')) },
        'separator',
        { label: muted ? 'Unmute' : 'Mute', icon: VolumeX, onSelect: () => setMuted(m => !m) },
      ],
    },
  ])

  const folders = entries.filter(e => e.kind === 'folder').sort((a, b) => byName(a.name, b.name))
  const tracks = dir ? tracksIn(entries, dir) : []
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div className="mp">
      <audio
        ref={audio}
        src={track ? api.rawFileUrl(track) : undefined}
        preload="metadata"
        onTimeUpdate={e => setTime({ current: e.currentTarget.currentTime, duration: e.currentTarget.duration || 0 })}
        onLoadedMetadata={e => setTime({ current: 0, duration: e.currentTarget.duration || 0 })}
        onEnded={() => next(true)}
        onError={() => track && setError(`Can’t play ${nameOf(track)} in this browser.`)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />

      <div className={`mp-now ${playing ? 'is-playing' : ''}`}>
        <div className="mp-art" key={cover ?? 'none'}>
          {cover ? <img src={api.rawFileUrl(cover)} alt="" /> : <Music size={42} />}
        </div>
        <div className="mp-info">
          <strong>{track ? trackTitle(track) : 'Not Playing'}</strong>
          <span>{track ? displayName(folderOf(track)) : 'Choose a song below'}</span>
          {error && <span className="form-error">{error}</span>}
          <div className="mp-progress">
            <small>{formatTime(time.current)}</small>
            <input
              type="range"
              min={0}
              max={time.duration || 0}
              step={0.1}
              value={Math.min(time.current, time.duration || 0)}
              onChange={e => seek(Number(e.target.value))}
              disabled={!track}
              aria-label="Position"
              style={{ '--fill': `${time.duration ? (time.current / time.duration) * 100 : 0}%` } as CSSProperties}
            />
            <small>-{formatTime(Math.max(0, time.duration - time.current))}</small>
          </div>
          <div className="mp-controls">
            <button className={`icon-btn ${shuffle ? 'is-on' : ''}`} onClick={() => setShuffle(s => !s)} aria-label="Shuffle" title="Shuffle">
              <Shuffle size={15} />
            </button>
            <button className="icon-btn" onClick={previous} disabled={!track} aria-label="Previous">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button className="mp-play" onClick={() => (track ? setPlaying(p => !p) : tracks.length && playQueue(tracks, 0))} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>
            <button className="icon-btn" onClick={() => next()} disabled={!track} aria-label="Next">
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              className={`icon-btn ${repeat !== 'off' ? 'is-on' : ''}`}
              onClick={() => setRepeat(r => repeatNext[r])}
              aria-label={`Repeat: ${repeat}`}
              title={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
            >
              {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
            </button>
            <span className="mp-volume">
              <button className="icon-btn" onClick={() => setMuted(m => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
                <VolumeIcon size={15} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={e => {
                  setVolume(Number(e.target.value))
                  setMuted(false)
                }}
                aria-label="Volume"
                style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
              />
            </span>
          </div>
        </div>
      </div>

      <div className="mp-library">
        <div className="mp-lib-head">
          <button className="icon-btn" onClick={() => dir && setDir(parentOf(dir))} disabled={!dir || dir === '/'} aria-label="Up one folder">
            <ArrowUp size={15} />
          </button>
          <strong>{dir ? displayName(dir) : 'Library'}</strong>
          <small>{dir}</small>
          <span className="media-spacer" />
          <button className="pill-btn" onClick={() => playQueue(tracks, 0)} disabled={!tracks.length}>
            <Play size={12} fill="currentColor" /> Play All
          </button>
          <button
            className="pill-btn"
            onClick={() => {
              setShuffle(true)
              playQueue(tracks, Math.floor(Math.random() * tracks.length))
            }}
            disabled={!tracks.length}
          >
            <Shuffle size={12} /> Shuffle
          </button>
        </div>
        <div className="mp-list">
          {loadError && <p className="am-empty form-error">{loadError}</p>}
          {!loadError && folders.length === 0 && tracks.length === 0 && (
            <p className="am-empty">
              <ListMusic size={18} /> No music in this folder. Put songs in {DATA_ROOT}/Media/Music.
            </p>
          )}
          {folders.map(f => (
            <button key={f.name} className="mp-row is-folder" onDoubleClick={() => dir && setDir(joinPath(dir, f.name))} onClick={() => dir && setDir(joinPath(dir, f.name))}>
              <Folder size={15} />
              <span>{f.name}</span>
            </button>
          ))}
          {tracks.map((path, i) => {
            const isCurrent = path === track
            return (
              <button key={path} className={`mp-row ${isCurrent ? 'is-current' : ''}`} onDoubleClick={() => playQueue(tracks, i)} onClick={() => isCurrent || playQueue(tracks, i)}>
                <span className="mp-num">{isCurrent && playing ? <i className="mp-eq" aria-label="Playing"><b /><b /><b /></i> : i + 1}</span>
                <span>{trackTitle(path)}</span>
                <small>{nameOf(path).split('.').pop()?.toUpperCase()}</small>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
