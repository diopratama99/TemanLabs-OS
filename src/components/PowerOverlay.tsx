import { useEffect, useState } from 'react'
import { LoaderCircle, Power } from 'lucide-react'
import { api } from '../api'
import { LogoTile } from './Logo'

const POLL_MS = 3000
// The server answers for a moment after the command; only count it back after this.
const GRACE_MS = 12000

/** Shown after Restart / Shut Down: waits for the server and reloads when it's back. */
export function PowerOverlay({ action }: { action: 'restart' | 'shutdown' }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const tick = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    if (action === 'shutdown') return () => clearInterval(tick)
    const poll = setInterval(async () => {
      if (Date.now() - started < GRACE_MS) return
      try {
        await api.me()
        location.reload()
      } catch {
        // Still restarting.
      }
    }, POLL_MS)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [action])

  return (
    <div className="power-overlay" role="alertdialog" aria-live="polite">
      <LogoTile size={72} />
      {action === 'restart' ? (
        <>
          <strong>Restarting the server…</strong>
          <span>
            <LoaderCircle size={14} className="spin" /> This page comes back by itself when the server is up ({seconds}s).
          </span>
        </>
      ) : (
        <>
          <strong>The server is shutting down</strong>
          <span>
            <Power size={14} /> Turn it on again with its power button. This page will work once it’s back.
          </span>
        </>
      )}
    </div>
  )
}
