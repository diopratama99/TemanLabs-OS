import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Download, FolderOpen, Image, LayoutGrid, LoaderCircle, MonitorSmartphone, Music, Play, RotateCcw, Server, Settings2, Trash2, X } from 'lucide-react'
import { api } from '../api'
import type { DownloadItem, DownloadMode, Downloads } from '../api/types'
import { OpenDialog } from '../components/code/OpenDialog'
import { MediaToolsGate } from '../components/MediaTools'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { formatFileDate } from '../lib/format'
import { tr } from '../lib/i18n'
import { useMobileBack } from '../lib/mobileBack'
import type { MediaKind } from '../lib/media'
import { displayName, parentOf } from '../lib/paths'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { MediaBrowser } from './DownloaderBrowse'
import { DownloaderSettings } from './DownloaderSettings'

const QUALITIES = [
  { id: 'best', label: tr('Best') },
  { id: '2160', label: '4K' },
  { id: '1440', label: '1440p' },
  { id: '1080', label: '1080p' },
  { id: '720', label: '720p' },
  { id: '480', label: '480p' },
]

const MODES: { id: DownloadMode; label: string }[] = [
  { id: 'video', label: tr('Video') },
  { id: 'audio', label: tr('Audio only') },
  { id: 'photos', label: tr('Photos') },
]

const DEVICE_KEY = 'downloader.device'

const kindOf = (file: string): MediaKind | null => {
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mkv', 'webm', 'mov', 'm4v', 'ts'].includes(ext)) return 'video'
  if (['mp3', 'm4a', 'opus', 'flac', 'wav', 'ogg'].includes(ext)) return 'audio'
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) return 'image'
  return null
}

// Up to this much is fetched by the page itself and then saved, so a download manager doesn't
// take the link over; anything bigger goes as a plain link, rather than fill the memory.
const IN_PAGE_LIMIT = 1.5 * 1024 ** 3

function clickToSave(href: string, name: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
}

const saveByLink = (it: DownloadItem) => clickToSave(api.downloadFileUrl(it.id), '')

// The name the server gives the file, as in: attachment; filename*=utf-8''…
function fileNameOf(disposition: string | null) {
  const star = disposition && /filename\*=utf-8''([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // Not encoded as it should be; try the plain one.
    }
  }
  const plain = disposition && /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1] : 'download'
}

/** Fetches a finished download into the page and saves it on this device, saying how far it is (0–1, or null when the size isn't known). */
async function fetchToDevice(it: DownloadItem, onProgress: (done: number | null) => void) {
  const res = await fetch(api.downloadFileUrl(it.id), { credentials: 'same-origin' })
  if (!res.ok) {
    let message = res.statusText
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      // Not JSON; keep the status text.
    }
    throw new Error(message)
  }
  const total = Number(res.headers.get('Content-Length')) || 0
  if (!res.body || total > IN_PAGE_LIMIT) {
    void res.body?.cancel()
    saveByLink(it)
    return
  }
  const reader = res.body.getReader()
  const chunks: BlobPart[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value as BlobPart)
    got += value.length
    if (got > IN_PAGE_LIMIT) {
      await reader.cancel()
      saveByLink(it)
      return
    }
    onProgress(total ? got / total : null)
  }
  const url = URL.createObjectURL(new Blob(chunks, { type: res.headers.get('Content-Type') ?? 'application/octet-stream' }))
  clickToSave(url, fileNameOf(res.headers.get('Content-Disposition')))
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

interface Props {
  onOpenMedia: (path: string, kind: MediaKind) => void
  onShowInFiles: (folder: string) => void
}

/** Downloader: save videos, sound or photos from a link. */
export function Downloader(props: Props) {
  return (
    <div className="dlr">
      <MediaToolsGate
        icon={<Download size={44} strokeWidth={1.3} />}
        title={tr('Save videos and photos from a link')}
        text={tr('Paste a link from YouTube, Instagram, X, TikTok, Facebook, Reddit or hundreds of other sites, and it’s saved on the server or on this device: the video in the quality you pick, just the sound, or the photos of a post.')}
      >
        <DownloaderMain {...props} />
      </MediaToolsGate>
    </div>
  )
}

