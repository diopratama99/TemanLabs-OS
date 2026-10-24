import { useEffect, useState, type ReactNode } from 'react'
import { Copy, LoaderCircle } from 'lucide-react'
import { api } from '../api'
import type { FileDetails } from '../api/types'
import { copyText } from '../lib/clipboard'
import { formatBytes } from '../lib/format'
import { language, tr } from '../lib/i18n'
import { formatTime } from '../lib/media'
import { parentOf } from '../lib/paths'
import { KIND_COLOR, KIND_ICON } from '../lib/fileKinds'

const KIND_NAME: Record<string, string> = {
  folder: tr('Folder'),
  image: tr('Picture'),
  video: tr('Video'),
  audio: tr('Audio'),
  code: tr('Code'),
  archive: tr('Archive'),
  document: tr('Document'),
}

const locale = language === 'id' ? 'id-ID' : 'en-GB'
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' }) : '—')
const count = (n: number) => n.toLocaleString(locale)

// rwx for one of owner / group / everyone, in words.
function access(rwx: string) {
  const read = rwx[0] === 'r'
  const write = rwx[1] === 'w'
  const run = rwx[2] === 'x' || rwx[2] === 's' || rwx[2] === 't'
  const base = read && write ? tr('Read & Write') : read ? tr('Read only') : write ? tr('Write only') : tr('No access')
  return run && (read || write) ? `${base} · ${tr('can run')}` : base
}

const channels = (n?: number) => (n === 1 ? tr('Mono') : n === 2 ? tr('Stereo') : n === 6 ? '5.1' : n === 8 ? '7.1' : n ? tr('{0} channels', n) : '')

interface Props {
  path: string
  /** Gives the window its title once the name is known. */
  onTitle?: (title: string) => void
}

/** Get Info: the content of a window about one file or folder. */
export function FileInfo({ path, onTitle }: Props) {
  const [info, setInfo] = useState<FileDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [thumbBroken, setThumbBroken] = useState(false)

  useEffect(() => {
    let alive = true
    setInfo(null)
    setError(null)
    api.fileInfo(path).then(
      d => alive && setInfo(d),
      (err: Error) => alive && setError(err.message),
    )
    return () => {
      alive = false
    }
  }, [path])

  const name = info?.name ?? (path.slice(path.lastIndexOf('/') + 1) || '/')
  useEffect(() => {
    onTitle?.(tr('{0} Info', name))
  }, [name])

  const perms = info?.mode.slice(-9) ?? ''
  const m = info?.media
  const kind = info ? (KIND_NAME[info.kind] ?? info.kind) + (info.mime && !info.folder ? ` (${info.mime})` : '') : ''
  const volumeName = (mount: string) => (mount === '/' ? tr('System') : mount.slice(mount.lastIndexOf('/') + 1) || mount)

  return (
    <div className="fi" aria-label={tr('Info about {0}', name)}>
      <div className="fi-body">
        <div className="fi-hero">
          <div className="fi-preview">{preview()}</div>
          <strong className="fi-name">{name}</strong>
          {info && (
            <small>
              {KIND_NAME[info.kind] ?? info.kind} · {info.folder ? (info.total !== undefined ? formatBytes(info.total) : '—') : formatBytes(info.size)}
            </small>
          )}
        </div>

        {error && <p className="fi-error">{error}</p>}
        {!info && !error && (
          <p className="fi-loading">
            <LoaderCircle size={14} className="spin" /> {tr('Reading…')}
          </p>
        )}

        {info && (
          <>
            <Section title={tr('General')}>
              <Row label={tr('Kind')}>{kind}</Row>
              {info.folder ? (
                <>
                  <Row label={tr('Size')}>
                    {info.total !== undefined
                      ? `${info.partial ? tr('at least') + ' ' : ''}${formatBytes(info.total)} · ${(info.files === 1 ? tr('1 file') : tr('{0} files', count(info.files ?? 0)))}`
                      : '—'}
                  </Row>
                  <Row label={tr('Contains')}>{info.items === 1 ? tr('1 item') : tr('{0} items', count(info.items ?? 0))}</Row>
                </>
              ) : (
                <Row label={tr('Size')}>
                  {formatBytes(info.size)} <small>({tr('{0} bytes', count(info.size))})</small>
                </Row>
              )}
              <Row label={tr('Where')}>
                <span className="fi-path">{parentOf(info.path)}</span>
              </Row>
              {info.link && <Row label={tr('Points to')}>{info.link}</Row>}
              {info.volume && (
                <Row label={tr('On')}>
                  {volumeName(info.volume.mount)} ({info.volume.fstype}) · {tr('{0} free of {1}', formatBytes(info.volume.free), formatBytes(info.volume.size))}
                </Row>
              )}
              <Row label={tr('Created')}>{info.created ? when(info.created) : tr('Not recorded')}</Row>
              <Row label={tr('Modified')}>{when(info.modified)}</Row>
              <Row label={tr('Last opened')}>{when(info.accessed)}</Row>
            </Section>

            {m && (
              <Section title={tr('More Info')}>
                {m.width && m.height ? <Row label={tr('Dimensions')}>{`${m.width} × ${m.height}`}</Row> : null}
                {m.duration ? <Row label={tr('Duration')}>{formatTime(m.duration)}</Row> : null}
                {m.video && <Row label={tr('Video')}>{[m.video, m.fps ? `${m.fps} fps` : ''].filter(Boolean).join(' · ')}</Row>}
                {m.audio && <Row label={tr('Audio')}>{[m.audio, channels(m.channels)].filter(Boolean).join(' · ')}</Row>}
                {m.bitrate ? <Row label={tr('Bitrate')}>{m.bitrate >= 1e6 ? `${(m.bitrate / 1e6).toFixed(1)} Mbit/s` : `${Math.round(m.bitrate / 1e3)} kbit/s`}</Row> : null}
              </Section>
            )}

            <Section title={tr('Sharing & Permissions')}>
              <Row label={info.owner || String(info.uid)}>
                {access(perms.slice(0, 3))} <small>{tr('(owner)')}</small>
              </Row>
              <Row label={info.group || String(info.gid)}>
                {access(perms.slice(3, 6))} <small>{tr('(group)')}</small>
              </Row>
              <Row label={tr('Everyone')}>{access(perms.slice(6, 9))}</Row>
              <Row label={tr('Mode')}>
                <code>
                  {info.octal} · {info.mode}
                </code>
              </Row>
            </Section>

            <button className="btn fi-copy" onClick={() => void copyText(info.path)}>
              <Copy size={13} /> {tr('Copy Path')}
            </button>
          </>
        )}
      </div>
    </div>
  )

  // A thumbnail for photos and videos, else the kind's icon.
  function preview() {
    if (!info) return null
    if ((info.kind === 'image' || info.kind === 'video') && !thumbBroken) {
      const url = api.thumbUrl(info.path, `${info.size}-${info.modified}`)
      if (url) return <img className="fi-thumb" src={url} alt="" onError={() => setThumbBroken(true)} draggable={false} />
    }
    const Icon = KIND_ICON[info.kind] ?? KIND_ICON.document
    const color = KIND_COLOR[info.kind] ?? KIND_COLOR.document
    return <Icon size={80} strokeWidth={1.1} color={color} fill={color} fillOpacity={0.16} />
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fi-section">
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}
