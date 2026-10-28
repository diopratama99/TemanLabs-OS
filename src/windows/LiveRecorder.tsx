import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Circle, FolderOpen, LoaderCircle, MoreHorizontal, Pencil, Play, Plus, Radio, RefreshCw, Settings2, Square, Trash2, X } from 'lucide-react'
import { api } from '../api'
import type { RecChannel, Recorder, Recording } from '../api/types'
import { FolderField } from '../components/FolderField'
import { MediaToolsRow } from '../components/MediaTools'
import { Switch } from '../components/Switch'
import { useContextMenu } from '../lib/contextMenu'
import { formatBytes, formatFileDate } from '../lib/format'
import { tr } from '../lib/i18n'
import type { MediaKind } from '../lib/media'
import { parentOf } from '../lib/paths'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

const QUALITIES = [
  { id: 'best', label: tr('Best') },
  { id: '1080', label: '1080p' },
  { id: '720', label: '720p' },
  { id: '480', label: '480p' },
  { id: 'audio', label: tr('Audio only') },
]

const KEEP = [
  { days: 0, label: tr('Forever') },
  { days: 7, label: tr('7 days') },
  { days: 30, label: tr('30 days') },
  { days: 90, label: tr('90 days') },
]

const PLATFORM: Record<string, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick', tiktok: 'TikTok' }

