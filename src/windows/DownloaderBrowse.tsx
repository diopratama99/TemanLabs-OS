import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  CircleDashed,
  CircleDot,
  Clapperboard,
  Download,
  Grid3x3,
  Image,
  Images,
  Layers,
  LoaderCircle,
  MessageSquareText,
  Play,
  Radio,
  Repeat2,
  Smartphone,
  SquareUser,
  Video,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { api, ApiError } from '../api'
import { useMediaTools } from '../components/MediaTools'
import type { BrowseEntry, BrowseList, DownloadMode } from '../api/types'
import { tr } from '../lib/i18n'
import { SHELL } from '../lib/shell'
import { formatTime } from '../lib/media'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

interface Props {
  url: string
  mode: DownloadMode
  quality: string
  qualities: { id: string; label: string }[]
  device: boolean
  onBack: () => void
  onQueued: () => void
}

// A profile's tabs, named and drawn as the sites do.
const TABS: Record<string, { label: string; icon: LucideIcon }> = {
  posts: { label: tr('Posts'), icon: Grid3x3 },
  reels: { label: tr('Reels'), icon: Clapperboard },
  stories: { label: tr('Stories'), icon: CircleDashed },
  highlights: { label: tr('Highlights'), icon: CircleDot },
  tagged: { label: tr('Tagged'), icon: SquareUser },
  media: { label: tr('Media'), icon: Images },
  tweets: { label: tr('Posts'), icon: MessageSquareText },
  reposts: { label: tr('Reposts'), icon: Repeat2 },
  video: { label: tr('Videos'), icon: Video },
  videos: { label: tr('Videos'), icon: Video },
  shorts: { label: tr('Shorts'), icon: Smartphone },
  streams: { label: tr('Live'), icon: Radio },
  photos: { label: tr('Photos'), icon: Images },
  photos_albums: { label: tr('Albums'), icon: Layers },
}

