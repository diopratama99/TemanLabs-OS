import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  AudioLines,
  Captions,
  CircleCheck,
  Clock,
  Film,
  FolderOpen,
  LoaderCircle,
  Music,
  Play,
  Sparkles,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react'
import { api } from '../api'
import type { ConvertAudio, ConvertContainer, ConvertInfo, ConvertQuality, ConvertTask, ConvertVideo, FileEntry, Job, MediaProbe, ProbeStream } from '../api/types'
import { OpenDialog } from '../components/code/OpenDialog'
import { PopUpButton } from '../components/PopUpButton'
import { Switch } from '../components/Switch'
import { useAppMenus } from '../lib/appMenus'
import { formatBytes } from '../lib/format'
import { formatTime, type MediaKind, type MediaRequest } from '../lib/media'
import { DATA_ROOT } from '../lib/places'
import { nameOf, parentOf } from '../lib/paths'
import { tr } from '../lib/i18n'

// What each format can hold, for the pickers (the server checks again before it starts).
const FORMATS: { id: ConvertContainer; label: string; audioOnly?: true; video?: ConvertVideo[]; audio: ConvertAudio[]; subs?: 'all' | 'text' }[] = [
  { id: 'mp4', label: 'MP4', video: ['copy', 'h264', 'hevc', 'av1', 'vp9'], audio: ['copy', 'aac', 'opus', 'mp3', 'flac', 'none'], subs: 'text' },
  { id: 'mkv', label: 'MKV', video: ['copy', 'h264', 'hevc', 'av1', 'vp9'], audio: ['copy', 'aac', 'opus', 'mp3', 'flac', 'none'], subs: 'all' },
  { id: 'webm', label: 'WebM', video: ['copy', 'vp9', 'av1'], audio: ['copy', 'opus', 'none'], subs: 'text' },
  { id: 'mov', label: 'MOV', video: ['copy', 'h264', 'hevc'], audio: ['copy', 'aac', 'mp3', 'none'], subs: 'text' },
  { id: 'ts', label: 'TS (MPEG-TS)', video: ['copy', 'h264', 'hevc'], audio: ['copy', 'aac', 'mp3', 'opus', 'none'] },
  { id: 'mp3', label: 'MP3', audioOnly: true, audio: ['copy', 'mp3'] },
  { id: 'm4a', label: 'M4A (AAC)', audioOnly: true, audio: ['copy', 'aac'] },
  { id: 'flac', label: 'FLAC', audioOnly: true, audio: ['copy', 'flac'] },
  { id: 'opus', label: 'Opus', audioOnly: true, audio: ['copy', 'opus'] },
  { id: 'wav', label: 'WAV', audioOnly: true, audio: ['copy', 'pcm'] },
]
const formatOf = (id: ConvertContainer) => FORMATS.find(f => f.id === id)!

const VIDEO_LABEL: Record<ConvertVideo, string> = {
  copy: tr('Keep as it is'),
  h264: 'H.264',
  hevc: tr('H.265 (smaller)'),
  vp9: 'VP9',
  av1: tr('AV1 (smallest, slow)'),
}
const AUDIO_LABEL: Record<ConvertAudio, string> = {
  copy: tr('Keep as it is'),
  aac: 'AAC',
  opus: 'Opus',
  mp3: 'MP3',
  flac: tr('FLAC (lossless)'),
  pcm: tr('WAV (uncompressed)'),
  none: tr('No sound'),
}
const HEIGHTS = [0, 2160, 1440, 1080, 720, 480]