function elapsed(from: string, to?: string) {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

interface Props {
  onOpenMedia: (path: string, kind: MediaKind) => void
  onShowInFiles: (folder: string) => void
  /** The Downloader's tabs, for the toolbar. */
  tabs?: ReactNode
}

/**
 * The Downloader's Live Streams tab: record channels from Twitch, YouTube, Kick, TikTok… when
 * they go live.
 */
export function RecorderMain({ onOpenMedia, onShowInFiles, tabs }: Props) {
  const [data, setData] = useState<Recorder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<RecChannel | 'new' | null>(null)
  const [settings, setSettings] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [, tick] = useState(0)
  const { show } = useContextMenu()

  const load = useCallback(() => api.recorder().then(setData, e => setError(e instanceof Error ? e.message : String(e))), [])
  const recording = data?.recordings.some(r => r.status === 'recording' || r.status === 'converting')
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), recording ? 3000 : 10000)
    return () => clearInterval(timer)
  }, [load, recording])
  // The running timers.
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [recording])

  const act = (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    void fn()
      .then(load, e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null))
  }
  const recOf = (c: RecChannel) => data?.recordings.find(r => r.id === c.recording)
  const nameOf = (id: string) => data?.channels.find(c => c.id === id)?.name ?? tr('Removed channel')

  const channelMenu = (e: React.MouseEvent, c: RecChannel) => {
    e.preventDefault()
    show(e, [
      { label: tr('Edit…'), icon: Pencil, onSelect: () => setEditing(c) },
      { label: tr('Check Now'), icon: RefreshCw, onSelect: () => act(c.id, () => api.channelAction(c.id, 'check')) },
      { label: tr('Open Channel Page'), icon: Play, onSelect: () => window.open(c.url, '_blank', 'noopener') },
      'separator',
      { label: tr('Remove Channel'), icon: Trash2, danger: true, confirm: tr('Click Again to Remove'), disabled: !!c.recording, onSelect: () => act(c.id, () => api.deleteChannel(c.id)) },
    ])
  }
  const recordingMenu = (e: React.MouseEvent, r: Recording) => {
    e.preventDefault()
    show(e, [
      { label: tr('Show in Files'), icon: FolderOpen, onSelect: () => onShowInFiles(parentOf(r.file)) },
      'separator',
      { label: tr('Remove from List'), icon: X, disabled: r.status === 'recording', onSelect: () => act(r.id, () => api.deleteRecording(r.id)) },
      { label: tr('Delete Recording'), icon: Trash2, danger: true, confirm: tr('Click Again to Delete'), disabled: r.status === 'recording' || r.status === 'converting', onSelect: () => act(r.id, () => api.deleteRecording(r.id, true)) },
    ])
  }

  return (
    <>
      <WindowToolbar>
        <ToolbarTitle title={tr('Downloader')} subtitle={data?.folder} />
        <span className="tb-spacer" />
        {tabs}
        <span className="tb-spacer" />
        <div className="tb-group">
          <button className="tb-btn" onClick={() => setEditing('new')} aria-label={tr('Add Channel')} title={tr('Add Channel')}>
            <Plus size={16} />
          </button>
          <button className="tb-btn" onClick={() => setSettings(true)} aria-label={tr('Settings')} title={tr('Settings')}>
            <Settings2 size={15} />
          </button>
        </div>
      </WindowToolbar>
      <div className="dlr-body">
        {error && <p className="form-error">{error}</p>}
        <h4 className="bk-heading">{tr('Channels')}</h4>
        {!data ? (
          <p className="empty">{tr('Loading…')}</p>
        ) : data.channels.length === 0 ? (
          <div className="group lr-empty">
            <p>{tr('No channels yet. Add one, and it’s recorded whenever it goes live.')}</p>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={13} /> {tr('Add Channel…')}
            </button>
          </div>
        ) : (
          <div className="lr-grid">
            {data.channels.map(c => {
              const rec = recOf(c)
              const state = rec ? 'recording' : c.live ? 'live' : 'offline'
              return (
                <div key={c.id} className={`group lr-card is-${state}`} onContextMenu={e => channelMenu(e, c)}>
                  <div className="lr-card-head">
                    <span className={`lr-platform is-${c.platform}`}>{PLATFORM[c.platform] ?? c.platform}</span>
                    <strong title={c.url}>{c.name}</strong>
                    <button className="icon-btn" onClick={e => channelMenu(e, c)} aria-label={tr('More')}>
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                  <div className="lr-state">
                    {state === 'recording' && rec ? (
                      <>
                        <span className="lr-dot is-rec" /> {rec.status === 'converting' ? tr('Saving as MP4…') : tr('Recording {0} · {1}', elapsed(rec.started), formatBytes(rec.bytes))}
                      </>
                    ) : state === 'live' ? (
                      <>
                        <span className="lr-dot is-live" /> {tr('Live now')}
                      </>
                    ) : (
                      <>
                        <span className="lr-dot" /> {c.checked ? tr('Offline · checked {0}', formatFileDate(c.checked)) : tr('Checking…')}
                      </>
                    )}
                  </div>
                  <p className="lr-title">{c.error ? <span className="form-error">{c.error}</span> : (c.live && c.title) || ' '}</p>
                  <div className="lr-card-foot">
                    <label className="lr-auto">
                      <Switch label={tr('Record when live')} checked={c.auto} onChange={v => act(c.id, () => api.updateChannel(c.id, { ...c, auto: v }))} />
                      <span>{tr('Record when live')}</span>
                    </label>
                    {rec ? (
                      <button className="btn" disabled={busy === c.id || rec.status === 'converting'} onClick={() => act(c.id, () => api.channelAction(c.id, 'stop'))}>
                        {busy === c.id ? <LoaderCircle size={12} className="spin" /> : <Square size={11} />} {tr('Stop')}
                      </button>
                    ) : (
                      <button className={`btn ${c.live ? 'btn-danger' : ''}`} disabled={busy === c.id || !c.live} onClick={() => act(c.id, () => api.channelAction(c.id, 'record'))}>
                        {busy === c.id ? <LoaderCircle size={12} className="spin" /> : <Circle size={11} fill="currentColor" />} {tr('Record')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <h4 className="bk-heading">{tr('Recordings')}</h4>
        <div className="group">
          {!data?.recordings.length ? (
            <div className="row">
              <span className="dlr-empty">{tr('Recordings show up here.')}</span>
            </div>
          ) : (
            data.recordings.map(r => (
              <div key={r.id} className={`row dlr-item is-${r.status}`} onContextMenu={e => recordingMenu(e, r)}>
                <span className={`dlr-icon ${r.status === 'recording' ? 'is-rec' : 'is-video'}`}>{r.status === 'recording' ? <Radio size={16} /> : <Play size={16} />}</span>
                <span className="dlr-main">
                  <strong title={r.file}>{r.title || r.file.split('/').pop()}</strong>
                  <small>
                    {nameOf(r.channel)} · {formatFileDate(r.started)} · {elapsed(r.started, r.ended)} · {formatBytes(r.bytes)}
                    {r.status === 'recording' ? ` — ${tr('recording')}` : r.status === 'converting' ? ` — ${tr('saving as MP4…')}` : ''}
                    {r.error ? ` — ${r.error}` : ''}
                  </small>
                </span>
                <span className="dlr-actions">
                  {r.status === 'done' && (
                    <button className="icon-btn" onClick={() => onOpenMedia(r.file, 'video')} aria-label={tr('Play')} title={tr('Play')}>
                      <Play size={14} />
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => onShowInFiles(parentOf(r.file))} aria-label={tr('Show in Files')} title={tr('Show in Files')}>
                    <FolderOpen size={14} />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      {editing && (
        <ChannelSheet
          channel={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
      {settings && data && <RecorderSettings data={data} onClose={() => setSettings(false)} onChanged={load} />}
    </>
  )
}

function ChannelSheet({ channel, onClose, onSaved }: { channel: RecChannel | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    url: channel?.url ?? '',
    name: channel?.name ?? '',
    quality: channel?.quality ?? 'best',
    auto: channel?.auto ?? true,
    keepDays: channel?.keepDays ?? 30,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }))
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (channel) await api.updateChannel(channel.id, form)
      else await api.addChannel(form)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  const title = channel ? tr('Edit “{0}”', channel.name) : tr('Add Channel')
  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci bk-sheet" role="dialog" aria-label={title} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{title}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <form
          className="ci-body cm-form bk-form"
          onSubmit={e => {
            e.preventDefault()
            void save()
          }}
        >
          <label>
            <span>{tr('Channel address')}</span>
            <input value={form.url} onChange={e => set({ url: e.target.value })} placeholder="https://www.twitch.tv/name" spellCheck={false} autoFocus={!channel} />
          </label>
          <p className="sl-help">{tr('Twitch, YouTube (youtube.com/@name), Kick, TikTok (tiktok.com/@name), and the other sites streamlink knows.')}</p>
          <label>
            <span>{tr('Name')}</span>
            <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder={tr('From the address')} />
          </label>
          <div className="bk-field">
            <span>{tr('Quality')}</span>
            <div className="segmented" role="radiogroup" aria-label={tr('Quality')}>
              {QUALITIES.map(q => (
                <button key={q.id} type="button" role="radio" aria-checked={form.quality === q.id} className={form.quality === q.id ? 'is-active' : ''} onClick={() => set({ quality: q.id })}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <label className="bk-check">
            <input type="checkbox" checked={form.auto} onChange={e => set({ auto: e.target.checked })} />
            <span>
              {tr('Record whenever it goes live')}
              <small>{tr('Checked every couple of minutes. Off: record only when you press Record.')}</small>
            </span>
          </label>
          <label>
            <span>{tr('Keep recordings')}</span>
            <select value={form.keepDays} onChange={e => set({ keepDays: Number(e.target.value) })}>
              {KEEP.map(k => (
                <option key={k.days} value={k.days}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="sl-actions">
            <button type="button" className="btn" onClick={onClose}>
              {tr('Cancel')}
            </button>
            <button className="btn btn-primary" disabled={saving || !form.url.trim()}>
              {saving ? <LoaderCircle size={14} className="spin" /> : null} {channel ? tr('Save') : tr('Add Channel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RecorderSettings({ data, onClose, onChanged }: { data: Recorder; onClose: () => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci bk-sheet" role="dialog" aria-label={tr('Live Recorder Settings')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{tr('Live Recorder Settings')}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body cm-form bk-form">
          <FolderField
            label={tr('Save recordings to')}
            title={tr('Save Recordings To')}
            value={data.folder}
            hint={name => tr('A folder per channel inside “{0}”', name)}
            onChoose={folder => {
              setError(null)
              setNote(null)
              void api.setRecorderFolder(folder).then(
                () => {
                  setNote(tr('Saved. Each channel gets a folder inside.'))
                  onChanged()
                },
                e => setError(e instanceof Error ? e.message : String(e)),
              )
            }}
          />
          <MediaToolsRow />
          {error && <p className="form-error">{error}</p>}
          {note && <p className="sl-copied">{note}</p>}
          <p className="sl-reach">{tr('Recordings carry on through a restart or update of TemanLabsOS. Record only what you may: respect creators’ rights and each site’s terms.')}</p>
        </div>
      </div>
    </div>
  )
}
