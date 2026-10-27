import { useEffect, useState } from 'react'
import { File, Folder, FolderOpen } from 'lucide-react'
import { iconFor, readIconMap, type IconMap, type RawIconMap } from '../../lib/fileIcons'
import { useSettings } from '../../lib/settings'

// File and folder icons from the Material Icon Theme (see lib/fileIcons). The mapping is fetched
// once, when the first icon shows; each SVG downloads only when it's on screen. Until then, plain
// icons stand in.

const BASE = `${import.meta.env.BASE_URL}file-icons/`
let iconMap: IconMap | null = null
let loading: Promise<void> | null = null
const waiting = new Set<() => void>()

function loadIcons() {
  loading ??= fetch(`${BASE}map.json`)
    .then(r => (r.ok ? (r.json() as Promise<RawIconMap>) : null))
    .then(raw => {
      if (raw) iconMap = readIconMap(raw)
    })
    .catch(() => {})
    .finally(() => waiting.forEach(f => f()))
  return loading
}

function useIconMap() {
  const [, setLoaded] = useState(!!iconMap)
  useEffect(() => {
    if (iconMap) return
    const done = () => setLoaded(true)
    waiting.add(done)
    void loadIcons()
    return () => {
      waiting.delete(done)
    }
  }, [])
  return iconMap
}

interface Props {
  name: string
  folder?: boolean
  open?: boolean
  size?: number
}

export function FileTypeIcon({ name, folder, open, size = 15 }: Props) {
  const map = useIconMap()
  const { settings } = useSettings()
  if (!map) {
    const Icon = folder ? (open ? FolderOpen : Folder) : File
    return <Icon size={size} className="ce-ficon" color={folder ? '#6b9eff' : '#8e8e93'} />
  }
  const icon = iconFor(map, name, !!folder, !!open, settings.theme !== 'dark')
  return <img src={`${BASE}${icon}.svg`} alt="" width={size} height={size} className="ce-ficon" draggable={false} decoding="async" />
}
