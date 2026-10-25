import { useState } from 'react'
import { ChevronRight, MoreHorizontal, Search } from 'lucide-react'
import type { InstalledApp } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import type { MenuItem } from '../components/ContextMenu'
import type { WindowId } from '../components/Window'
import { useContextMenu } from '../lib/contextMenu'
import { tr } from '../lib/i18n'
import { SYSTEM_APPS } from '../lib/systemApps'

interface Props {
  apps: InstalledApp[]
  busy: ReadonlySet<string>
  onOpen: (id: WindowId) => void
  onOpenApp: (app: InstalledApp) => void
  /** What can be done with an app: start, stop, its settings… (the same as its right-click menu). */
  appMenu: (app: InstalledApp) => MenuItem[]
}

const STATUS: Record<string, string> = {
  running: tr('Running'),
  stopped: tr('Stopped'),
  exited: tr('Stopped'),
  installing: tr('Installing…'),
  starting: tr('Starting…'),
  restarting: tr('Restarting…'),
}

/** The Apps tab: the apps installed on the server, and everything TemanLabsOS itself does. */
export function AppsList({ apps, busy, onOpen, onOpenApp, appMenu }: Props) {
  const { show } = useContextMenu()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const installed = apps.filter(a => !q || a.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))
  const features = SYSTEM_APPS.filter(a => !q || a.label.toLowerCase().includes(q))
  return (
    <div className="m-apps">
      <label className="m-search">
        <Search size={17} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Search apps')} />
      </label>

      {installed.length > 0 && (
        <section className="m-section">
          <h3>{tr('Installed apps')}</h3>
          <div className="m-list">
            {installed.map(app => (
              <div key={app.id} className="m-row" onContextMenu={e => show(e, appMenu(app))}>
                <button className="m-row-main" onClick={() => onOpenApp(app)}>
                  <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={40} />
                  <span className="m-row-text">
                    <strong>{app.name}</strong>
                    <small>
                      <i className={`m-dot is-${app.status === 'running' ? 'on' : busy.has(app.id) ? 'busy' : 'off'}`} />
                      {busy.has(app.id) ? tr('Working…') : (STATUS[app.status] ?? app.status)}
                    </small>
                  </span>
                </button>
                <button
                  className="m-icon-btn"
                  aria-label={tr('More')}
                  onClick={e => {
                    const r = e.currentTarget.getBoundingClientRect()
                    show({ x: r.left, y: r.bottom }, appMenu(app))
                  }}
                >
                  <MoreHorizontal size={20} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="m-section">
        <h3>{tr('TemanLabsOS')}</h3>
        <div className="m-list">
          {features.map(app => (
            <button key={app.id} className="m-row" onClick={() => onOpen(app.id)}>
              <AppIcon icon={app.icon} color={app.color} size={40} />
              <span className="m-row-text">
                <strong>{app.label}</strong>
              </span>
              <ChevronRight size={18} className="m-chevron" />
            </button>
          ))}
        </div>
      </section>
      {q && installed.length === 0 && features.length === 0 && <p className="m-empty">{tr('No results for “{0}”', query.trim())}</p>}
    </div>
  )
}
