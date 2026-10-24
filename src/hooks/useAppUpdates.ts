import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { AppUpdates } from '../api/types'

// The server asks registries at most every few hours; this only reads its answers.
const POLL_MS = 15 * 60_000
const POLL_CHECKING_MS = 5000

/** Which installed apps have newer images, for badges in the Dock, Launcher and App Center. */
export function useAppUpdates() {
  const [updates, setUpdates] = useState<AppUpdates | null>(null)

  const refresh = useCallback(async (force = false) => {
    try {
      setUpdates(await api.appUpdates(force))
    } catch {
      // Keep the last answer; update badges aren't worth an error.
    }
  }, [])

  const checking = !!updates?.checking
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), checking ? POLL_CHECKING_MS : POLL_MS)
    return () => clearInterval(timer)
  }, [refresh, checking])

  const available = useCallback((id: string) => !!updates?.apps[id]?.available, [updates])
  const count = updates ? Object.values(updates.apps).filter(a => a.available).length : 0
  return { updates, available, count, checking, refresh }
}
