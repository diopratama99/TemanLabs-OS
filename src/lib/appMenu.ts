import { AppWindow, CircleArrowUp, ExternalLink, Link, Pin, PinOff, Play, Settings2, Square, SquareTerminal, Trash2, X } from 'lucide-react'
import type { InstalledApp } from '../api/types'
import type { MenuItem } from '../components/ContextMenu'
import { directUrl, hasWebUI, openApp as openInTab } from './apps'
import { copyText } from './clipboard'
import { tr } from './i18n'

interface Handlers {
  busy: boolean
  onOpen: (app: InstalledApp) => void
  onToggle: (app: InstalledApp) => void
  onUninstall: (id: string) => void
  /** App Settings; tab opens it on Terminal, update starts an update right away. */
  onSettings?: (app: InstalledApp, options?: { tab?: 'terminal'; update?: boolean }) => void
  updateAvailable?: boolean
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
  const docker = app.source !== 'native'
  // Native apps start and stop through their systemd service; plain processes can't be.
  const controllable = docker || !!app.unit
  const uninstall: MenuItem = docker
    ? {
        label: tr('Uninstall…'),
        confirm: tr('Click Again to Uninstall (keeps its data)'),
        icon: Trash2,
        danger: true,
        disabled: h.busy || installing,
        onSelect: () => h.onUninstall(app.id),
      }
    : { label: tr('Runs outside Docker'), icon: Trash2, disabled: true, onSelect: () => {} }
  const manage: MenuItem[] =
    docker && h.onSettings
      ? [
          { label: tr('Settings…'), icon: Settings2, disabled: installing, onSelect: () => h.onSettings!(app) },
          {
            label: h.updateAvailable ? tr('Update Available…') : tr('Update'),
            icon: CircleArrowUp,
            disabled: h.busy || installing,
            onSelect: () => h.onSettings!(app, { update: true }),
          },
          { label: tr('Open Terminal'), icon: SquareTerminal, disabled: !running, onSelect: () => h.onSettings!(app, { tab: 'terminal' }) },
        ]
      : []
  return [
    { label: tr('Open'), icon: AppWindow, disabled: installing || !hasWebUI(app), onSelect: () => h.onOpen(app) },
    { label: tr('Open in New Tab'), icon: ExternalLink, disabled: !running || !url, onSelect: () => openInTab(app) },
    { label: tr('Copy Address'), icon: Link, disabled: !url, onSelect: () => url && void copyText(url) },
    ...(h.onCloseWindow ? [{ label: tr('Close Window'), icon: X, onSelect: h.onCloseWindow }] : []),
    ...(h.onTogglePin
      ? [{ label: h.pinned ? tr('Remove from Dock') : tr('Keep in Dock'), icon: h.pinned ? PinOff : Pin, onSelect: h.onTogglePin }]
      : []),
    'separator',
    {
      label: running ? tr('Stop') : tr('Start'),
      icon: running ? Square : Play,
      disabled: h.busy || installing || !controllable,
      onSelect: () => h.onToggle(app),
    },
    ...manage,
    'separator',
    uninstall,
  ]
}
