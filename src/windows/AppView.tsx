import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink, KeyRound, LoaderCircle, LogOut, Play, Shield, TriangleAlert } from 'lucide-react'
import { api, MOCK_MODE } from '../api'
import type { AppFrame, InstalledApp } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import { appUrl, openApp } from '../lib/apps'
import { tr } from '../lib/i18n'
import { useSettings } from '../lib/settings'

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
  const [src, setSrc] = useState<{ value: string; proxied: boolean; frame?: AppFrame } | null>(null)
  // Bumped after signing in or out, to ask the server again.
  const [attempt, setAttempt] = useState(0)
  // Some apps refuse frames only to browsers elsewhere on the network, which the server can't
  // see; for those the user can switch to the proxy, and it's remembered.
  const { settings, update } = useSettings()
  const forced = (settings.proxiedApps ?? []).includes(app.id)
  const setForced = (on: boolean) =>
    update(s => ({ proxiedApps: on ? [...(s.proxiedApps ?? []).filter(id => id !== app.id), app.id] : (s.proxiedApps ?? []).filter(id => id !== app.id) }))

  useEffect(() => {
    let alive = true
    setSrc(null)
    api
      .appFrame(app.id, forced)
      .then(frame => {
        if (!alive) return
        const proxied = frame.proxied && !!frame.port
        const path = new URL(url).pathname
        setSrc({ value: proxied ? `http://${location.hostname}:${frame.port}${path}` : url, proxied, frame })
      })
      .catch(() => alive && setSrc({ value: url, proxied: false }))
    return () => {
      alive = false
    }
  }, [app.id, url, forced, attempt])

  if (!src) {
    return (
      <div className="app-placeholder">
        <LoaderCircle size={18} className="spin" />
      </div>
    )
  }
  if (src.frame?.auth === 'basic' && !src.frame.signedIn) {
    return <SignIn app={app} username={src.frame.username ?? ''} onSignedIn={() => setAttempt(a => a + 1)} newTab={src.value} />
  }
  return (
    <>
      <iframe className="app-frame" src={src.value} title={app.name} />
      <div className="app-frame-hint">
        {app.localOnly
          ? tr('This app only listens on the server itself; TemanLabsOS is showing it through its proxy.')
          : src.proxied
            ? tr('This app blocks embedding, so TemanLabsOS is showing it through its proxy.')
            : tr('Page not loading here? Some apps only work in their own tab.')}
        {!src.proxied && !app.localOnly && (
          <button onClick={() => setForced(true)}>
            <Shield size={12} /> {tr('Show Through Proxy')}
          </button>
        )}
        {forced && src.proxied && (
          <button onClick={() => setForced(false)}>
            <Shield size={12} /> {tr('Show Directly')}
          </button>
        )}
        {src.frame?.signedIn && (
          <button onClick={() => void api.appSignOut(app.id).then(() => setAttempt(a => a + 1))} title={tr('Signed in as {0}', src.frame.username ?? '')}>
            <LogOut size={12} /> {tr('Sign Out')}
          </button>
        )}
        {/* Through the proxy when the app can't be reached directly (or refuses frames). */}
        <button onClick={() => (src.proxied ? window.open(src.value, '_blank', 'noopener') : openApp(app))}>
          <ExternalLink size={12} /> {tr('Open in New Tab')}
        </button>
      </div>
    </>
  )
}

/**
 * The app asks for an HTTP Basic login: asked here once instead of in the browser's dialog. The
 * server checks it with the app, keeps it, and the proxy signs in with it from then on.
 */
function SignIn({ app, username: saved, newTab, onSignedIn }: { app: InstalledApp; username: string; newTab: string; onSignedIn: () => void }) {
  const [username, setUsername] = useState(saved)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.appSignIn(app.id, username.trim(), password)
      onSignedIn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message === 'wrong user name or password' ? tr('Wrong user name or password.') : message)
      setBusy(false)
    }
  }
  return (
    <div className="app-placeholder app-signin">
      <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={72} />
      <h2>{tr('Sign in to {0}', app.name)}</h2>
      <p>{tr('{0} asks for a user name and password. TemanLabsOS keeps them on the server and signs in for you, so the app can show in this window.', app.name)}</p>
      {/supabase/i.test(app.id + app.name) && <p className="app-signin-hint">{tr('For Supabase they are DASHBOARD_USERNAME and DASHBOARD_PASSWORD in its .env file.')}</p>}
      <form className="app-signin-form" onSubmit={e => void submit(e)}>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder={tr('User name')} autoComplete="username" autoFocus={!saved} spellCheck={false} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={tr('Password')} autoComplete="current-password" autoFocus={!!saved} />
        {error && (
          <p className="form-error">
            <TriangleAlert size={13} /> {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || !username.trim()}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <KeyRound size={13} />} {tr('Sign In')}
        </button>
      </form>
      <button className="app-signin-tab" onClick={() => window.open(newTab, '_blank', 'noopener')}>
        <ExternalLink size={12} /> {tr('Open in New Tab')}
      </button>
    </div>
  )
}

/** Web view for an installed app. */
export function AppView({ app, busy, onToggle }: Props) {
  if (!app) {
    return (
      <div className="app-placeholder">
        <p>{tr('This app is no longer installed.')}</p>
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
          <LoaderCircle size={14} className="spin" /> {tr('Installing… Downloading the image can take a few minutes.')}
        </p>
      )}

      {app.status === 'stopped' && (
        <>
          <p>{app.name} {tr('is stopped. Start it to load its web interface in this window.')}</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => onToggle(app)} disabled={busy}>
              {busy ? (
                tr('Starting…')
              ) : (
                <>
                  <Play size={13} /> {tr('Start')}
                </>
              )}
            </button>
          </div>
        </>
      )}

      {app.status === 'running' && !url && (
        <p>
          {app.name} {tr("is running, but it doesn't publish a web interface on the network")}
          {app.containers > 1 ? tr(' ({0} containers)', app.containers) : ''}.
        </p>
      )}

      {app.status === 'running' && url && MOCK_MODE && (
        <p>
          {tr('Mock mode: nothing is serving')} {app.name} at <code>{url}</code>.
        </p>
      )}
    </div>
  )
}
