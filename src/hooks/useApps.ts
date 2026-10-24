import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { CustomAppSpec, InstalledApp } from '../api/types'

// Containers change outside TemanLabsOS too (CasaOS, the CLI), so the list is polled; faster
// while an install is pulling images.
const POLL_MS = 8000
const POLL_INSTALLING_MS = 2500

export function useApps() {
  const [apps, setApps] = useState<InstalledApp[]>([])
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      setApps(await api.listApps())
    } catch {
      // Keep showing the last list; a failed poll (e.g. Docker restarting) shouldn't blank the Dock.
    }
  }, [])

  const installing = apps.some(app => app.status === 'installing')
  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, installing ? POLL_INSTALLING_MS : POLL_MS)
    return () => clearInterval(timer)
  }, [refresh, installing])

  /** Runs an action for one app, marking it busy; errors propagate to the caller (and the toast). */
  const track = async (id: string, task: () => Promise<void>) => {
    setBusy(b => new Set(b).add(id))
    try {
      await task()
    } finally {
      setBusy(b => {
        const next = new Set(b)
        next.delete(id)
        return next
      })
      await refresh()
    }
  }

  return {
    apps,
    busy,
    refresh,
    install: (id: string) => track(id, () => api.installApp(id)),
    installCustom: async (spec: CustomAppSpec) => {
      const id = await api.installCustomApp(spec)
      await refresh()
      return id
    },
    uninstall: (id: string) => track(id, () => api.uninstallApp(id)),
    toggle: (app: InstalledApp) => track(app.id, () => api.setAppRunning(app.id, app.status !== 'running')),
  }
}
