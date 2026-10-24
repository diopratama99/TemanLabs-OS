import { useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound, LoaderCircle, Trash2, Upload, X } from 'lucide-react'
import { api } from '../api'
import type { ShareLink } from '../api/types'
import { copyText } from '../lib/clipboard'
import { formatFileDate } from '../lib/format'
import { tr } from '../lib/i18n'

const DURATIONS = [
  { hours: 1, label: tr('1 hour') },
  { hours: 24, label: tr('1 day') },
  { hours: 24 * 7, label: tr('7 days') },
  { hours: 24 * 30, label: tr('30 days') },
  { hours: 0, label: tr('No end') },
]

/** The address a visitor opens: the public one if set, else this desktop's own. */
export const linkUrl = (base: string, id: string) => `${base || location.origin}/s/${id}`

export function linkStatus(l: ShareLink) {
  if (l.missing) return tr('The item is gone')
  if (l.expired) return tr('Expired')
  const until = l.expires ? tr('until {0}', formatFileDate(l.expires)) : tr('no end date')
  const used = l.upload ? tr('{0} files received', l.uploads) : tr('{0} downloads', l.downloads)
  return `${until} · ${used}`
}

/** One link: its address to copy, what it does, and a button to turn it off. */
export function ShareLinkRow({ link, base, onDelete, showName = false }: { link: ShareLink; base: string; onDelete: () => void; showName?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const url = linkUrl(base, link.id)
  const Icon = link.upload ? Upload : Download
  return (
    <div className={`sl-row ${link.expired || link.missing ? 'is-dead' : ''}`}>
      <Icon size={15} className="sl-kind" />
      <span className="sl-main">
        {showName && <strong>{link.name}</strong>}
        <code title={url}>{url}</code>
        <small>
          {link.hasPassword && <KeyRound size={11} />} {linkStatus(link)}
        </small>
      </span>
      <button
        className="icon-btn"
        disabled={link.expired || link.missing}
        onClick={() => {
          void copyText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        aria-label={tr('Copy Link')}
        title={tr('Copy Link')}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button
        className={`icon-btn ${confirm ? 'is-danger' : ''}`}
        onClick={() => (confirm ? onDelete() : setConfirm(true))}
        onBlur={() => setConfirm(false)}
        aria-label={tr('Turn Off Link')}
        title={confirm ? tr('Click again to turn it off') : tr('Turn Off Link')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

/** Share Link… / Request Files…: make a link for one file or folder, and see the ones it has. */
export function ShareLinkSheet({ path, name, upload, onClose }: { path: string; name: string; upload: boolean; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [base, setBase] = useState('')
  const [hours, setHours] = useState(24 * 7)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<string | null>(null)
  const load = () =>
    api.shareLinks().then(
      r => {
        setBase(r.baseUrl)
        setLinks(r.links.filter(l => l.path === path && l.upload === upload))
      },
      e => setError(e instanceof Error ? e.message : String(e)),
    )
  useEffect(() => {
    void load()
  }, [path, upload])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const link = await api.createShareLink({ path, upload, hours, password })
      // Copied straight away: making a link is almost always to paste it somewhere.
      void copyText(linkUrl(base, link.id))
      setMade(link.id)
      setPassword('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const title = upload ? tr('Request Files into “{0}”', name) : tr('Share “{0}”', name)

  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci sl-sheet" role="dialog" aria-label={title} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{title}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <form
          className="ci-body cm-form sl-form"
          onSubmit={e => {
            e.preventDefault()
            void create()
          }}
        >
          <p className="sl-help">
            {upload
              ? tr('Anyone with the link can send files into this folder, without signing in. They can’t see what’s already in it.')
              : tr('Anyone with the link can download this, without signing in.')}
          </p>
          <label>
            <span>{tr('Link works for')}</span>
            <div className="segmented" role="radiogroup" aria-label={tr('Link works for')}>
              {DURATIONS.map(d => (
                <button key={d.hours} type="button" role="radio" aria-checked={hours === d.hours} className={hours === d.hours ? 'is-active' : ''} onClick={() => setHours(d.hours)}>
                  {d.label}
                </button>
              ))}
            </div>
          </label>
          <label>
            <span>{tr('Password (optional)')}</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder={tr('Anyone with the link can open it')} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="sl-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? <LoaderCircle size={14} className="spin" /> : null} {tr('Create Link')}
            </button>
          </div>

          {!!links?.length && (
            <div className="sl-list">
              <h4>{tr('Links')}</h4>
              {links.map(l => (
                <div key={l.id} className={made === l.id ? 'sl-new' : ''}>
                  <ShareLinkRow
                    link={l}
                    base={base}
                    onDelete={() =>
                      void api.deleteShareLink(l.id).then(load, e => setError(e instanceof Error ? e.message : String(e)))
                    }
                  />
                  {made === l.id && <small className="sl-copied">{tr('Link copied. Paste it in a chat or an email.')}</small>}
                </div>
              ))}
            </div>
          )}
          <p className="sl-reach">
            {base
              ? tr('Links use {0}.', base)
              : tr('Links use this desktop’s address, so they open for people on your network or your Tailscale. For anyone else, set a public address in Settings → General → Sharing.')}
          </p>
        </form>
      </div>
    </div>
  )
}
