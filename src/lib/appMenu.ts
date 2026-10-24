import { AppWindow, ExternalLink, Link, Pin, PinOff, Play, Square, Trash2, X } from 'lucide-react'
import type { InstalledApp } from '../api/types'
import type { MenuItem } from '../components/ContextMenu'
import { directUrl, hasWebUI, openApp as openInTab } from './apps'
import { copyText } from './clipboard'

interface Handlers {
  busy: boolean
  onOpen: (app: InstalledApp) => void
  onToggle: (app: InstalledApp) => void
  onUninstall: (id: string) => void
  /** Present when the app has a window open. */
  onCloseWindow?: () => void
  /** Present where Dock pinning applies (Dock, Launcher). */
  pinned?: boolean
  onTogglePin?: () => void
}

/** Right-click menu for an installed app, shared by the Dock, Launcher and App Center. */
export function appMenuItems(app: InstalledApp, h: Handlers): MenuItem[] {
  const running = app.status === 'running'
  const installing = app.status === 'installing'
  const url = directUrl(app)
  // Native apps start and stop through their systemd service; plain processes can't be.
  const controllable = app.source !== 'native' || !!app.unit
  const uninstall: MenuItem = app.canUninstall
    ? {
        label: 'Uninstall…',
        confirm: 'Click Again to Uninstall',
        icon: Trash2,
        danger: true,
        disabled: h.busy || installing,
        onSelect: () => h.onUninstall(app.id),
      }
    : {
        label:
          app.source === 'casaos'
            ? 'Uninstall in CasaOS'
            : app.source === 'native'
              ? 'Runs outside Docker'
              : 'Not installed by TemanLabsOS',
        icon: Trash2,
        disabled: true,
        onSelect: () => {},
      }
  return [
    { label: 'Open', icon: AppWindow, disabled: installing || !hasWebUI(app), onSelect: () => h.onOpen(app) },
    { label: 'Open in New Tab', icon: ExternalLink, disabled: !running || !url, onSelect: () => openInTab(app) },
    { label: 'Copy Address', icon: Link, disabled: !url, onSelect: () => url && void copyText(url) },
    ...(h.onCloseWindow ? [{ label: 'Close Window', icon: X, onSelect: h.onCloseWindow }] : []),
    ...(h.onTogglePin
      ? [{ label: h.pinned ? 'Remove from Dock' : 'Keep in Dock', icon: h.pinned ? PinOff : Pin, onSelect: h.onTogglePin }]
      : []),
    'separator',
    {
      label: running ? 'Stop' : 'Start',
      icon: running ? Square : Play,
      disabled: h.busy || installing || !controllable,
      onSelect: () => h.onToggle(app),
    },
    uninstall,
  ]
}
