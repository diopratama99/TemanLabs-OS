import { useEffect, useState } from 'react'
import { ChevronRight, CircleAlert, CircleArrowUp, Cpu, HardDrive, MemoryStick, Network, Power, RotateCw, Thermometer } from 'lucide-react'
import { api } from '../api'
import type { AppHealth, InstalledApp, SystemStats } from '../api/types'
import { AppIcon } from '../components/AppIcon'
import type { WindowId } from '../components/Window'
import { formatBytes, formatSpeed, formatUptime } from '../lib/format'
import { tr } from '../lib/i18n'
import { useSettings } from '../lib/settings'
import { currentAppId, SYSTEM_APPS } from '../lib/systemApps'

interface Props {
  stats: SystemStats | null
  apps: InstalledApp[]
  updates: { apps: number; packages: number; release: boolean }
  onOpen: (id: WindowId) => void
  onOpenApp: (app: InstalledApp) => void
  onOpenUpdates: (which: 'apps' | 'packages' | 'release') => void
  onPower: (action: 'restart' | 'shutdown') => void
}

// Shortcuts until something has been opened from here.
const DEFAULT_SHORTCUTS: WindowId[] = ['downloader', 'activity', 'store', 'terminal', 'network', 'devices', 'remux', 'files']

/** The phone's first screen: how the server is, what needs a look, and the way to what's used most. */
export function Home({ stats, apps, updates, onOpen, onOpenApp, onOpenUpdates, onPower }: Props) {
  const { settings } = useSettings()
  const [health, setHealth] = useState<AppHealth[]>([])
  const [armed, setArmed] = useState<'restart' | 'shutdown' | null>(null)
  useEffect(() => {
    const load = () => api.appHealth().then(setHealth, () => {})
    void load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [])

  const down = health.filter(h => h.status === 'down').map(h => apps.find(a => a.id === h.id)).filter((a): a is InstalledApp => !!a)
  const disk = stats?.disks.filter(d => !d.cloud).sort((a, b) => b.total - a.total)[0]
  const pct = (used: number, total: number) => (total ? Math.round((used / total) * 100) : 0)

  // What was opened lately, then the usual ones, eight in all.
  // Apps since merged into others count as the app they went into.
  const recent = (settings.recentApps ?? []).map(currentAppId).filter(id => !id.startsWith('app:') || apps.some(a => `app:${a.id}` === id))
  const shortcuts = [...new Set([...recent, ...DEFAULT_SHORTCUTS])].slice(0, 8)

  return (
    <div className="m-home">
      <section className="m-hero">
        <div>
          <h2>{stats?.hostname ?? tr('Server')}</h2>
          <p>{stats ? tr('Up for {0}', formatUptime(stats.uptime)) : tr('Loading…')}</p>
        </div>
        <span className={`m-pill ${stats ? 'is-ok' : ''}`}>{stats ? tr('Online') : '…'}</span>
      </section>

      <section className="m-stats">
        <Stat icon={Cpu} label={tr('Processor')} value={stats ? `${Math.round(stats.cpu.usage)}%` : '–'} bar={stats?.cpu.usage} note={stats ? tr('{0} cores', stats.cpu.cores) : ''} />
        <Stat
          icon={MemoryStick}
          label={tr('Memory')}
          value={stats ? `${pct(stats.memory.used, stats.memory.total)}%` : '–'}
          bar={stats ? pct(stats.memory.used, stats.memory.total) : undefined}
          note={stats ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}` : ''}
        />
        <Stat
          icon={HardDrive}
          label={tr('Storage')}
          value={disk ? `${pct(disk.used, disk.total)}%` : '–'}
          bar={disk ? pct(disk.used, disk.total) : undefined}
          note={disk ? tr('{0} free', formatBytes(disk.total - disk.used)) : ''}
        />
        <Stat icon={Thermometer} label={tr('Temperature')} value={stats?.cpu.temp ? `${Math.round(stats.cpu.temp)}°C` : '–'} note={tr('Processor')} />
        <Stat
          icon={Network}
          label={tr('Network')}
          value={stats ? `↓ ${formatSpeed(stats.network.rx)}` : '–'}
          note={stats ? `↑ ${formatSpeed(stats.network.tx)}` : ''}
          wide
        />
      </section>

      {(down.length > 0 || updates.apps > 0 || updates.packages > 0 || updates.release) && (
        <section className="m-section">
          <h3>{tr('Needs a look')}</h3>
          <div className="m-list">
            {down.map(app => (
              <button key={app.id} className="m-row" onClick={() => onOpenApp(app)}>
                <CircleAlert size={20} className="m-row-icon is-bad" />
                <span className="m-row-text">
                  <strong>{tr('{0} isn’t responding', app.name)}</strong>
                  <small>{tr('Open it, or restart it from Apps')}</small>
                </span>
                <ChevronRight size={18} className="m-chevron" />
              </button>
            ))}
            {updates.release && (
              <button className="m-row" onClick={() => onOpenUpdates('release')}>
                <CircleArrowUp size={20} className="m-row-icon is-accent" />
                <span className="m-row-text">
                  <strong>{tr('TemanLabsOS update available')}</strong>
                  <small>{tr('Settings → Software Update')}</small>
                </span>
                <ChevronRight size={18} className="m-chevron" />
              </button>
            )}
            {updates.apps > 0 && (
              <button className="m-row" onClick={() => onOpenUpdates('apps')}>
                <CircleArrowUp size={20} className="m-row-icon is-accent" />
                <span className="m-row-text">
                  <strong>{tr('{0} app updates', updates.apps)}</strong>
                  <small>{tr('App Center')}</small>
                </span>
                <ChevronRight size={18} className="m-chevron" />
              </button>
            )}
            {updates.packages > 0 && (
              <button className="m-row" onClick={() => onOpenUpdates('packages')}>
                <CircleArrowUp size={20} className="m-row-icon is-accent" />
                <span className="m-row-text">
                  <strong>{tr('{0} system updates', updates.packages)}</strong>
                  <small>{tr('System Updates')}</small>
                </span>
                <ChevronRight size={18} className="m-chevron" />
              </button>
            )}
          </div>
        </section>
      )}

      <section className="m-section">
        <h3>{tr('Shortcuts')}</h3>
        <div className="m-shortcuts">
          {shortcuts.map(id => {
            const app = id.startsWith('app:') ? apps.find(a => `app:${a.id}` === id) : undefined
            const sys = SYSTEM_APPS.find(a => a.id === id)
            if (!app && !sys) return null
            return (
              <button key={id} className="m-shortcut" onClick={() => (app ? onOpenApp(app) : onOpen(id as WindowId))}>
                {app ? <AppIcon icon={app.icon} iconUrl={app.iconUrl} color={app.color} size={48} /> : <AppIcon icon={sys!.icon} color={sys!.color} size={48} />}
                <span>{app?.name ?? sys!.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="m-section">
        <h3>{tr('Power')}</h3>
        <div className="m-list">
          {(['restart', 'shutdown'] as const).map(action => (
            <button
              key={action}
              className={`m-row ${action === 'shutdown' ? 'is-danger' : ''}`}
              onClick={() => {
                if (armed !== action) {
                  setArmed(action)
                  return
                }
                setArmed(null)
                onPower(action)
              }}
            >
              {action === 'restart' ? <RotateCw size={20} className="m-row-icon" /> : <Power size={20} className="m-row-icon" />}
              <span className="m-row-text">
                <strong>
                  {armed === action ? tr('Tap again to confirm') : action === 'restart' ? tr('Restart the server') : tr('Shut down the server')}
                </strong>
                {armed !== action && <small>{action === 'restart' ? tr('Apps come back by themselves') : tr('It has to be turned on by hand again')}</small>}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ icon: Icon, label, value, note, bar, wide }: { icon: typeof Cpu; label: string; value: string; note?: string; bar?: number; wide?: boolean }) {
  return (
    <div className={`m-stat ${wide ? 'is-wide' : ''}`}>
      <span className="m-stat-label">
        <Icon size={15} /> {label}
      </span>
      <strong>{value}</strong>
      {bar !== undefined && (
        <span className="m-meter">
          <i style={{ width: `${Math.min(100, Math.max(2, bar))}%` }} className={bar > 85 ? 'is-high' : ''} />
        </span>
      )}
      {note && <small>{note}</small>}
    </div>
  )
}
