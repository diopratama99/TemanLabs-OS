import { useEffect, useState } from 'react'
import { Cpu, Droplets, Lock, Moon, PanelBottom, Search, Settings, ShieldCheck, Sparkles, Sun, Waypoints, Zap, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import type { AdblockStatus, SystemStats } from '../api/types'
import { useAuth } from '../lib/auth'
import { supportsRefraction, useSettings } from '../lib/settings'
import { tr } from '../lib/i18n'
import type { SettingsSection } from '../windows/Settings'
import { Glass } from './Glass'
import { WallpaperPicker } from './Wallpaper'
import type { WindowId } from './Window'

// Quick Settings: tiles for what's changed most often, the server at a glance, and the wallpaper.

interface Props {
  stats?: SystemStats | null
  onOpenSettings: (section: SettingsSection) => void
  onOpenWindow: (id: WindowId) => void
  onQuickSearch: () => void
  /** Closes the panel (before opening something else). */
  onDone: () => void
}

export function QuickSettings({ stats, onOpenSettings, onOpenWindow, onQuickSearch, onDone }: Props) {
  const { settings, update } = useSettings()
  const { lock } = useAuth()
  const [adblock, setAdblock] = useState<AdblockStatus | null>(null)
  useEffect(() => {
    api.adblock().then(setAdblock, () => {})
  }, [])
  const dark = settings.theme === 'dark'
  const refraction = settings.refraction && supportsRefraction
  const ts = stats?.addresses.tailscale
  const blocking = !!adblock?.running && adblock.protection
  const go = (fn: () => void) => () => {
    onDone()
    fn()
  }

  const toggleAdblock = () => {
    if (!adblock?.installed || !adblock.running) return go(() => onOpenSettings('adblock'))()
    const next = !adblock.protection
    setAdblock({ ...adblock, protection: next })
    api.setAdblock(next).catch(() => setAdblock(adblock))
  }

  return (
    <Glass radius={28} bezel={18} depth={18} blur={18} className="control-center tint-panel" role="dialog" aria-label={tr('Quick Settings')}>
      <div className="cc-grid">
        <Tile
          icon={dark ? Moon : Sun}
          label={tr('Dark Mode')}
          sub={dark ? tr('Turned on') : tr('Turned off')}
          on={dark}
          onClick={() => update({ theme: dark ? 'light' : 'dark' })}
        />
        <button className="cc-square" onClick={go(() => onOpenWindow('activity'))} aria-label={tr('Open System Monitor')}>
          <span className="cc-square-host">{stats?.hostname ?? tr('Server')}</span>
          <span className="cc-square-big">
            <Cpu size={14} /> {stats ? `${Math.round(stats.cpu.usage)}%` : '–'}
          </span>
          <span className="cc-square-row">
            {stats?.power && (
              <>
                <Zap size={12} /> {stats.power.watts < 10 ? stats.power.watts.toFixed(1) : Math.round(stats.power.watts)} W
              </>
            )}
          </span>
          <small>{stats ? tr('{0}% memory', Math.round((stats.memory.used / stats.memory.total) * 100)) : ''}</small>
        </button>
        <Tile
          icon={ShieldCheck}
          label={tr('Ad Blocking')}
          sub={!adblock ? '…' : !adblock.installed ? tr('Not set up') : adblock.pausedFor ? tr('Paused') : blocking ? tr('Turned on') : tr('Turned off')}
          on={blocking}
          onClick={toggleAdblock}
        />
        <Tile
          icon={Waypoints}
          label={tr('Tailscale')}
          sub={ts ? ts.ipv4 : tr('Not connected')}
          on={!!ts}
          onClick={go(() => onOpenSettings('remote'))}
        />
        <Round icon={Lock} label={tr('Lock Screen')} onClick={go(lock)} />
        <Round icon={Search} label={tr('Quick Search')} onClick={go(onQuickSearch)} />
        <Round
          icon={Sparkles}
          label={supportsRefraction ? tr('Glass Effect') : tr('Glass Effect (Chromium browsers only)')}
          on={refraction}
          disabled={!supportsRefraction}
          onClick={() => update({ refraction: !settings.refraction })}
        />
        <Round icon={Droplets} label={tr('Reduce Transparency')} on={settings.reduceTransparency} onClick={() => update({ reduceTransparency: !settings.reduceTransparency })} />
        <Tile
          icon={PanelBottom}
          label={tr('Hide Dock')}
          sub={settings.dockAutohide ? tr('Automatically') : tr('Turned off')}
          on={settings.dockAutohide}
          onClick={() => update({ dockAutohide: !settings.dockAutohide })}
        />
      </div>
      <div className="cc-wallpaper">
        <span className="cc-label">{tr('Wallpaper')}</span>
        <WallpaperPicker compact onMore={go(() => onOpenSettings('wallpaper'))} />
      </div>
      <button className="cc-settings" onClick={go(() => onOpenSettings('general'))}>
        <Settings size={12} /> {tr('Settings…')}
      </button>
    </Glass>
  )
}

function Tile({ icon: Icon, label, sub, on, disabled, onClick }: { icon: LucideIcon; label: string; sub: string; on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`cc-tile ${on ? 'is-on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
      <span className="cc-tile-icon">
        <Icon size={16} />
      </span>
      <span className="cc-tile-text">
        <strong>{label}</strong>
        <small>{sub}</small>
      </span>
    </button>
  )
}

function Round({ icon: Icon, label, on, disabled, onClick }: { icon: LucideIcon; label: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`cc-round ${on ? 'is-on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={label} title={label}>
      <Icon size={18} />
    </button>
  )
}
