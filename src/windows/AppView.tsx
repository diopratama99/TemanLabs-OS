import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle, Play, TriangleAlert } from 'lucide-react'
import { api, MOCK_MODE } from '../api'
import type { InstalledApp } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import { appUrl, openApp } from '../lib/apps'

interface Props {
  app?: InstalledApp
  busy: boolean
  onToggle: (app: InstalledApp) => void
}

/**
 * Loads the app in an iframe. Apps that forbid framing (X-Frame-Options / CSP) are shown through
 * the server's per-app proxy, which drops those headers; the server decides which is needed.
 */
function FramedApp({ app, url }: { app: InstalledApp; url: string }) {
  const [src, setSrc] = useState<{ value: string; proxied: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    api
      .appFrame(app.id)
      .then(frame => {
        if (!alive) return
        const proxied = frame.proxied && !!frame.port
        const path = new URL(url).pathname
        setSrc({ value: proxied ? `http://${location.hostname}:${frame.port}${path}` : url, proxied })
      })
      .catch(() => alive && setSrc({ value: url, proxied: false }))
    return () => {
      alive = false
    }
  }, [app.id, url])

  if (!src) {
    return (
      <div className="app-placeholder">
        <LoaderCircle size={18} className="spin" />
      </div>
    )
  }
  return (
    <>
      <iframe className="app-frame" src={src.value} title={app.name} />
      <div className="app-frame-hint">
        {app.localOnly
          ? 'This app only listens on the server itself; TemanLabsOS is showing it through its proxy.'
          : src.proxied
            ? 'This app blocks embedding, so TemanLabsOS is showing it through its proxy.'
            : 'Page not loading here? Some apps only work in their own tab.'}
        {/* Through the proxy when the app can't be reached directly (or refuses frames). */}
        <button onClick={() => (src.proxied ? window.open(src.value, '_blank', 'noopener') : openApp(app))}>
          <ExternalLink size={12} /> Open in New Tab
        </button>
      </div>
    </>
  )
}

/** Web view for an installed app. */
export function AppView({ app, busy, onToggle }: Props) {
  if (!app) {
    return (
      <div className="app-placeholder">
        <p>This app is no longer installed.</p>
      </div>
    )
  }

  const url = appUrl(app)
  if (app.status === 'running' && url && !MOCK_MODE) return <FramedApp app={app} url={url} />

  return (
    <div className="app-placeholder">
      <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={96} />
      <h2>{app.name}</h2>

      {app.error && (
        <p className="app-placeholder-error">
          <TriangleAlert size={14} /> {app.error}
        </p>
      )}

      {app.status === 'installing' && (
        <p className="app-placeholder-status">
          <LoaderCircle size={14} className="spin" /> Installing… Downloading the image can take a few minutes.
        </p>
      )}

      {app.status === 'stopped' && (
        <>
          <p>{app.name} is stopped. Start it to load its web interface in this window.</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => onToggle(app)} disabled={busy}>
              {busy ? (
                'Starting…'
              ) : (
                <>
                  <Play size={13} /> Start
                </>
              )}
            </button>
          </div>
        </>
      )}

      {app.status === 'running' && !url && (
        <p>
          {app.name} is running, but it doesn't publish a web interface on the network
          {app.containers > 1 ? ` (${app.containers} containers)` : ''}.
        </p>
      )}

      {app.status === 'running' && url && MOCK_MODE && (
        <p>
          Mock mode: nothing is serving {app.name} at <code>{url}</code>.
        </p>
      )}
    </div>
  )
}
