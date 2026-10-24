import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Monitor, Moon, Search, Sun, type LucideIcon } from 'lucide-react'
import type { InstalledApp } from '../api/types'
import { useSettings } from '../lib/settings'
import { LAUNCHER, SYSTEM_APPS } from '../lib/systemApps'
import { AppIcon } from './AppIcon'
import { Glass } from './Glass'
import type { WindowId } from './Window'

interface Result {
  key: string
  group: string
  label: string
  sub?: string
  icon: ReactNode
  run: () => void
}

const STATUS_LABEL = { running: 'Running', stopped: 'Stopped', installing: 'Installing' } as const

function ActionIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="spot-icon">
      <Icon size={16} />
    </span>
  )
}

interface Props {
  /** Playing its exit animation. */
  closing?: boolean
  apps: InstalledApp[]
  onClose: () => void
  onOpenApp: (app: InstalledApp) => void
  onOpenWindow: (id: WindowId) => void
  onLauncher: () => void
  onShowDesktop: () => void
}

export function QuickSearch({ closing = false, apps, onClose, onOpenApp, onOpenWindow, onLauncher, onShowDesktop }: Props) {
  const { settings, update } = useSettings()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const dark = settings.theme === 'dark'

  const all: Result[] = [
    ...apps.map(app => ({
      key: `app:${app.id}`,
      group: 'Apps',
      label: app.name,
      sub: `${app.category} · ${STATUS_LABEL[app.status]}`,
      icon: <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={30} />,
      run: () => onOpenApp(app),
    })),
    ...SYSTEM_APPS.map(app => ({
      key: app.id,
      group: 'System',
      label: app.label,
      icon: <AppIcon icon={app.icon} color={app.color} size={30} />,
      run: () => onOpenWindow(app.id),
    })),
    {
      key: 'launchpad',
      group: 'System',
      label: LAUNCHER.label,
      icon: <AppIcon icon={LAUNCHER.icon} color={LAUNCHER.color} size={30} />,
      run: onLauncher,
    },
    {
      key: 'theme',
      group: 'Actions',
      label: dark ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      icon: <ActionIcon icon={dark ? Sun : Moon} />,
      run: () => update({ theme: dark ? 'light' : 'dark' }),
    },
    { key: 'desktop', group: 'Actions', label: 'Show Desktop', icon: <ActionIcon icon={Monitor} />, run: onShowDesktop },
  ]

  const q = query.trim().toLowerCase()
  const results = q
    ? all.filter(r => r.label.toLowerCase().includes(q) || r.group.toLowerCase().includes(q)).slice(0, 8)
    : []
  const active = Math.min(selected, results.length - 1)

  const runResult = (result: Result) => {
    result.run()
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      runResult(results[active])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className={`spotlight-overlay ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <Glass radius={28} bezel={18} depth={20} blur={20} className="spotlight tint-panel" role="dialog" aria-label="Quick Search">
        <div className="spot-input">
          <Search size={22} />
          <input
            autoFocus
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Quick Search"
            aria-label="Quick Search"
          />
        </div>
        {q && (
          <div className="spot-results" role="listbox">
            {results.length === 0 && <p className="spot-empty">No results for “{query}”</p>}
            {results.map((result, i) => (
              <div key={result.key}>
                {result.group !== results[i - 1]?.group && <div className="spot-group">{result.group}</div>}
                <button
                  role="option"
                  aria-selected={i === active}
                  className={`spot-row ${i === active ? 'is-selected' : ''}`}
                  onPointerEnter={() => setSelected(i)}
                  onClick={() => runResult(result)}
                >
                  {result.icon}
                  <span>
                    {result.label}
                    {result.sub && <small>{result.sub}</small>}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </Glass>
    </div>
  )
}
