import { useEffect, useState } from 'react'
import { api } from '../api'

// Both answers come from caches on the server (the release check, apt's lists); this only reads them.
const POLL_MS = 30 * 60_000

/** Counts for the Dock's badges: a new TemanLabsOS release (Settings) and system packages to upgrade. */
export function useSystemBadges() {
  const [release, setRelease] = useState(false)
  const [packages, setPackages] = useState(0)
  useEffect(() => {
    const load = () => {
      api.releaseStatus().then(r => setRelease(!!r.available), () => {})
      api.updates().then(u => setPackages(u.updates.length), () => {})
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return { release, packages }
}
