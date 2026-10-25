import { useRef, useState } from 'react'
import { ChevronRight, KeyRound, LoaderCircle, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import { api } from '../api'
import type { CookieSite, Downloads } from '../api/types'
import { BrandIcon, type Brand } from '../components/BrandIcon'
import { FolderField } from '../components/FolderField'
import { MediaToolsRow } from '../components/MediaTools'
import { formatFileDate } from '../lib/format'
import { tr } from '../lib/i18n'

// The sites people most often need to be signed in to, each with a cookies row of its own.
// Instagram's can be checked: it says who they sign in as.
const PLATFORMS: { id: Brand; name: string; sites: string[]; note: string; check?: boolean }[] = [
  { id: 'instagram', name: 'Instagram', sites: ['instagram.com'], check: true, note: tr('Profiles, reels, stories and private accounts you follow') },
  { id: 'x', name: 'X', sites: ['x.com', 'twitter.com'], note: tr('Profiles’ media and posts') },
  { id: 'tiktok', name: 'TikTok', sites: ['tiktok.com'], note: tr('Profiles, reposts and stories') },
  { id: 'youtube', name: 'YouTube', sites: ['youtube.com'], note: tr('Age-restricted and members-only videos') },
  { id: 'facebook', name: 'Facebook', sites: ['facebook.com'], note: tr('Videos and photos only friends can see') },
]

export function DownloaderSettings({ data, onClose, onChanged }: { data: Downloads; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, { ok: boolean; text: string }>>({})
  const file = useRef<HTMLInputElement>(null)
  // Which row's button opened the file picker: a platform's sites, or any site (null).
  const target = useRef<{ id: string; sites: string[] | null }>({ id: 'other', sites: null })

  const run = (id: string, fn: () => Promise<string>) => {
    setBusy(id)
    setError(null)
    setNote(null)
    fn().then(
      done => {
        setNote(done)
        onChanged()
      },
      e => setError(e instanceof Error ? e.message : String(e)),
    ).finally(() => setBusy(null))
  }
  const choose = (id: string, sites: string[] | null) => {
    target.current = { id, sites }
    file.current?.click()
  }
  const upload = (f: File) => {
    const { id, sites } = target.current
    run(id, async () => {
      const res = await api.setDownloadCookies(await f.text(), sites ?? undefined)
      return tr('Added cookies for {0}.', res.sites.join(', '))
    })
  }

  const check = (p: (typeof PLATFORMS)[number]) => {
    setBusy(p.id)
    setChecks(c => ({ ...c, [p.id]: { ok: true, text: tr('Checking…') } }))
    api
      .checkDownloadCookies(p.sites[0])
      .then(
        r => setChecks(c => ({ ...c, [p.id]: r.ok ? { ok: true, text: tr('Signed in as @{0}', r.user ?? '') } : { ok: false, text: r.message ?? tr('Not signed in') } })),
        e => setChecks(c => ({ ...c, [p.id]: { ok: false, text: e instanceof Error ? e.message : String(e) } })),
      )
      .finally(() => setBusy(null))
  }

  const saved = (sites: string[]) => data.cookieSites.filter(c => sites.includes(c.site))
  const known = PLATFORMS.flatMap(p => p.sites)
  const others = data.cookieSites.filter(c => !known.includes(c.site))
  const anySignedIn = data.cookieSites.some(c => c.signedIn)

  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci bk-sheet dls" role="dialog" aria-label={tr('Downloader Settings')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{tr('Downloader Settings')}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body dls-body">
          <FolderField
            label={tr('Save to')}
            title={tr('Save Downloads To')}
            value={data.folder}
            onChoose={folder =>
              run('folder', async () => {
                await api.setDownloadFolder(folder)
                return tr('Saved.')
              })
            }
          />

          <section className="dls-section">
            <div className="dls-heading">
              <span>{tr('Signed-in sites')}</span>
              <small>{tr('For posts only an account can see. Each site’s cookies stay on the server.')}</small>
            </div>
            <div className="dls-list">
              {PLATFORMS.map(p => {
                const have = saved(p.sites)
                const signedIn = have.some(c => c.signedIn)
                const checked = have.length ? checks[p.id] : undefined
                return (
                  <div className="dls-row" key={p.id}>
                    <BrandIcon brand={p.id} />
                    <span className="dls-text">
                      <strong>{p.name}</strong>
                      <small>
                        {have.length === 0 ? (
                          p.note
                        ) : checked ? (
                          <>
                            <i className={`dls-dot ${checked.ok ? 'is-on' : 'is-bad'}`} />
                            <span className={checked.ok ? '' : 'dls-bad'}>{checked.text}</span>
                          </>
                        ) : (
                          <>
                            <i className={`dls-dot ${signedIn ? 'is-on' : 'is-warn'}`} />
                            {signedIn ? tr('Sign-in cookie saved') : tr('No sign-in cookie: export it while signed in')}
                          </>
                        )}
                      </small>
                    </span>
                    {busy === p.id ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <>
                        {p.check && have.length > 0 && (
                          <button className="btn" onClick={() => check(p)} title={tr('Ask {0} who these cookies sign in as', p.name)}>
                            <ShieldCheck size={13} /> {tr('Check')}
                          </button>
                        )}
                        <button className="btn" onClick={() => choose(p.id, p.sites)}>
                          <Upload size={13} /> {have.length ? tr('Replace…') : tr('Add…')}
                        </button>
                        {have.length === 0 && <span className="dls-gap" />}
                        {have.length > 0 && (
                          <button
                            className="icon-btn"
                            title={tr('Remove')}
                            aria-label={tr('Remove {0}’s cookies', p.name)}
                            onClick={() =>
                              run(p.id, async () => {
                                await api.removeDownloadCookies(p.sites)
                                return tr('Removed {0}’s cookies.', p.name)
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
              <div className="dls-row">
                <span className="dls-mark is-other">
                  <KeyRound size={14} />
                </span>
                <span className="dls-text">
                  <strong>{tr('Other sites')}</strong>
                  {others.length === 0 ? (
                    <small>{tr('Any other site a cookies.txt has')}</small>
                  ) : (
                    <span className="dls-chips">
                      {others.map((c: CookieSite) => (
                        <span key={c.site} className="dls-chip" title={c.signedIn ? tr('Sign-in cookie saved') : undefined}>
                          {c.signedIn && <i className="dls-dot is-on" />}
                          {c.site}
                          <button
                            aria-label={tr('Remove {0}’s cookies', c.site)}
                            onClick={() =>
                              run('other', async () => {
                                await api.removeDownloadCookies([c.site])
                                return tr('Removed {0}’s cookies.', c.site)
                              })
                            }
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                {busy === 'other' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
<>
                    <button className="btn" onClick={() => choose('other', null)}>
                      <Upload size={13} /> {tr('Add…')}
                    </button>
                    <span className="dls-gap" />
                  </>
                )}
              </div>
            </div>
            <input
              ref={file}
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) upload(f)
              }}
            />
            {error && <p className="form-error dls-msg">{error}</p>}
            {note && !error && <p className="sl-copied dls-msg">{note}</p>}
            {data.cookiesAt && <p className="dls-when">{tr('Cookies last changed {0}', formatFileDate(data.cookiesAt))}</p>}

            <details className="dls-howto" open={!anySignedIn}>
              <summary>
                <ChevronRight size={14} /> {tr('How to get a cookies.txt')}
              </summary>
              <ol>
                <li>{tr('On a computer, open the site in Chrome, Edge or Firefox and sign in as usual.')}</li>
                <li>{tr('Add the “Get cookies.txt LOCALLY” extension from the browser’s extension store.')}</li>
                <li>{tr('With the site open, click the extension’s icon, then Export. A cookies.txt file is saved.')}</li>
                <li>{tr('Here, click Add… beside that site and choose the file.')}</li>
              </ol>
              <p className="dls-tip">
                {tr('A file with other sites in it is fine: a site’s row takes only that site’s cookies. Signing out in the browser ends them too, so close the tab instead; if a site asks you to sign in again, add fresh ones.')}
              </p>
            </details>
          </section>

          <MediaToolsRow galleryDev />

          <p className="sl-reach">{tr('Save only what you may: respect creators’ rights and each site’s terms.')}</p>
        </div>
      </div>
    </div>
  )
}
