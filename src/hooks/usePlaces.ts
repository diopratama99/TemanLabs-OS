import { useEffect, useState } from 'react'
import { Cloud, HardDrive, House, Server } from 'lucide-react'
import { api } from '../api'
import type { Disk } from '../api/types'
import { useAuth } from '../lib/auth'
import { nameOf } from '../lib/paths'
import { DATA_ROOT, PLACES, type Place } from '../lib/places'
import { tr } from '../lib/i18n'

/**
 * Sidebar places for Files and the Open dialog: CasaOS's /DATA folders as favorites, plus the
 * filesystem root, the user's home and mounted disks — whichever lie inside the server's root.
 */
export function usePlaces(): { favorites: Place[]; locations: Place[] } {
  const { root, home } = useAuth()
  const [disks, setDisks] = useState<Disk[]>([])
  // Folders that actually exist in /DATA; not every server has all of CasaOS's defaults.
  const [data, setData] = useState<{ exists: boolean; folders: Set<string> }>({ exists: false, folders: new Set() })

  useEffect(() => {
    let alive = true
    // Drives come and go (one plugged in over USB shows up in a few seconds).
    const loadDisks = () =>
      api
        .getSystemStats()
        .then(stats => alive && setDisks(d => (JSON.stringify(d.map(x => x.mount)) === JSON.stringify(stats.disks.map(x => x.mount)) ? d : stats.disks)))
        .catch(() => {})
    void loadDisks()
    const timer = setInterval(loadDisks, 8000)
    api
      .listFiles(DATA_ROOT)
      .then(entries => {
        if (alive) setData({ exists: true, folders: new Set(entries.filter(e => e.kind === 'folder').map(e => e.name)) })
      })
      .catch(() => {})
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const exists = (path: string) => (path === DATA_ROOT ? data.exists : data.folders.has(nameOf(path)))

  const inside = (path: string) => root === '/' || path === root || path.startsWith(`${root}/`)
  const locations: Place[] = [
    ...(root === '/' ? [{ path: '/', label: tr('Root'), icon: Server }] : []),
    ...(home && inside(home) ? [{ path: home, label: tr('Home'), icon: House }] : []),
    ...disks
      .filter(d => d.mount !== '/' && inside(d.mount))
      .map(d => ({ path: d.mount, label: d.name, icon: d.cloud ? Cloud : HardDrive })),
  ]
  return { favorites: PLACES.filter(p => inside(p.path) && exists(p.path)), locations }
}
