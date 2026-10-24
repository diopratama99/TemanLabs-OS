import { ArrowDownToLine, Boxes, Clapperboard, Code, FileText, HardDrive, Images, type LucideIcon } from 'lucide-react'

/** Where CasaOS keeps user data; Files and Code start here. */
export const DATA_ROOT = '/DATA'

export interface Place {
  path: string
  label: string
  icon: LucideIcon
}

/** Favorite folders inside /DATA (the CasaOS layout). See hooks/usePlaces for the full sidebar. */
export const PLACES: Place[] = [
  { path: DATA_ROOT, label: 'DATA', icon: HardDrive },
  { path: `${DATA_ROOT}/Documents`, label: 'Documents', icon: FileText },
  { path: `${DATA_ROOT}/Downloads`, label: 'Downloads', icon: ArrowDownToLine },
  { path: `${DATA_ROOT}/Gallery`, label: 'Gallery', icon: Images },
  { path: `${DATA_ROOT}/Media`, label: 'Media', icon: Clapperboard },
  { path: `${DATA_ROOT}/Projects`, label: 'Projects', icon: Code },
  { path: `${DATA_ROOT}/AppData`, label: 'AppData', icon: Boxes },
]
