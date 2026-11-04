import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { api } from '../api'
import type { Session } from '../api/types'
import { useClock } from '../hooks/useClock'
import { Glass } from './Glass'
import { Wallpaper } from './Wallpaper'
import { LogoTile } from './Logo'
import { tr } from '../lib/i18n'
import { SHELL } from '../lib/shell'

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
  const [shown, setShown] = useState(false)

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

  // Show the password as it's typed, to check it. The field keeps focus (and the cursor its place).
  const reveal = (
    <button
      type="button"
      className="login-reveal"
      onPointerDown={e => e.preventDefault()}
      onClick={() => setShown(v => !v)}
      aria-label={shown ? tr('Hide Password') : tr('Show Password')}
      aria-pressed={shown}
      title={shown ? tr('Hide Password') : tr('Show Password')}
      disabled={pending}
    >
      {shown ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  )

  if (SHELL === 'mobile') {
    // A phone gets a plain sign-in: no wallpaper or clock, a field and a button big enough for a thumb.
    return (
      <div className="m-login">
        <form className="m-login-form" onSubmit={submit}>
          <LogoTile size={76} />
          <h1>{hostname || tr('TemanLabsOS')}</h1>
          <p>{unlock ? tr('Locked. Enter the password to go on.') : tr('Sign in to your server')}</p>
          <span className="m-login-field">
            <input
              type={shown ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={tr('Password')}
              aria-label={tr('Password')}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              disabled={pending}
              className={error ? 'has-error' : ''}
            />
            {reveal}
          </span>
          {error && (
            <span className="m-login-error" role="alert">
              {error}
            </span>
          )}
          <button type="submit" className="m-login-go" disabled={!password || pending}>
            {pending ? <LoaderCircle size={18} className="spin" /> : unlock ? tr('Unlock') : tr('Sign In')}
          </button>
          {unlock && (
            <button type="button" className="m-login-switch" onClick={unlock.onSignOut}>
              {tr('Sign Out Instead')}
            </button>
          )}
        </form>
      </div>
    )
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
            type={shown ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={tr('Enter Password')}
            aria-label={tr('Password')}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={pending}
          />
          {reveal}
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