function DownloaderMain({ onOpenMedia, onShowInFiles }: Props) {
  const [data, setData] = useState<Downloads | null>(null)
  const [links, setLinks] = useState('')
  const [mode, setMode] = useState<DownloadMode>('video')
  const [quality, setQuality] = useState('1080')
  const [playlist, setPlaylist] = useState(false)
  const [device, setDeviceState] = useState(() => {
    try {
      return localStorage.getItem(DEVICE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [settings, setSettings] = useState(false)
  const [choosingFolder, setChoosingFolder] = useState(false)
  const [browsing, setBrowsing] = useState<string | null>(null)
  // On a phone, back from choosing items returns to the form.
  useMobileBack(() => {
    if (!browsing) return false
    setBrowsing(null)
    return true
  })
  const { show } = useContextMenu()
  // Downloads being saved on this device now, and how far (null: size not known).
  const [saving, setSaving] = useState<Record<string, number | null>>({})
  const saveToDevice = (it: DownloadItem) => {
    if (it.id in saving) return
    setSaving(s => ({ ...s, [it.id]: 0 }))
    fetchToDevice(it, done => setSaving(s => ({ ...s, [it.id]: done })))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() =>
        setSaving(s => {
          const next = { ...s }
          delete next[it.id]
          return next
        }),
      )
  }

  const setDevice = (on: boolean) => {
    setDeviceState(on)
    try {
      localStorage.setItem(DEVICE_KEY, on ? '1' : '0')
    } catch {
      // Remembered for this time only.
    }
  }

  const load = useCallback(() => api.downloads().then(setData, e => setError(e instanceof Error ? e.message : String(e))), [])
  const busy = data?.items.some(i => i.status === 'running' || i.status === 'queued')
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), busy ? 1000 : 5000)
    return () => clearInterval(timer)
  }, [load, busy])

  // Downloads for this device that finish while the window is open go straight to the browser.
  const waiting = useRef(new Set<string>())
  useEffect(() => {
    for (const it of data?.items ?? []) {
      if (!it.device) continue
      if (it.status === 'queued' || it.status === 'running') waiting.current.add(it.id)
      else if (waiting.current.delete(it.id) && it.status === 'done' && it.files.length) saveToDevice(it)
    }
  }, [data])

  const urls = links
    .split(/\s+/)
    .map(l => l.trim())
    .filter(l => /^https?:\/\//i.test(l))
  const add = async () => {
    setAdding(true)
    setError(null)
    try {
      await api.addDownloads({ urls, mode, quality, playlist, folder: '', device })
      setLinks('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }
  const act = (fn: () => Promise<unknown>) => void fn().then(load, e => setError(e instanceof Error ? e.message : String(e)))
  const chooseFolder = (folder: string) => act(() => api.setDownloadFolder(folder))

  const itemMenu = (e: React.MouseEvent, it: DownloadItem) => {
    e.preventDefault()
    const onServer = !it.device && it.files.length > 0
    show(e, [
      ...(it.device && it.status === 'done' && it.files.length ? [{ label: tr('Save to This Device'), icon: Download, onSelect: () => saveToDevice(it) }] : []),
      ...(onServer ? [{ label: tr('Show in Files'), icon: FolderOpen, onSelect: () => onShowInFiles(parentOf(it.files[0])) }] : []),
      ...(onServer ? [{ label: tr('Download to This Device'), icon: MonitorSmartphone, onSelect: () => saveToDevice(it) }] : []),
      { label: tr('Copy Link'), icon: Download, onSelect: () => void copyText(it.url) },
      ...(it.status === 'failed' || it.status === 'canceled' ? [{ label: tr('Try Again'), icon: RotateCcw, onSelect: () => act(() => api.downloadAction(it.id, 'retry')) }] : []),
      'separator',
      { label: tr('Remove from List'), icon: X, onSelect: () => act(() => api.removeDownload(it.id)) },
      ...(onServer
        ? [{ label: tr('Delete the Files Too'), icon: Trash2, danger: true, confirm: tr('Click Again to Delete'), onSelect: () => act(() => api.removeDownload(it.id, true)) }]
        : []),
    ])
  }

  if (browsing)
    return (
      <MediaBrowser
        url={browsing}
        mode={mode}
        quality={quality}
        qualities={QUALITIES}
        device={device}
        onBack={() => setBrowsing(null)}
        onQueued={() => {
          setBrowsing(null)
          setLinks('')
          void load()
        }}
      />
    )

  return (
    <>
      <WindowToolbar>
        <ToolbarTitle title={tr('Downloader')} subtitle={device ? tr('To this device') : data?.folder} />
        <span className="tb-spacer" />
        <div className="tb-group">
          <button className="tb-btn" onClick={() => setSettings(true)} aria-label={tr('Settings')} title={tr('Settings')}>
            <Settings2 size={15} />
          </button>
        </div>
      </WindowToolbar>
      <div className="dlr-body">
        <form
          className="group dlr-form"
          onSubmit={e => {
            e.preventDefault()
            if (urls.length) void add()
          }}
        >
          <textarea
            value={links}
            onChange={e => setLinks(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && urls.length && (e.preventDefault(), void add())}
            placeholder={tr('Paste links here, one or more (YouTube, Instagram, X, TikTok…)')}
            rows={2}
            spellCheck={false}
            autoFocus
          />
          <div className="dlr-options">
            <div className="segmented" role="radiogroup" aria-label={tr('What to save')}>
              {MODES.map(m => (
                <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'is-active' : ''} onClick={() => setMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            {mode === 'video' && (
              <select value={quality} onChange={e => setQuality(e.target.value)} aria-label={tr('Quality')}>
                {QUALITIES.map(q => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            )}
            <label className="dlr-check">
              <input type="checkbox" checked={playlist} onChange={e => setPlaylist(e.target.checked)} /> {tr('Whole playlist or profile')}
            </label>
          </div>
          <div className="dlr-options">
            <span className="dlr-label">{tr('Save to')}</span>
            <div className="segmented" role="radiogroup" aria-label={tr('Save to')}>
              <button type="button" role="radio" aria-checked={!device} className={!device ? 'is-active' : ''} onClick={() => setDevice(false)}>
                <Server size={12} /> {tr('Server')}
              </button>
              <button type="button" role="radio" aria-checked={device} className={device ? 'is-active' : ''} onClick={() => setDevice(true)}>
                <MonitorSmartphone size={12} /> {tr('This Device')}
              </button>
            </div>
            {!device && data && (
              <button type="button" className="dlr-folder" onClick={() => setChoosingFolder(true)} title={data.folder}>
                <FolderOpen size={13} /> {displayName(data.folder)}
              </button>
            )}
            <span className="tb-spacer" />
            <button
              type="button"
              className="btn"
              disabled={urls.length !== 1}
              onClick={() => setBrowsing(urls[0])}
              title={tr('See what’s on a profile, channel or playlist and choose what to save')}
            >
              <LayoutGrid size={13} /> {tr('Choose Items…')}
            </button>
            <button className="btn btn-primary" disabled={!urls.length || adding}>
              {adding ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />} {urls.length > 1 ? tr('Download {0}', urls.length) : tr('Download')}
            </button>
          </div>
          {device && <p className="dlr-note">{tr('The server fetches it, then this browser saves it on this device. It waits on the server a day at most.')}</p>}
        </form>
        {error && <p className="form-error">{error}</p>}

        <div className="dlr-head">
          <h4 className="bk-heading">{tr('Downloads')}</h4>
          {!!data?.items.some(i => i.status !== 'queued' && i.status !== 'running') && (
            <button className="btn" onClick={() => act(() => api.clearDownloads())}>
              {tr('Clear Finished')}
            </button>
          )}
        </div>
        <div className="group">
          {!data ? (
            <div className="row">
              <span>{tr('Loading…')}</span>
            </div>
          ) : data.items.length === 0 ? (
            <div className="row">
              <span className="dlr-empty">{tr('Nothing yet. Paste a link above.')}</span>
            </div>
          ) : (
            data.items.map(it => <DownloadRow key={it.id} it={it} onMenu={e => itemMenu(e, it)} onOpenMedia={onOpenMedia} onShowInFiles={onShowInFiles} onAct={act} saving={it.id in saving ? saving[it.id] : undefined} onSave={() => saveToDevice(it)} />)
          )}
        </div>
      </div>
      {settings && data && <DownloaderSettings data={data} onClose={() => setSettings(false)} onChanged={load} />}
      {choosingFolder && data && (
        <OpenDialog
          mode="folder"
          title={tr('Save Downloads To')}
          startDir={data.folder}
          confirmLabel={tr('Choose')}
          hint={name => tr('Saves into “{0}”', name)}
          canCreate
          onOpen={path => {
            setChoosingFolder(false)
            if (path !== data.folder) chooseFolder(path)
          }}
          onCancel={() => setChoosingFolder(false)}
        />
      )}
    </>
  )
}

function DownloadRow({
  it,
  onMenu,
  onOpenMedia,
  onShowInFiles,
  onAct,
  saving,
  onSave,
}: {
  it: DownloadItem
  onMenu: (e: React.MouseEvent) => void
  onOpenMedia: Props['onOpenMedia']
  onShowInFiles: Props['onShowInFiles']
  onAct: (fn: () => Promise<unknown>) => void
  /** Being saved on this device: how far (null: size not known); undefined when not. */
  saving?: number | null
  onSave: () => void
}) {
  const first = it.files[0]
  const kind = first ? kindOf(first) : null
  const Icon = it.mode === 'audio' ? Music : kind === 'image' || it.mode === 'photos' || it.mode === 'files' ? Image : Play
  const running = it.status === 'running'
  const ready = it.status === 'done' && it.files.length > 0
  const status =
    saving !== undefined
      ? saving === null
        ? tr('Saving on this device…')
        : tr('Saving on this device… {0}%', Math.round(saving * 100))
      : it.status === 'queued'
      ? tr('Waiting…')
      : running
        ? [
            it.mode === 'files' && it.count ? tr('{0} of {1}', Math.min(it.count, Math.round((it.percent / 100) * it.count)), it.count) : `${Math.round(it.percent)}%`,
            it.size,
            it.speed,
            it.eta && tr('{0} left', it.eta),
          ]
            .filter(Boolean)
            .join(' · ')
        : it.status === 'done'
          ? [
              it.files.length > 1 ? tr('{0} files', it.files.length) : null,
              it.size,
              it.device ? (it.expired ? tr('removed from the server after a day') : tr('ready for this device for a day')) : it.finished && formatFileDate(it.finished),
            ]
              .filter(Boolean)
              .join(' · ')
          : it.status === 'canceled'
            ? tr('Stopped')
            : it.error
  return (
    <div className={`row dlr-item is-${it.status}`} onContextMenu={onMenu}>
      <span className={`dlr-icon is-${it.mode === 'files' ? 'photos' : it.mode}`}>
        {it.status === 'failed' ? <CircleAlert size={16} /> : <Icon size={16} />}
        {it.device && (
          <i className="dlr-device" title={tr('For this device')}>
            <MonitorSmartphone size={9} />
          </i>
        )}
      </span>
      <span className="dlr-main">
        <strong title={it.url}>{it.title || it.url}</strong>
        <small>
          {[it.site, it.uploader].filter(Boolean).join(' · ')}
          {status ? ` — ${status}` : ''}
        </small>
        {running && (
          <span className="dlr-bar">
            <i style={{ width: `${Math.max(2, it.percent)}%` }} />
          </span>
        )}
      </span>
      <span className="dlr-actions">
        {ready && it.device && (
          <button className="icon-btn" disabled={saving !== undefined} onClick={onSave} aria-label={tr('Save to This Device')} title={tr('Save to This Device')}>
            {saving !== undefined ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
          </button>
        )}
        {ready && !it.device && kind && (
          <button className="icon-btn" onClick={() => onOpenMedia(first, kind)} aria-label={tr('Open')} title={tr('Open')}>
            <Play size={14} />
          </button>
        )}
        {ready && !it.device && (
          <button className="icon-btn" onClick={() => onShowInFiles(parentOf(first))} aria-label={tr('Show in Files')} title={tr('Show in Files')}>
            <FolderOpen size={14} />
          </button>
        )}
        {(it.status === 'failed' || it.status === 'canceled') && (
          <button className="icon-btn" onClick={() => onAct(() => api.downloadAction(it.id, 'retry'))} aria-label={tr('Try Again')} title={tr('Try Again')}>
            <RotateCcw size={14} />
          </button>
        )}
        {(running || it.status === 'queued') && (
          <button className="icon-btn" onClick={() => onAct(() => api.downloadAction(it.id, 'cancel'))} aria-label={tr('Stop')} title={tr('Stop')}>
            <X size={14} />
          </button>
        )}
      </span>
    </div>
  )
}
