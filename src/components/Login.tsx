import { useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { api } from '../api'
import type { Session } from '../api/types'
import { useClock } from '../hooks/useClock'
import { Glass } from './Glass'
import { Wallpaper } from './Wallpaper'
import { LogoTile } from './Logo'
import { tr } from '../lib/i18n'

interface Props {
  hostname: string
  onSignedIn: (session: Session) => void
  /** Unlocking a locked session instead of signing in: the desktop waits underneath. */
  unlock?: { onUnlocked: () => void; onSignOut: () => void }
}

/** Lock screen: clock above, glass password field below. */
export function Login({ hostname, onSignedIn, unlock }: Props) {
  const now = useClock()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || pending) return
    setPending(true)
    setError(null)
    try {
      if (unlock) {
        await api.unlock(password)
        unlock.onUnlocked()
      } else onSignedIn(await api.login(password))
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Could not sign in.'))
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={`login ${unlock ? 'is-lock' : ''}`}>
      <Wallpaper />
      <div className="login-clock">
        <span>{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <strong>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong>
      </div>
      <form className="login-form" onSubmit={submit}>
        <LogoTile size={72} />
        <strong className="login-host">{hostname || tr('TemanLabsOS')}</strong>
        <Glass radius={20} bezel={12} depth={12} blur={16} className={`login-field ${error ? 'has-error' : ''}`}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={tr('Enter Password')}
            aria-label={tr('Password')}
            autoComplete="current-password"
            autoFocus
            disabled={pending}
          />
          <button type="submit" aria-label={tr('Sign in')} disabled={!password || pending}>
            {pending ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
          </button>
        </Glass>
        <span className="login-message" role="alert">
          {error ?? (unlock ? tr('Locked') : tr('TemanLabsOS'))}
        </span>
        {unlock && (
          <button type="button" className="login-switch" onClick={unlock.onSignOut}>
            {tr('Sign Out Instead')}
          </button>
        )}
      </form>
    </div>
  )
}
