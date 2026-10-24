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

export const CODE_APP: SystemApp = { id: 'code', label: 'Code', icon: 'braces', color: ['#4fc3ff', '#1f5fd6'] }

export const SYSTEM_APPS: SystemApp[] = [
  { id: 'files', label: 'Files', icon: 'folder', color: ['#6fd8ff', '#1a8cff'] },
  CODE_APP,
  { id: 'store', label: 'App Center', icon: 'store', color: ['#3fc1ff', '#2d55ff'] },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', color: ['#4a4a4f', '#1c1c1e'] },
  { id: 'activity', label: 'System Monitor', icon: 'activity', color: ['#5be37d', '#14883a'], utility: true },
  { id: 'kubernetes', label: 'Kubernetes', icon: 'helm', color: ['#6a9bff', '#2349c9'] },
  { id: 'music', label: 'Music Player', icon: 'music', color: ['#ff7a93', '#f5203e'] },
  { id: 'settings', label: 'Settings', icon: 'settings', color: ['#a1a1a8', '#55555b'] },
  // Server utilities: in Launcher → Utilities, in the Dock only while open.
  { id: 'sharing', label: 'File Sharing', icon: 'share', color: ['#5ee0d0', '#0d8f88'], dock: false, utility: true },
  { id: 'updates', label: 'System Updates', icon: 'updates', color: ['#8e8e93', '#48484a'], dock: false, utility: true },
  { id: 'console', label: 'Log Viewer', icon: 'scroll', color: ['#4a4a4f', '#1c1c1e'], dock: false, utility: true },
  { id: 'disks', label: 'Disk Manager', icon: 'drive', color: ['#b8bcc6', '#5f6470'], dock: false, utility: true },
  { id: 'network', label: 'Network Tools', icon: 'network', color: ['#64d2ff', '#0a6cff'], dock: false, utility: true },
  { id: 'scheduler', label: 'Scheduled Tasks', icon: 'scheduler', color: ['#ff9f6b', '#e6501e'], dock: false, utility: true },
]

export const UTILITY_IDS = new Set<string>(SYSTEM_APPS.filter(a => a.utility).map(a => a.id))

/** Document viewers: opened from Files, and only in the Dock while they have a window. */
export const VIEWER_APPS: SystemApp[] = [
  { id: 'preview', label: 'Image Viewer', icon: 'images', color: ['#7fd3ff', '#2f7bff'] },
  { id: 'video', label: 'Video Player', icon: 'film', color: ['#5a5a62', '#1c1c1e'] },
]

export const LAUNCHER = { label: 'Launcher', icon: 'launchpad', color: ['#ff8ad8', '#7d5cff'] as [string, string] }
