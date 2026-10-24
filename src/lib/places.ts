import { ArrowDownToLine, Boxes, Clapperboard, Code, FileText, HardDrive, Images, type LucideIcon } from 'lucide-react'
import { tr } from './i18n'

/** Files' lists that aren't folders: files opened lately, and the Trash. */
export const RECENTS_PLACE = 'recents:'
export const TRASH_PLACE = 'trash:'

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
  { path: `${DATA_ROOT}/Documents`, label: tr('Documents'), icon: FileText },
  { path: `${DATA_ROOT}/Downloads`, label: tr('Downloads'), icon: ArrowDownToLine },
  { path: `${DATA_ROOT}/Gallery`, label: tr('Gallery'), icon: Images },
  { path: `${DATA_ROOT}/Media`, label: tr('Media'), icon: Clapperboard },
  { path: `${DATA_ROOT}/Projects`, label: tr('Projects'), icon: Code },
  { path: `${DATA_ROOT}/AppData`, label: tr('AppData'), icon: Boxes },
]