const CODEC_NAME: Record<string, string> = {
  h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', mpeg1video: 'MPEG-1', vc1: 'VC-1', prores: 'ProRes', mp2: 'MP2',
  aac: 'AAC', mp3: 'MP3', ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', flac: 'FLAC', opus: 'Opus',
  vorbis: 'Vorbis', alac: 'ALAC', pcm_s16le: 'PCM', pcm_s24le: 'PCM', subrip: 'SRT', ass: 'ASS', ssa: 'SSA', mov_text: 'MP4 text', webvtt: 'WebVTT',
  hdmv_pgs_subtitle: tr('PGS (picture)'), dvd_subtitle: tr('DVD (picture)'), dvb_subtitle: tr('DVB (picture)'),
}
const codecName = (c: string) => CODEC_NAME[c] ?? c.toUpperCase()
const TEXT_SUBS = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']
const channels = (n?: number) => (n === 1 ? tr('Mono') : n === 2 ? tr('Stereo') : n === 6 ? '5.1' : n === 8 ? '7.1' : n ? tr('{0} channels', n) : '')

interface Options {
  container: ConvertContainer
  video: ConvertVideo
  audio: ConvertAudio
  quality: ConvertQuality
  height: number
  subtitles: boolean
}

interface Preset {
  id: string
  title: string
  note: string
  badge: 'fast' | 'slow'
  options: Options
  /** Why it can't be used for this file. */
  blocked?: string
}

// One-click choices for the file in hand. A remux copies the picture; when only the sound can't
// go in as it is, it's converted on the way (seconds, still).
function presetsFor(p: MediaProbe, encoders: string[]): Preset[] {
  const hasVideo = p.streams.some(s => s.type === 'video' && !s.cover)
  const has = (codec: string) => encoders.includes(codec)
  const sound = (container: ConvertContainer, fallback: ConvertAudio): ConvertAudio => (p.remux[container]?.audio ? fallback : 'copy')
  const soundNote = (container: ConvertContainer, fallback: string) => {
    const first = p.streams.find(s => s.type === 'audio')
    return p.remux[container]?.audio && first ? tr('{0} sound becomes {1}.', codecName(first.codec), fallback) : ''
  }
  const base = { quality: 'medium' as ConvertQuality, height: 0, subtitles: true }
  if (!hasVideo) {
    const own = p.path.slice(p.path.lastIndexOf('.') + 1).toLowerCase()
    const audio: Preset[] = [
      { id: 'mp3', title: tr('MP3'), note: tr('Plays everywhere.'), badge: p.remux.mp3?.audio ? 'slow' : 'fast', options: { ...base, container: 'mp3', video: 'copy', audio: sound('mp3', 'mp3') }, blocked: has('mp3') || !p.remux.mp3?.audio ? undefined : tr('This server’s ffmpeg can’t make MP3.') },
      { id: 'm4a', title: tr('M4A (AAC)'), note: tr('Smaller than MP3 at the same quality.'), badge: p.remux.m4a?.audio ? 'slow' : 'fast', options: { ...base, container: 'm4a', video: 'copy', audio: sound('m4a', 'aac') } },
      { id: 'flac', title: tr('FLAC'), note: tr('Lossless: keeps every detail, bigger file.'), badge: p.remux.flac?.audio ? 'slow' : 'fast', options: { ...base, container: 'flac', video: 'copy', audio: sound('flac', 'flac') } },
    ]
    return audio.filter(x => x.options.container !== own)
  }
  const presets: Preset[] = [
    {
      id: 'remux-mp4',
      title: tr('Remux to MP4'),
      note: [tr('Same picture, plays in browsers and on phones. Takes seconds.'), soundNote('mp4', 'AAC')].filter(Boolean).join(' '),
      badge: 'fast',
      options: { ...base, container: 'mp4', video: 'copy', audio: sound('mp4', 'aac') },
      blocked: p.remux.mp4?.video,
    },
    {
      id: 'remux-mkv',
      title: tr('Remux to MKV'),
      note: tr('Keeps every sound track and subtitle. Takes seconds.'),
      badge: 'fast',
      options: { ...base, container: 'mkv', video: 'copy', audio: 'copy' },
      blocked: p.remux.mkv?.video,
    },
    {
      id: 'remux-ts',
      title: tr('Remux to TS'),
      note: [tr('For TV boxes, IPTV and recorders. Takes seconds.'), soundNote('ts', 'AAC')].filter(Boolean).join(' '),
      badge: 'fast',
      options: { ...base, container: 'ts', video: 'copy', audio: sound('ts', 'aac') },
      blocked: p.remux.ts?.video,
    },
    {
      id: 'h264',
      title: tr('MP4 for every device'),
      note: tr('H.264: plays on anything, even old TVs. Converts the picture, so it takes a while.'),
      badge: 'slow',
      options: { ...base, container: 'mp4', video: 'h264', audio: sound('mp4', 'aac') },
      blocked: has('h264') ? undefined : tr('This server’s ffmpeg can’t make H.264.'),
    },
    {
      id: 'hevc',
      title: tr('Smaller file'),
      note: tr('H.265: about half the size at the same quality. The slowest.'),
      badge: 'slow',
      options: { ...base, container: 'mp4', video: 'hevc', audio: sound('mp4', 'aac') },
      blocked: has('hevc') ? undefined : tr('This server’s ffmpeg can’t make H.265.'),
    },
    {
      id: 'webm',
      title: tr('WebM for the web'),
      note: tr('VP9 and Opus, the open formats every browser plays.'),
      badge: 'slow',
      options: { ...base, container: 'webm', video: 'vp9', audio: sound('webm', 'opus') },
      blocked: has('vp9') && has('opus') ? undefined : tr('This server’s ffmpeg can’t make VP9.'),
    },
    {
      id: 'mp3',
      title: tr('Just the sound'),
      note: tr('An MP3 of the sound track.'),
      badge: 'fast',
      options: { ...base, container: 'mp3', video: 'copy', audio: sound('mp3', 'mp3') },
      blocked: p.streams.some(s => s.type === 'audio') ? undefined : tr('This file has no sound.'),
    },
  ]
  // A plain copy into the format the file already has would only duplicate it.
  const own = p.path.slice(p.path.lastIndexOf('.') + 1).toLowerCase()
  return presets.filter(x => !(x.options.container === own && x.options.video === 'copy' && x.options.audio === 'copy'))
}

