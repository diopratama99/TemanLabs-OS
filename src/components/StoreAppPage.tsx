import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  LoaderCircle,
  Network,
  Package,
  Store,
  User,
  X,
} from 'lucide-react'
import { api } from '../api'
import type { InstalledApp, StoreAppDetails, StoreEntry } from '../api/types'
import { DATA_ROOT } from '../lib/places'
import { AppIcon } from './AppIcon'
import { tr } from '../lib/i18n'

// A store app's own page in the App Center: what it is, what it looks like, and what installing
// it sets up (image, ports, folders), before anything is installed.

const ICON_COLOR: [string, string] = ['#64d2ff', '#2f6bff']
// Longer descriptions start folded, with "more" to open them.
const FOLD_CHARS = 420

interface Props {
  entry: StoreEntry
  installed?: InstalledApp
  /** Other apps in the same category. */
  related: StoreEntry[]
  backLabel: string
  /** The install sheet is open on top (Escape is its). */
  covered: boolean
  onBack: () => void
  onSelect: (entry: StoreEntry) => void
  /** Install: with the details already read (null for the built-in picks). */
  onGet: (details: StoreAppDetails | null) => void
  onOpen: (app: InstalledApp) => void
  /** The small Get / Open button for a related app's card. */
  renderGet: (entry: StoreEntry) => ReactNode
}

