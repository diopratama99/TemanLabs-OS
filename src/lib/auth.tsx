import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, UNAUTHORIZED_EVENT } from '../api'
import type { Session } from '../api/types'
import { Login } from '../components/Login'
import { Wallpaper } from '../components/Wallpaper'
import { DATA_ROOT } from './places'

interface AuthContextValue {
  hostname: string
  /** Topmost folder the file manager may show ("/" for the whole filesystem). */
  root: string
  /** The terminal user's home folder, if the server has one configured. */
  home?: string
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type State = { status: 'checking' } | { status: 'signed-out'; hostname: string } | { status: 'signed-in'; session: Session }

/**
 * Shows the login screen until there's a session, and returns to it when any request reports
 * the session has ended (401). The desktop only mounts — and starts polling — once signed in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'checking' })

  const signedOut = (s: State): State => ({
    status: 'signed-out',
    hostname: s.status === 'signed-out' ? s.hostname : s.status === 'signed-in' ? s.session.hostname : '',
  })

  useEffect(() => {
    let alive = true
    api
      .me()
      .then(me => alive && setState(me.authenticated ? { status: 'signed-in', session: me } : { status: 'signed-out', hostname: me.hostname }))
      .catch(() => alive && setState({ status: 'signed-out', hostname: '' }))
    const onUnauthorized = () => setState(signedOut)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => {
      alive = false
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setState(signedOut)
    }
  }, [])

  if (state.status === 'checking') return <Wallpaper />
  if (state.status === 'signed-out') {
    return <Login hostname={state.hostname} onSignedIn={session => setState({ status: 'signed-in', session })} />
  }
  const { hostname, root, home } = state.session
  return (
    <AuthContext.Provider value={{ hostname, root: root ?? DATA_ROOT, home, signOut }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthGate')
  return ctx
}
