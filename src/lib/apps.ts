import type { InstalledApp } from '../api/types'

type Addressable = Pick<InstalledApp, 'port'> & Partial<Pick<InstalledApp, 'path' | 'scheme'>>

/** The app's web UI on this server's host (works the same over LAN and Tailscale), or null. */
export function appUrl(app: Addressable): string | null {
  if (!app.port) return null
  const path = app.path && app.path !== '/' ? (app.path.startsWith('/') ? app.path : `/${app.path}`) : '/'
  return `${app.scheme || 'http'}://${location.hostname}:${app.port}${path}`
}

export const hasWebUI = (app: Addressable) => !!app.port

/**
 * The address another device can open directly; null for apps on localhost only, which are
 * reachable through TemanLabsOS's window proxy alone.
 */
export const directUrl = (app: Addressable & Pick<InstalledApp, 'localOnly'>) => (app.localOnly ? null : appUrl(app))

export function openApp(app: Addressable) {
  const url = appUrl(app)
  if (url) window.open(url, '_blank', 'noopener')
}
