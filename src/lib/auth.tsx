import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, LOCKED_EVENT, UNAUTHORIZED_EVENT } from '../api'
import type { Session } from '../api/types'
import { Login } from '../components/Login'
import { Wallpaper } from '../components/Wallpaper'
import { DATA_ROOT } from './places'
import { useSettings } from './settings'
import { tr } from './i18n'

interface AuthContextValue {
  hostname: string
  /** Topmost folder the file manager may show ("/" for the whole filesystem). */
  root: string
  /** The terminal user's home folder, if the server has one configured. */
  home?: string
  signOut: () => Promise<void>
  /** Locks the screen: the desktop stays, behind the password. */
  lock: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

type State = { status: 'checking' } | { status: 'signed-out'; hostname: string } | { status: 'signed-in'; session: Session }

// How often inactivity is checked against Settings → Lock Screen.
const IDLE_CHECK_MS = 15_000

/**
 * Shows the login screen until there's a session, and returns to it when any request reports
 * the session has ended (401). The desktop only mounts — and starts polling — once signed in.
 * A locked session (423, or locked from here) keeps the desktop mounted under the lock screen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'checking' })
  const [locked, setLocked] = useState(false)
  const { settings } = useSettings()

  const signedOut = (s: State): State => ({
    status: 'signed-out',
    hostname: s.status === 'signed-out' ? s.hostname : s.status === 'signed-in' ? s.session.hostname : '',
  })

  useEffect(() => {
    let alive = true
    api
      .me()
      .then(me => {
        if (!alive) return
        setState(me.authenticated ? { status: 'signed-in', session: me } : { status: 'signed-out', hostname: me.hostname })
        setLocked(!!me.locked)
      })
      .catch(() => alive && setState({ status: 'signed-out', hostname: '' }))
    const onUnauthorized = () => {
      setLocked(false)
      setState(signedOut)
    }
    const onLocked = () => setLocked(true)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    window.addEventListener(LOCKED_EVENT, onLocked)
    return () => {
      alive = false
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
      window.removeEventListener(LOCKED_EVENT, onLocked)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setLocked(false)
      setState(signedOut)
    }
  }, [])

  const lock = useCallback(() => {
    setLocked(true)
    api.lock().catch(() => {})
  }, [])

  // Locks after Settings → Lock Screen's minutes without a key, click or move.
  const signedIn = state.status === 'signed-in'
  useEffect(() => {
    if (!signedIn || locked || !settings.lockAfter) return
    let last = Date.now()
    const active = () => (last = Date.now())
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of events) window.addEventListener(e, active, { passive: true })
    const timer = setInterval(() => {
      if (Date.now() - last >= settings.lockAfter * 60_000) lock()
    }, IDLE_CHECK_MS)
    return () => {
      for (const e of events) window.removeEventListener(e, active)
      clearInterval(timer)
    }
  }, [signedIn, locked, settings.lockAfter, lock])

  if (state.status === 'checking') return <Wallpaper />
  if (state.status === 'signed-out') {
    return <Login hostname={state.hostname} onSignedIn={session => setState({ status: 'signed-in', session })} />
  }
  const { hostname, root, home } = state.session
  return (
    <AuthContext.Provider value={{ hostname, root: root ?? DATA_ROOT, home, signOut, lock }}>
      {children}
      {locked && <Login hostname={hostname} onSignedIn={() => {}} unlock={{ onUnlocked: () => setLocked(false), onSignOut: () => void signOut() }} />}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error(tr('useAuth must be used inside AuthGate'))
  return ctx
}
