import { useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { api } from '../api'
import type { Session } from '../api/types'
import { useClock } from '../hooks/useClock'
import { Glass } from './Glass'
import { Wallpaper } from './Wallpaper'
import { LogoTile } from './Logo'

interface Props {
  hostname: string
  onSignedIn: (session: Session) => void
}

/** Lock screen: clock above, glass password field below. */
export function Login({ hostname, onSignedIn }: Props) {
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
      onSignedIn(await api.login(password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.')
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="login">
      <Wallpaper />
      <div className="login-clock">
        <span>{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <strong>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong>
      </div>
      <form className="login-form" onSubmit={submit}>
        <LogoTile size={72} />
        <strong className="login-host">{hostname || 'TemanLabsOS'}</strong>
        <Glass radius={20} bezel={12} depth={12} blur={16} className={`login-field ${error ? 'has-error' : ''}`}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter Password"
            aria-label="Password"
            autoComplete="current-password"
            autoFocus
            disabled={pending}
          />
          <button type="submit" aria-label="Sign in" disabled={!password || pending}>
            {pending ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
          </button>
        </Glass>
        <span className="login-message" role="alert">
          {error ?? 'TemanLabsOS'}
        </span>
      </form>
    </div>
  )
}
