import { tr } from './i18n'
import type { SystemWindowId } from '../components/Window'

export interface SystemApp {
  id: SystemWindowId
  label: string
  icon: string
  color: [string, string]
  /** Kept out of the Dock (shown there only while open), like most desktop utilities. */
  dock?: false
  /** Lives in Launcher's Utilities folder. */
  utility?: true
}

export const CODE_APP: SystemApp = { id: 'code', label: tr('Code'), icon: 'braces', color: ['#4fc3ff', '#1f5fd6'] }

export const SYSTEM_APPS: SystemApp[] = [
  { id: 'files', label: tr('Files'), icon: 'folder', color: ['#6fd8ff', '#1a8cff'] },
  CODE_APP,
  { id: 'store', label: tr('App Center'), icon: 'store', color: ['#3fc1ff', '#2d55ff'] },
  { id: 'terminal', label: tr('Terminal'), icon: 'terminal', color: ['#4a4a4f', '#1c1c1e'] },
  { id: 'activity', label: tr('System Monitor'), icon: 'activity', color: ['#5be37d', '#14883a'], utility: true },
  { id: 'kubernetes', label: tr('Kubernetes'), icon: 'helm', color: ['#6a9bff', '#2349c9'] },
  { id: 'music', label: tr('Music Player'), icon: 'music', color: ['#ff7a93', '#f5203e'] },
  { id: 'settings', label: tr('Settings'), icon: 'settings', color: ['#a1a1a8', '#55555b'] },
  // The other computers: wake them, and use their screens in a window.
  { id: 'devices', label: tr('Devices'), icon: 'devices', color: ['#7cc8ff', '#3b5bfd'], dock: false },
  // Server utilities: in Launcher → Utilities, in the Dock only while open.
  { id: 'sharing', label: tr('File Sharing'), icon: 'share', color: ['#5ee0d0', '#0d8f88'], dock: false, utility: true },
  { id: 'updates', label: tr('System Updates'), icon: 'updates', color: ['#8e8e93', '#48484a'], dock: false, utility: true },
  { id: 'console', label: tr('Log Viewer'), icon: 'scroll', color: ['#4a4a4f', '#1c1c1e'], dock: false, utility: true },
  { id: 'disks', label: tr('Disk Manager'), icon: 'drive', color: ['#b8bcc6', '#5f6470'], dock: false, utility: true },
  { id: 'network', label: tr('Network Tools'), icon: 'network', color: ['#64d2ff', '#0a6cff'], dock: false, utility: true },
  { id: 'scheduler', label: tr('Scheduled Tasks'), icon: 'scheduler', color: ['#ff9f6b', '#e6501e'], dock: false, utility: true },
  { id: 'remux', label: tr('Remux'), icon: 'remux', color: ['#ffc25c', '#ff6a2b'], dock: false, utility: true },
  { id: 'commands', label: tr('Commands'), icon: 'commands', color: ['#5eead4', '#0f8a7a'], dock: false, utility: true },
]

export const UTILITY_IDS = new Set<string>(SYSTEM_APPS.filter(a => a.utility).map(a => a.id))

/** Document viewers: opened from Files, and only in the Dock while they have a window. */
export const VIEWER_APPS: SystemApp[] = [
  { id: 'preview', label: tr('Image Viewer'), icon: 'images', color: ['#7fd3ff', '#2f7bff'] },
  { id: 'video', label: tr('Video Player'), icon: 'film', color: ['#5a5a62', '#1c1c1e'] },
]

export const LAUNCHER = { label: tr('Launcher'), icon: 'launchpad', color: ['#ff8ad8', '#7d5cff'] as [string, string] }
export const TRASH = { label: tr('Trash'), icon: 'trash', color: ['#c7ccd4', '#7d838d'] as [string, string] }