export function StoreAppPage({ entry, installed, related, backLabel, covered, onBack, onSelect, onGet, onOpen, renderGet }: Props) {
  const builtIn = entry.source === 'TemanLabsOS'
  const [details, setDetails] = useState<StoreAppDetails | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unfolded, setUnfolded] = useState(false)
  const [shot, setShot] = useState<number | null>(null)

  useEffect(() => {
    setDetails(null)
    setLoadError(null)
    setUnfolded(false)
    setShot(null)
    if (builtIn) return
    let alive = true
    api.storeApp(entry.id).then(
      d => alive && setDetails(d),
      (err: Error) => alive && setLoadError(err.message),
    )
    return () => {
      alive = false
    }
  }, [entry.id, builtIn])

  const shots = details?.screenshots ?? []
  useEffect(() => {
    if (covered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (shot !== null) {
        if (e.key === 'Escape') setShot(null)
        else if (e.key === 'ArrowRight') setShot(i => ((i ?? 0) + 1) % shots.length)
        else if (e.key === 'ArrowLeft') setShot(i => ((i ?? 0) - 1 + shots.length) % shots.length)
        else return
      } else if (e.key === 'Escape') onBack()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [covered, shot, shots.length, onBack])

  const description = details?.description || entry.tagline
  const folded = !unfolded && description.length > FOLD_CHARS
  const spec = details?.spec
  const facts: { icon: typeof Store; label: string; value: string }[] = [
    { icon: Store, label: tr('Category'), value: tr(entry.category) },
    { icon: Package, label: tr('Source'), value: entry.source },
  ]
  if (entry.developer) facts.push({ icon: User, label: tr('Developer'), value: entry.developer })
  if (spec?.webUi?.port || entry.port)
    facts.push({ icon: Network, label: tr('Web UI'), value: tr('Port {0}', spec?.webUi?.port || entry.port || '') })
  if (details) facts.push({ icon: Package, label: tr('Containers'), value: String(details.services.length) })
  if (details?.architectures?.length) facts.push({ icon: Cpu, label: tr('Runs on'), value: details.architectures.join(' · ') })

  const busy = installed?.status === 'installing'
  const primary = busy ? (
    <span className="btn btn-primary ap-get is-busy">
      <LoaderCircle size={14} className="spin" /> {tr('Installing')}
    </span>
  ) : installed ? (
    <button className="btn btn-primary ap-get" onClick={() => onOpen(installed)}>
      <ExternalLink size={14} /> {tr('Open')}
    </button>
  ) : (
    <button className="btn btn-primary ap-get" onClick={() => onGet(details)} disabled={!builtIn && !details}>
      {!builtIn && !details && !loadError ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} {tr('Get')}
    </button>
  )

  return (
    <div className="ap">
      <button className="ap-back" onClick={onBack}>
        <ChevronLeft size={16} /> {backLabel}
      </button>

      <header className="ap-hero">
        <AppIcon icon="boxes" iconUrl={entry.iconUrl || undefined} color={ICON_COLOR} size={124} />
        <div className="ap-hero-text">
          <h1>{entry.name}</h1>
          {entry.tagline && <p className="ap-tagline">{entry.tagline}</p>}
          {entry.developer && <p className="ap-dev">{entry.developer}</p>}
          <div className="ap-actions">
            {primary}
            {installed && installed.source !== 'temanlabs' && <small>{tr('Already on the server as {0}.', installed.name)}</small>}
            {!installed && <small>{tr('Free · Runs on this server')}</small>}
          </div>
        </div>
      </header>

      <div className="ap-facts">
        {facts.map(f => (
          <div key={f.label} className="ap-fact">
            <small>{f.label}</small>
            <f.icon size={18} />
            <strong title={f.value}>{f.value}</strong>
          </div>
        ))}
      </div>

      {loadError && (
        <p className="form-error">
          {tr('Couldn’t prepare this app:')} {loadError}
        </p>
      )}

      {shots.length > 0 && (
        <section className="ap-section">
          <h2>{tr('Preview')}</h2>
          <div className="ap-shots">
            {shots.map((src, i) => (
              <button key={src} className="ap-shot" onClick={() => setShot(i)} aria-label={tr('Screenshot {0}', i + 1)}>
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="ap-section">
        <h2>{tr('About')}</h2>
        <p className={`ap-desc ${folded ? 'is-folded' : ''}`}>{description}</p>
        {folded && (
          <button className="ap-more" onClick={() => setUnfolded(true)}>
            {tr('more')}
          </button>
        )}
      </section>

      {details?.tips && (
        <section className="ap-section">
          <h2>{tr('Before You Install')}</h2>
          <p className="ap-tips">
            <Info size={14} /> {details.tips}
          </p>
        </section>
      )}

      {!builtIn && (
        <section className="ap-section">
          <h2>{tr('Information')}</h2>
          {!details && !loadError ? (
            <p className="as-loading">
              <LoaderCircle size={14} className="spin" /> {tr('Reading the app’s compose file…')}
            </p>
          ) : details && spec ? (
            <dl className="ap-info">
              {entry.developer && <Fact label={tr('Developer')}>{entry.developer}</Fact>}
              {details.author && details.author !== entry.developer && <Fact label={tr('Packaged by')}>{details.author}</Fact>}
              <Fact label={tr('Source')}>{tr('{0} app store', entry.source)}</Fact>
              <Fact label={tr('Image')}>
                <code>
                  {spec.image}
                  {spec.tag ? `:${spec.tag}` : ''}
                </code>
              </Fact>
              <Fact label={tr('Installs as')}>
                <code>{details.appId}</code>
              </Fact>
              <Fact label={tr('Containers')}>{details.services.join(', ')}</Fact>
              {spec.ports.length > 0 && (
                <Fact label={tr('Ports')}>
                  {spec.ports.map(p => (
                    <span key={`${p.host}/${p.protocol}`} className="ap-chip">
                      {p.host} → {p.container}/{p.protocol}
                    </span>
                  ))}
                </Fact>
              )}
              <Fact label={tr('Data')}>
                <span className="ap-path">
                  <FolderOpen size={13} /> {DATA_ROOT}/AppData/{details.appId}
                </span>
              </Fact>
              {spec.volumes.length > 0 && (
                <Fact label={tr('Folders')}>
                  {spec.volumes.map(v => (
                    <span key={v.container} className="ap-mount">
                      <code>{v.host}</code> → <code>{v.container}</code>
                      {v.readOnly && <small> ({tr('read-only')})</small>}
                    </span>
                  ))}
                </Fact>
              )}
              {spec.env.length > 0 && (
                <Fact label={tr('Settings')}>
                  {spec.env.map(e => (
                    <span key={e.key} className="ap-chip">
                      {e.key}
                    </span>
                  ))}
                </Fact>
              )}
              {details.architectures?.length ? <Fact label={tr('Runs on')}>{details.architectures.join(', ')}</Fact> : null}
              <Fact label={tr('Restart')}>{spec.restart}</Fact>
            </dl>
          ) : null}
          {details && (
            <p className="ap-note">{tr('You can change the ports, folders and settings on the next step, before it installs.')}</p>
          )}
        </section>
      )}

      {related.length > 0 && (
        <section className="ap-section">
          <h2>{tr('More in {0}', tr(entry.category))}</h2>
          <div className="store-grid">
            {related.map(r => (
              <div className="store-card" key={r.id} onClick={() => onSelect(r)}>
                <AppIcon icon="boxes" iconUrl={r.iconUrl || undefined} color={ICON_COLOR} size={52} />
                <div className="store-card-info">
                  <strong>{r.name}</strong>
                  <span>{r.tagline}</span>
                </div>
                {renderGet(r)}
              </div>
            ))}
          </div>
        </section>
      )}

      {shot !== null && shots[shot] && (
        <div className="ap-lightbox" onClick={() => setShot(null)} role="dialog" aria-label={tr('Screenshot {0}', shot + 1)}>
          <img src={shots[shot]} alt="" onClick={e => e.stopPropagation()} />
          <button className="ap-lightbox-close" onClick={() => setShot(null)} aria-label={tr('Close')}>
            <X size={18} />
          </button>
          {shots.length > 1 && (
            <>
              <button
                className="ap-lightbox-nav is-prev"
                onClick={e => {
                  e.stopPropagation()
                  setShot((shot - 1 + shots.length) % shots.length)
                }}
                aria-label={tr('Previous')}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                className="ap-lightbox-nav is-next"
                onClick={e => {
                  e.stopPropagation()
                  setShot((shot + 1) % shots.length)
                }}
                aria-label={tr('Next')}
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ap-info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