const sameOptions = (a: Options, b: Options) =>
  a.container === b.container && a.video === b.video && a.audio === b.audio && a.quality === b.quality && a.height === b.height && a.subtitles === b.subtitles

const baseName = (path: string) => nameOf(path).replace(/\.[^.]+$/, '')

interface Props {
  /** A file sent from Files (Open With → Remux). */
  request: MediaRequest | null
  onPlay: (path: string, kind: MediaKind) => void
}

/** Remux: changes a video's format, or converts it, with the server's ffmpeg. */
export function Remux({ request, onPlay }: Props) {
  const [info, setInfo] = useState<ConvertInfo | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [probe, setProbe] = useState<MediaProbe | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)

  useEffect(() => {
    if (!request) return
    setNameEdited(false)
    setPath(request.path)
  }, [request])

  // The queue: every second while something is converting, now and then otherwise.
  const busy = info?.tasks.some(t => t.status === 'queued' || t.status === 'running') ?? false
  const refresh = () => api.convertInfo().then(setInfo, () => {})
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), busy ? 1000 : 5000)
    return () => clearInterval(timer)
  }, [busy])

  // Installing ffmpeg: follow the apt job, then look again.
  useEffect(() => {
    if (!job?.running) return
    const timer = setInterval(async () => {
      const next = await api.job('apt').catch(() => null)
      if (!next) return
      setJob(next)
      if (!next.running) void refresh()
    }, 1000)
    return () => clearInterval(timer)
  }, [job?.running])

  useEffect(() => {
    if (!path) return
    let alive = true
    setProbe(null)
    setProbeError(null)
    setOptions(null)
    setError(null)
    api.probeMedia(path).then(
      p => alive && setProbe(p),
      (err: Error) => alive && setProbeError(err.message),
    )
    return () => {
      alive = false
    }
  }, [path])

  const encoders = info?.encoders ?? []
  const presets = useMemo(() => (probe ? presetsFor(probe, encoders) : []), [probe, encoders.join()])
  // The first preset that works is picked for a new file.
  useEffect(() => {
    if (!probe || options) return
    const first = presets.find(p => !p.blocked)
    if (first) choose(first.options)
  }, [presets])

  const choose = (next: Options) => {
    setOptions(next)
    setError(null)
    if (!nameEdited && path) setName(`${baseName(path)}.${next.container}`)
  }
  const change = (patch: Partial<Options>) => {
    if (!options) return
    const next = { ...options, ...patch }
    const f = formatOf(next.container)
    // Keep the choices valid for the format.
    if (f.video && !f.video.includes(next.video)) next.video = 'copy'
    if (!f.audio.includes(next.audio)) next.audio = f.audio.includes('copy') ? 'copy' : f.audio[0]
    choose(next)
  }

  const start = async () => {
    if (!path || !options) return
    setStarting(true)
    setError(null)
    try {
      await api.startConvert({ path, ...options, video: formatOf(options.container).audioOnly ? 'copy' : options.video, name: name.trim() || undefined })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  useAppMenus(() => [{ label: tr('File'), items: [{ label: tr('Choose File…'), icon: FolderOpen, onSelect: () => setChoosing(true) }] }])

  const format = options ? formatOf(options.container) : null
  const hasVideo = probe?.streams.some(s => s.type === 'video' && !s.cover) ?? false
  const subs = probe?.streams.filter(s => s.type === 'subtitle') ?? []
  const sourceHeight = Math.max(0, ...(probe?.streams.filter(s => s.type === 'video' && !s.cover).map(s => s.height ?? 0) ?? []))
  const converting = !!options && ((!format?.audioOnly && options.video !== 'copy') || (options.audio !== 'copy' && options.audio !== 'none'))
  // A copy that can't work, explained before Start is pressed.
  const problem =
    probe && options && format
      ? (!format.audioOnly && options.video === 'copy' && probe.remux[options.container]?.video) ||
        (options.audio === 'copy' && probe.streams.some(s => s.type === 'audio') && probe.remux[options.container]?.audio) ||
        (options.audio === 'none' && format.audioOnly ? tr('A sound file needs sound.') : '')
      : ''
  const activePreset = options ? presets.find(p => sameOptions(p.options, options))?.id : undefined

  return (
    <div className="rx">
      <div className="rx-main">
        {info && !info.ffmpeg && (
          <div className="group rx-banner">
            <TriangleAlert size={18} />
            <span>
              <strong>{tr('ffmpeg isn’t installed')}</strong>
              <small>{tr('Remux uses ffmpeg, the standard tool for video and sound files.')}</small>
            </span>
            <button
              className="btn btn-primary"
              disabled={job?.running}
              onClick={async () => {
                try {
                  await api.installFFmpeg()
                  setJob(await api.job('apt'))
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                }
              }}
            >
              {job?.running ? <LoaderCircle size={13} className="spin" /> : null} {tr('Install ffmpeg')}
            </button>
          </div>
        )}
        {job && (
          <div className="su-job">
            <div className="su-job-head">
              {job.running ? <LoaderCircle size={14} className="spin" /> : job.exit === 0 ? <CircleCheck size={14} className="is-ok" /> : <TriangleAlert size={14} className="is-bad" />}
              <strong>{job.title}</strong>
              <small>{job.running ? tr('Working…') : job.exit === 0 ? tr('Done') : tr('Failed')}</small>
              {!job.running && (
                <button className="icon-btn" onClick={() => setJob(null)} aria-label={tr('Hide log')}>
                  <X size={13} />
                </button>
              )}
            </div>
            <pre className="su-log">{job.log.slice(-200).join('\n') || '…'}</pre>
          </div>
        )}

        {!path ? (
          <div className="rx-empty">
            <div className="rx-empty-icon">
              <ArrowRightLeft size={30} />
            </div>
            <h2>{tr('Change a video’s format')}</h2>
            <p>{tr('Remux to MP4 or MKV in seconds without losing quality, or convert to a smaller or more compatible file. It all runs on the server.')}</p>
            <button className="btn btn-primary" onClick={() => setChoosing(true)}>
              <FolderOpen size={14} /> {tr('Choose File…')}
            </button>
            <small>{tr('Or in Files: right-click a video → Open With → Remux.')}</small>
          </div>
        ) : (
          <>
            <Source path={path} probe={probe} error={probeError} onChange={() => setChoosing(true)} />

            {probe && (
              <>
                <h4 className="rx-heading">{tr('Make')}</h4>
                <div className="rx-presets">
                  {presets.map(p => (
                    <button
                      key={p.id}
                      className={`rx-preset ${activePreset === p.id ? 'is-active' : ''}`}
                      disabled={!!p.blocked}
                      onClick={() => choose(p.options)}
                      title={p.blocked}
                    >
                      <span className="rx-preset-top">
                        <strong>{p.title}</strong>
                        <span className={`rx-badge is-${p.badge}`}>
                          {p.badge === 'fast' ? <Zap size={11} /> : <Clock size={11} />} {p.badge === 'fast' ? tr('Fast') : tr('Converts')}
                        </span>
                      </span>
                      <small>{p.blocked ?? p.note}</small>
                    </button>
                  ))}
                </div>

                {options && format && (
                  <>
                    <h4 className="rx-heading">{activePreset ? tr('Details') : tr('Custom')}</h4>
                    <div className="group rx-form">
                      <div className="row">
                        <span>{tr('Format')}</span>
                        <PopUpButton
                          value={options.container}
                          options={FORMATS.filter(f => hasVideo || f.audioOnly).map(f => ({ value: f.id, label: f.label }))}
                          onChange={container => change({ container })}
                          aria-label={tr('Format')}
                        />
                      </div>
                      {!format.audioOnly && (
                        <div className="row">
                          <span>{tr('Picture')}</span>
                          <PopUpButton
                            value={options.video}
                            options={format.video!.filter(v => v === 'copy' || encoders.includes(v)).map(v => ({ value: v, label: VIDEO_LABEL[v] }))}
                            onChange={video => change({ video, height: video === 'copy' ? 0 : options.height })}
                            aria-label={tr('Picture')}
                          />
                        </div>
                      )}
                      <div className="row">
                        <span>{tr('Sound')}</span>
                        <PopUpButton
                          value={options.audio}
                          options={format.audio.filter(a => a === 'copy' || a === 'none' || encoders.includes(a)).map(a => ({ value: a, label: AUDIO_LABEL[a] }))}
                          onChange={audio => change({ audio })}
                          aria-label={tr('Sound')}
                        />
                      </div>
                      {converting && (
                        <div className="row">
                          <span>{tr('Quality')}</span>
                          <div className="segmented rx-quality" role="radiogroup" aria-label={tr('Quality')}>
                            {(['high', 'medium', 'small'] as ConvertQuality[]).map(q => (
                              <button key={q} role="radio" aria-checked={options.quality === q} className={options.quality === q ? 'is-active' : ''} onClick={() => change({ quality: q })}>
                                {q === 'high' ? tr('Best') : q === 'medium' ? tr('Balanced') : tr('Smallest')}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!format.audioOnly && options.video !== 'copy' && sourceHeight > 480 && (
                        <div className="row">
                          <span>{tr('Size')}</span>
                          <PopUpButton
                            value={String(options.height)}
                            options={HEIGHTS.filter(h => h === 0 || h < sourceHeight).map(h => ({
                              value: String(h),
                              label: h === 0 ? tr('Original ({0}p)', sourceHeight) : h === 2160 ? '4K (2160p)' : `${h}p`,
                            }))}
                            onChange={h => change({ height: Number(h) })}
                            aria-label={tr('Size')}
                          />
                        </div>
                      )}
                      {!format.audioOnly && subs.length > 0 && (
                        <div className="row rx-check">
                          <span>
                            {tr('Keep subtitles')}
                            {format.subs === 'text' && subs.some(s => !TEXT_SUBS.includes(s.codec)) && <small>{tr('Picture subtitles (Blu-ray, DVD) only fit in MKV and are left out.')}</small>}
                          </span>
                          <Switch checked={options.subtitles} onChange={subtitles => change({ subtitles })} label={tr('Keep subtitles')} />
                        </div>
                      )}
                      <div className="row">
                        <span>{tr('Save as')}</span>
                        <input
                          className="rx-name"
                          value={name}
                          spellCheck={false}
                          onChange={e => {
                            setName(e.target.value)
                            setNameEdited(true)
                          }}
                          aria-label={tr('File name')}
                        />
                      </div>
                    </div>
                    <div className="rx-actions">
                      <small className={problem || error ? 'rx-error' : ''}>
                        {problem || error || tr('Saved next to the original, in {0}. The original stays as it is.', parentOf(path))}
                      </small>
                      <button className="btn btn-primary" onClick={() => void start()} disabled={starting || !!problem || !info?.ffmpeg}>
                        {starting ? <LoaderCircle size={13} className="spin" /> : converting ? <Sparkles size={13} /> : <Zap size={13} />}{' '}
                        {converting ? tr('Convert') : tr('Remux')}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Queue tasks={info?.tasks ?? []} onChanged={() => void refresh()} onPlay={onPlay} />

      {choosing && (
        <OpenDialog
          mode="file"
          title={tr('Choose a Video or Sound File')}
          startDir={path ? parentOf(path) : DATA_ROOT}
          accept={(e: FileEntry) => e.kind === 'video' || e.kind === 'audio'}
          onOpen={p => {
            setChoosing(false)
            setNameEdited(false)
            setPath(p)
          }}
          onCancel={() => setChoosing(false)}
        />
      )}
    </div>
  )
}

function Source({ path, probe, error, onChange }: { path: string; probe: MediaProbe | null; error: string | null; onChange: () => void }) {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toUpperCase() : ''
  return (
    <div className="group rx-source">
      <div className="rx-source-head">
        <div className="rx-thumb">{probe && !probe.streams.some(s => s.type === 'video' && !s.cover) ? <Music size={20} /> : <Film size={20} />}</div>
        <span className="rx-source-name">
          <strong title={path}>{nameOf(path)}</strong>
          <small>
            {error ? (
              <span className="rx-error">{error}</span>
            ) : probe ? (
              [ext, formatTime(probe.duration), formatBytes(probe.size), probe.bitrate ? (probe.bitrate >= 1e6 ? `${(probe.bitrate / 1e6).toFixed(1)} Mbit/s` : `${Math.round(probe.bitrate / 1e3)} kbit/s`) : ''].filter(Boolean).join(' · ')
            ) : (
              tr('Reading the file…')
            )}
          </small>
        </span>
        <button className="btn" onClick={onChange}>
          {tr('Change…')}
        </button>
      </div>
      {probe && (
        <div className="rx-streams">
          {probe.streams
            .filter(s => s.type === 'video' || s.type === 'audio' || s.type === 'subtitle')
            .map(s => (
              <StreamChip key={s.index} stream={s} />
            ))}
        </div>
      )}
    </div>
  )
}

function StreamChip({ stream: s }: { stream: ProbeStream }) {
  const Icon = s.type === 'video' ? Film : s.type === 'audio' ? AudioLines : Captions
  const parts =
    s.type === 'video'
      ? [s.cover ? tr('Cover picture') : codecName(s.codec), s.width && s.height ? `${s.width}×${s.height}` : '', s.fps && !s.cover ? `${s.fps} fps` : '', s.hdr ? 'HDR' : '']
      : s.type === 'audio'
        ? [codecName(s.codec), channels(s.channels), s.language?.toUpperCase() ?? '', s.title ?? '']
        : [codecName(s.codec), s.language?.toUpperCase() ?? '', s.title ?? '']
  return (
    <span className={`rx-chip is-${s.type}`}>
      <Icon size={12} /> {parts.filter(Boolean).join(' · ')}
    </span>
  )
}

function describe(t: ConvertTask) {
  const f = formatOf(t.container)?.label ?? t.container.toUpperCase()
  if (formatOf(t.container)?.audioOnly) return tr('Sound to {0}', f)
  if (t.video === 'copy') return t.audio === 'copy' || t.audio === 'none' ? tr('Remux to {0}', f) : tr('Remux to {0}, new sound', f)
  return tr('Convert to {0} · {1}', f, VIDEO_LABEL[t.video ?? 'copy'])
}

function Queue({ tasks, onChanged, onPlay }: { tasks: ConvertTask[]; onChanged: () => void; onPlay: (path: string, kind: MediaKind) => void }) {
  const finished = tasks.some(t => t.status !== 'queued' && t.status !== 'running')
  const act = (task: () => Promise<unknown>) => void task().then(onChanged, onChanged)
  // Keep the list scrolled to the top when a new task comes in.
  const list = useRef<HTMLDivElement>(null)
  const count = useRef(tasks.length)
  useEffect(() => {
    if (tasks.length > count.current) list.current?.scrollTo({ top: 0, behavior: 'smooth' })
    count.current = tasks.length
  }, [tasks.length])

  return (
    <aside className="rx-queue">
      <div className="rx-queue-head">
        <strong>{tr('Queue')}</strong>
        {finished && (
          <button className="pill-btn" onClick={() => act(() => api.clearConverts())}>
            {tr('Clear Finished')}
          </button>
        )}
      </div>
      <div className="rx-queue-list" ref={list}>
        {tasks.length === 0 && <p className="rx-queue-empty">{tr('Nothing yet. Conversions run one at a time, and you can close this window while they do.')}</p>}
        {tasks.map(t => {
          const left = t.status === 'running' && t.speed && t.duration ? ((1 - t.progress) * t.duration) / t.speed : 0
          const kind: MediaKind = formatOf(t.container)?.audioOnly ? 'audio' : 'video'
          return (
            <div key={t.id} className={`rx-task is-${t.status}`}>
              <span className="rx-task-icon">
                {t.status === 'running' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : t.status === 'done' ? (
                  <CircleCheck size={15} />
                ) : t.status === 'failed' ? (
                  <TriangleAlert size={15} />
                ) : t.status === 'queued' ? (
                  <Clock size={15} />
                ) : (
                  <X size={15} />
                )}
              </span>
              <span className="rx-task-body">
                <strong title={t.output}>{nameOf(t.output)}</strong>
                <small>{describe(t)}</small>
                {t.status === 'running' && (
                  <span className={`rx-bar ${t.final ? 'is-final' : ''}`}>
                    <span style={{ width: `${Math.round((t.final ? (t.finishing ?? 0) : t.progress) * 100)}%` }} />
                  </span>
                )}
                <small className={t.status === 'failed' ? 'rx-error' : ''}>
                  {t.status === 'queued'
                    ? tr('Waiting')
                    : t.status === 'running' && t.final
                      ? tr('Finishing: moving the index to the start · {0}%', Math.round((t.finishing ?? 0) * 100))
                      : t.status === 'running'
                      ? [
                          // 100% only once it's really done: MP4 still has its last pass to go.
                          `${Math.min(99, Math.round(t.progress * 100))}%`,
                          t.speed ? `${t.speed.toFixed(1)}×` : '',
                          left >= 1 ? tr('about {0} left', formatTime(left)) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t.status === 'done'
                        ? [tr('Done'), t.size ? formatBytes(t.size) : ''].filter(Boolean).join(' · ')
                        : t.status === 'failed'
                          ? t.error
                          : tr('Cancelled')}
                </small>
              </span>
              <span className="rx-task-actions">
                {t.status === 'done' && (
                  <button className="icon-btn" onClick={() => onPlay(t.output, kind)} aria-label={tr('Play')} title={tr('Play')}>
                    <Play size={14} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  onClick={() => act(() => api.cancelConvert(t.id))}
                  aria-label={t.status === 'queued' || t.status === 'running' ? tr('Cancel') : tr('Remove')}
                  title={t.status === 'queued' || t.status === 'running' ? tr('Cancel') : tr('Remove')}
                >
                  <X size={14} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