// The pick that stands for the profile's own picture.
const AVATAR = -1

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/** What's on a profile, channel or playlist, tab by tab as the site shows it, to choose what to save. */
export function MediaBrowser({ url, mode: startMode, quality: startQuality, qualities, device, onBack, onQueued }: Props) {
  // One list per tab ('' for a link without tabs), and what's chosen in each, by list.
  const [lists, setLists] = useState<Record<string, BrowseList>>({})
  const [tab, setTab] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // A fix the server offers for the failure, as "galleryDev".
  const [fix, setFix] = useState<string | undefined>()
  const [picked, setPicked] = useState<Record<string, Set<number>>>({})
  const [last, setLast] = useState<number | null>(null)
  const [show, setShow] = useState<'all' | 'video' | 'image'>('all')
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<DownloadMode>(startMode === 'audio' ? 'audio' : 'video')
  const [quality, setQuality] = useState(startQuality)
  const [queueing, setQueueing] = useState(false)

  const load = (want: string | undefined, more?: BrowseList) => {
    setLoading(true)
    setError(null)
    setFix(undefined)
    api
      .browseDownloads({ url, tab: want, list: more?.id })
      .then(
        res => {
          const key = res.tab ?? ''
          setLists(ls => ({ ...ls, [key]: res }))
          setTab(t => (t === null || t === key ? key : t))
        },
        e => {
          setError(e instanceof Error ? e.message : String(e))
          setFix(e instanceof ApiError ? e.fix : undefined)
        },
      )
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const shownError = fix === 'galleryDev' ? tr('Instagram changed how profiles load, and this version of gallery-dl hasn’t caught up yet. Its development version has the fix.') : error
  const list = tab !== null ? lists[tab] : undefined
  // Who it is, from whichever tab came first.
  const head = list ?? Object.values(lists)[0]
  const entries = useMemo(() => list?.entries ?? [], [list])
  const chosen = list ? (picked[list.id] ?? new Set<number>()) : new Set<number>()
  const total = Object.values(picked).reduce((n, s) => n + s.size, 0)
  const avatarPicked = !!head && !!picked[head.id]?.has(AVATAR)
  const toggleAvatar = () => {
    if (!head) return
    const next = new Set(picked[head.id] ?? [])
    if (next.has(AVATAR)) next.delete(AVATAR)
    else next.add(AVATAR)
    setPicked(p => ({ ...p, [head.id]: next }))
  }

  const groups = useMemo(() => {
    const n = new Map<string, number>()
    for (const e of entries) if (e.group) n.set(e.group, (n.get(e.group) ?? 0) + 1)
    return n
  }, [entries])
  const kinds = new Set(entries.map(e => e.kind))
  const visible = entries.filter(e => show === 'all' || e.kind === show)
  const allPicked = visible.length > 0 && visible.every(e => chosen.has(e.index))
  // Videos saved in a quality of choice: show the choice when any are chosen.
  const pickedPages = Object.entries(picked).some(([id, set]) => {
    const l = Object.values(lists).find(x => x.id === id)
    return l?.entries.some(e => e.page && set.has(e.index))
  })

  const setChosen = (next: Set<number>) => list && setPicked(p => ({ ...p, [list.id]: next }))
  const toggle = (e: BrowseEntry, range: boolean) => {
    const next = new Set(chosen)
    const on = !chosen.has(e.index)
    if (range && last !== null) {
      // Shift-click: everything between the last one clicked and this one.
      const a = visible.findIndex(v => v.index === last)
      const b = visible.findIndex(v => v.index === e.index)
      if (a >= 0 && b >= 0) for (const v of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? next.add(v.index) : next.delete(v.index)
    } else if (on) next.add(e.index)
    else next.delete(e.index)
    setChosen(next)
    setLast(e.index)
  }
  const pickAll = () => {
    const next = new Set(chosen)
    for (const v of visible) allPicked ? next.delete(v.index) : next.add(v.index)
    setChosen(next)
  }
  const openTab = (t: string) => {
    setTab(t)
    setShow('all')
    setLast(null)
    if (!lists[t]) load(t)
  }
  const queue = async () => {
    setQueueing(true)
    setError(null)
    try {
      for (const [id, set] of Object.entries(picked)) {
        if (set.size) await api.pickDownloads(id, { picks: [...set].sort((a, b) => a - b), mode, quality, device })
      }
      onQueued()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setQueueing(false)
    }
  }

  const thumbKey = (l: BrowseList, i: number | 'avatar') => `${l.id}:${i}`
  const failed = (key: string) => setBroken(b => new Set(b).add(key))

  return (
    <div className="dlb" onKeyDown={e => e.key === 'Escape' && onBack()}>
      <WindowToolbar>
        <div className="tb-group dlb-nav">
          <button className="tb-btn" onClick={onBack} aria-label={tr('Back')} title={tr('Back')}>
            <ChevronLeft size={17} />
          </button>
        </div>
        <ToolbarTitle title={!head ? tr('Opening…') : head.handle || head.tabs?.length ? tr('Choose What to Save') : head.title} subtitle={head ? head.site : url} />
      </WindowToolbar>

      {!head ? (
        <div className="dlb-state">
          {loading ? (
            <>
              <LoaderCircle size={22} className="spin" />
              <p>{tr('Looking at what’s there…')}</p>
            </>
          ) : (
            <>
              <p className="form-error" title={error ?? undefined}>{shownError}</p>
              <span className="dlb-state-actions">
                <button className="btn" onClick={onBack}>
                  {tr('Back')}
                </button>
                {fix !== 'galleryDev' && (
                  <button className="btn btn-primary" onClick={() => load(undefined)}>
                    {tr('Try Again')}
                  </button>
                )}
              </span>
              {fix === 'galleryDev' && <GalleryDevFix onDone={() => load(undefined)} />}
            </>
          )}
        </div>
      ) : (
        <>
          {(head.tabs?.length || head.handle) && (
            <div className="dlb-profile">
              <button
                type="button"
                className={`dlb-avatar ${avatarPicked ? 'is-picked' : ''}`}
                disabled={!head.avatar}
                onClick={toggleAvatar}
                aria-pressed={avatarPicked}
                title={head.avatar ? tr('Save the profile picture too') : undefined}
              >
                {head.avatar && !broken.has(thumbKey(head, 'avatar')) ? (
                  <img src={api.browseThumbUrl(head.id, 'avatar')} alt="" draggable={false} onError={() => failed(thumbKey(head, 'avatar'))} />
                ) : (
                  <b>{(head.title || head.handle || '?').replace('@', '').slice(0, 1).toUpperCase()}</b>
                )}
                {avatarPicked && (
                  <span className="dlb-avatar-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </button>
              <span className="dlb-who">
                <strong>{head.title}</strong>
                <small>
                  {[head.handle, head.site, head.followers ? tr('{0} followers', compact(head.followers)) : null].filter(Boolean).join(' · ')}
                </small>
              </span>
              {head.avatar && (
                <button type="button" className={`dlb-avatar-pick ${avatarPicked ? 'is-on' : ''}`} onClick={toggleAvatar} aria-pressed={avatarPicked}>
                  {avatarPicked ? <Check size={13} strokeWidth={2.5} /> : <Image size={13} />} {tr('Profile Picture')}
                </button>
              )}
            </div>
          )}
          {!!head.tabs?.length && (
            <div className="dlb-tabs" role="tablist">
              {head.tabs.map(t => {
                const info = TABS[t] ?? { label: t, icon: Grid3x3 }
                const Icon = info.icon
                const n = lists[t] ? [...(picked[lists[t].id] ?? [])].filter(i => i !== AVATAR).length : 0
                return (
                  <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => openTab(t)}>
                    <Icon size={14} /> {info.label}
                    {n > 0 && <i className="dlb-tab-count">{n}</i>}
                  </button>
                )
              })}
            </div>
          )}

          <div className="dlb-bar">
            {kinds.size > 1 && (
              <div className="segmented" role="radiogroup" aria-label={tr('Show')}>
                {(['all', 'video', 'image'] as const).map(k => (
                  <button key={k} type="button" role="radio" aria-checked={show === k} className={show === k ? 'is-active' : ''} onClick={() => setShow(k)}>
                    {k === 'all' ? tr('All') : k === 'video' ? tr('Videos') : tr('Photos')}
                  </button>
                ))}
              </div>
            )}
            <span className="dlb-count">{list ? tr('{0} items', entries.length) + (list.more ? '+' : '') : ''}</span>
            <span className="tb-spacer" />
            <span className="dlb-count">{total ? tr('{0} chosen', total) : SHELL === 'mobile' ? tr('Tap to choose') : tr('Click to choose; Shift-click for a run of them')}</span>
            <button className="btn" onClick={pickAll} disabled={!visible.length}>
              {allPicked ? tr('Choose None') : tr('Choose All')}
            </button>
          </div>

          <div className="dlb-body">
            {!list ? (
              <div className="dlb-state">
                {loading ? <LoaderCircle size={20} className="spin" /> : <p className="form-error" title={error ?? undefined}>{shownError}</p>}
                {!loading && tab && fix === 'galleryDev' && <GalleryDevFix onDone={() => load(tab)} />}
                {!loading && tab && fix !== 'galleryDev' && (
                  <button className="btn" onClick={() => load(tab)}>
                    {tr('Try Again')}
                  </button>
                )}
              </div>
            ) : visible.length === 0 ? (
              <p className="dlr-empty dlb-none">{tr('Nothing to save here.')}</p>
            ) : (
              <div className={`dlb-grid is-${list.shape}`}>
                {visible.map(e => {
                  const on = chosen.has(e.index)
                  const many = e.group ? (groups.get(e.group) ?? 0) : 0
                  const key = thumbKey(list, e.index)
                  return (
                    <button key={e.index} type="button" className={`dlb-tile ${on ? 'is-picked' : ''}`} onClick={ev => toggle(e, ev.shiftKey)} aria-pressed={on} title={e.title}>
                      <span className="dlb-pic">
                        {e.thumb && !broken.has(key) ? (
                          <img src={api.browseThumbUrl(list.id, e.index)} loading="lazy" alt="" draggable={false} onError={() => failed(key)} />
                        ) : (
                          <span className="dlb-noimg">{e.kind === 'video' ? <Play size={22} /> : <Image size={22} />}</span>
                        )}
                        <span className="dlb-check">{on && <Check size={13} strokeWidth={3} />}</span>
                        {many > 1 && (
                          <span className="dlb-many" title={tr('One of {0} in this post', many)}>
                            <Layers size={12} />
                          </span>
                        )}
                        {e.kind === 'video' && (
                          <span className="dlb-badge">
                            <Play size={9} fill="currentColor" />
                            {e.duration ? formatTime(e.duration) : null}
                          </span>
                        )}
                      </span>
                      {list.shape === 'wide' && <span className="dlb-title">{e.title}</span>}
                    </button>
                  )
                })}
              </div>
            )}
            {list?.more && (
              <div className="dlb-more">
                <button className="btn" disabled={loading} onClick={() => load(list.tab, list)}>
                  {loading ? <LoaderCircle size={13} className="spin" /> : null} {tr('Load More')}
                </button>
              </div>
            )}
          </div>

          <div className="dlb-foot">
            {pickedPages && (
              <>
                <div className="segmented" role="radiogroup" aria-label={tr('What to save')}>
                  {(['video', 'audio'] as const).map(m => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>
                      {m === 'video' ? tr('Video') : tr('Audio only')}
                    </button>
                  ))}
                </div>
                {mode === 'video' && (
                  <select value={quality} onChange={e => setQuality(e.target.value)} aria-label={tr('Quality')}>
                    {qualities.map(q => (
                      <option key={q.id} value={q.id}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            {error && list && <span className="form-error">{error}</span>}
            <span className="tb-spacer" />
            <span className="dlb-dest">{device ? tr('To this device') : tr('To the server')}</span>
            <button className="btn btn-primary" disabled={!total || queueing} onClick={() => void queue()}>
              {queueing ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />} {total ? tr('Download {0}', total) : tr('Download')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** The fix offered for a site gallery-dl's release can't read yet: its development version, then another try. */
function GalleryDevFix({ onDone }: { onDone: () => void }) {
  const { tools, install, busy, line, error } = useMediaTools()
  const [asked, setAsked] = useState(false)
  const on = !!tools?.galleryDev
  useEffect(() => {
    if (asked && !busy && on) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, busy, on])
  if (asked && (busy || on))
    return (
      <p className="dlb-fixing">
        <LoaderCircle size={14} className="spin" /> {line ?? tr('Getting gallery-dl’s development version…')}
      </p>
    )
  return (
    <div className="dlb-fix">
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={() => {
          setAsked(true)
          install({ galleryDev: true })
        }}
      >
        <Wrench size={13} /> {tr('Use the Development Version')}
      </button>
      {error && <p className="form-error">{error}</p>}
      <small>{tr('Takes a minute. It can be switched back in the Downloader’s settings.')}</small>
    </div>
  )
}
