import { useEffect, useState } from 'react'
import { HardDrive, House, Server } from 'lucide-react'
import { api } from '../api'
import type { Disk } from '../api/types'
import { useAuth } from '../lib/auth'
import { nameOf } from '../lib/paths'
import { DATA_ROOT, PLACES, type Place } from '../lib/places'

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
    api
      .getSystemStats()
      .then(stats => alive && setDisks(stats.disks))
      .catch(() => {})
    api
      .listFiles(DATA_ROOT)
      .then(entries => {
        if (alive) setData({ exists: true, folders: new Set(entries.filter(e => e.kind === 'folder').map(e => e.name)) })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const exists = (path: string) => (path === DATA_ROOT ? data.exists : data.folders.has(nameOf(path)))

  const inside = (path: string) => root === '/' || path === root || path.startsWith(`${root}/`)
  const locations: Place[] = [
    ...(root === '/' ? [{ path: '/', label: 'Root', icon: Server }] : []),
    ...(home && inside(home) ? [{ path: home, label: 'Home', icon: House }] : []),
    ...disks
      .filter(d => d.mount !== '/' && inside(d.mount))
      .map(d => ({ path: d.mount, label: d.name, icon: HardDrive })),
  ]
  return { favorites: PLACES.filter(p => inside(p.path) && exists(p.path)), locations }
}
