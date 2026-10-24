import { useCallback, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import {
  Copy,
  Cpu,
  Zap,
  Droplets,
  EthernetPort,
  Globe,
  Info,
  Link,
  Moon,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Waypoints,
  Wifi,
  type LucideIcon,
  Power,
  RotateCcw,
} from 'lucide-react'
import type { NetworkAddresses, SystemStats } from '../api/types'
import { useClock } from '../hooks/useClock'
import type { StatsHistory } from '../hooks/useSystemStats'
import type { SettingsSection } from '../windows/Settings'
import { ClockPanel, CpuPanel, isWireless, NetworkPanel, PowerPanel } from './StatusPanels'
import { useDismiss } from '../hooks/useDismiss'
import type { AppMenu } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { MOD } from '../lib/platform'
import { supportsRefraction, useSettings } from '../lib/settings'
import { ContextMenu, type MenuAnchor, type MenuItem } from './ContextMenu'
import { Glass } from './Glass'
import { WallpaperPicker } from './Wallpaper'
import type { WindowId } from './Window'
import { LogoGlyph } from './Logo'
import { tr } from '../lib/i18n'

export const QUICK_SEARCH_SHORTCUT = `${MOD}K`

/** What the menu bar shows for the frontmost app. */
export interface MenuBarContent {
  /** Bold app name; also a menu (About, Hide, Quit…). */
  appName: string
  appMenu: MenuItem[]
  /** App menus followed by Window and Help. */
  menus: AppMenu[]
}

// Menu keys: the system logo menu, the app-name menu, an app menu by its label, or an IP status item.
type MenuKey = 'logo' | 'app' | `menu:${string}` | 'ip:lan' | 'ip:tailscale'

/** URL of this dashboard reached through another address, e.g. the Tailscale IP. */
const dashboardUrl = (host: string) => `${location.protocol}//${host}${location.port ? `:${location.port}` : ''}`

function addressMenu(title: string, ip: string, dnsName?: string): MenuItem[] {
  return [
    { label: title, disabled: true, onSelect: () => {} },
    'separator',
    { label: tr('Copy IP Address ({0})', ip), icon: Copy, onSelect: () => void copyText(ip) },
    ...(dnsName
      ? ([{ label: tr('Copy MagicDNS Name ({0})', dnsName), icon: Globe, onSelect: () => void copyText(dnsName) }] as MenuItem[])
      : []),
    { label: tr('Copy Dashboard URL'), icon: Link, onSelect: () => void copyText(dashboardUrl(ip)) },
  ]
}

interface Props {
  /**
   * Called on every render rather than passed as data, because the menus come from components
   * further down the tree whose state changes don't re-render the menu bar's parent.
 */
  getContent: () => MenuBarContent
  cpu?: number
  /** Watts, when the server measures them (see SystemStats.power). */
  power?: SystemStats['power']
  addresses?: NetworkAddresses
  /** For the status panels (processor, power, network): the latest reading and recent history. */
  stats?: SystemStats | null
  history?: StatsHistory
  onOpenWindow: (id: WindowId) => void
  /** Opens Settings at a section (the clock's panel → Date & Time). */
  onOpenSettings?: (section: SettingsSection) => void
  onQuickSearch: () => void
  onPower: (action: 'restart' | 'shutdown') => void
}

type StatusPanel = 'cpu' | 'power' | 'net' | 'cc' | 'clock'

export function MenuBar({ getContent, cpu, power, addresses, stats, history, onOpenWindow, onOpenSettings, onQuickSearch, onPower }: Props) {
  const now = useClock()
  const [menu, setMenu] = useState<{ key: MenuKey; anchor: MenuAnchor } | null>(null)
  // The status items' panels (Quick Settings among them); one at a time.
  const [panel, setPanel] = useState<StatusPanel | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closePanel = useCallback(() => setPanel(null), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  useDismiss(panelRef, !!panel, closePanel)
  const togglePanel = (key: StatusPanel) => {
    setMenu(null)
    setPanel(p => (p === key ? null : key))
  }
  // A status item and the panel under it.
  const status = (key: StatusPanel, label: string, className: string, content: ReactNode, body: ReactNode) => (
    <div className="cc-anchor" ref={panel === key ? panelRef : undefined}>
      <button className={`${className} ${panel === key ? 'is-active' : ''}`} onClick={() => togglePanel(key)} aria-label={label} aria-expanded={panel === key}>
        {content}
      </button>
      {panel === key && body}
    </div>
  )

  const { appName, appMenu, menus } = getContent()

  const openMenu = (key: MenuKey, el: HTMLElement) => {
    setPanel(null)
    const rect = el.getBoundingClientRect()
    setMenu({ key, anchor: { x: rect.left, y: rect.bottom + 6 } })
  }

  const trigger = (key: MenuKey, className = ''): ButtonHTMLAttributes<HTMLButtonElement> => ({
    className: `menubar-item ${className} ${menu?.key === key ? 'is-active' : ''}`,
    'aria-haspopup': 'menu',
    'aria-expanded': menu?.key === key,
    // Keep the menu's outside-press handler from closing it before onClick toggles.
    onPointerDown: e => e.stopPropagation(),
    onClick: e => (menu?.key === key ? setMenu(null) : openMenu(key, e.currentTarget)),
    // Once a menu is open, hovering another title switches to it.
    onPointerEnter: e => menu && menu.key !== key && openMenu(key, e.currentTarget),
  })

  const logoMenu: MenuItem[] = [
    { label: tr('About This Server'), icon: Info, onSelect: () => onOpenWindow('settings') },
    { label: tr('Settings…'), icon: Settings, onSelect: () => onOpenWindow('settings') },
    { label: tr('App Center…'), icon: ShoppingBag, onSelect: () => onOpenWindow('store') },
    'separator',
    { label: tr('Quick Search'), icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: onQuickSearch },
    'separator',
    { label: tr('Restart Server…'), icon: RotateCcw, confirm: tr('Click Again to Restart'), onSelect: () => onPower('restart') },
    { label: tr('Shut Down Server…'), icon: Power, danger: true, confirm: tr('Click Again to Shut Down'), onSelect: () => onPower('shutdown') },
  ]

  // Resolved on each render so an open menu follows the app's latest state; if the frontmost app
  // changed and the open menu no longer exists, nothing is shown.
  const lan = addresses?.lan
  const tailscale = addresses?.tailscale
  const openItems =
    menu?.key === 'logo'
      ? logoMenu
      : menu?.key === 'app'
        ? appMenu
        : menu?.key === 'ip:lan' && lan
          ? addressMenu(`Local Network · ${lan.interface}`, lan.ipv4)
          : menu?.key === 'ip:tailscale' && tailscale
            ? addressMenu('Tailscale · Connected', tailscale.ipv4, tailscale.dnsName)
            : menus.find(m => menu && `menu:${m.label}` === menu.key)?.items

  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return (
    <header className="menubar">
      <div className="menubar-left">
        <button {...trigger('logo')} aria-label={tr('TemanLabsOS menu')}>
          <LogoGlyph className="logo-mark" size={16} mono />
        </button>
        <button {...trigger('app', 'menubar-app')} aria-label={tr('{0} menu', appName)}>
          {appName}
        </button>
        {menus.map(m => (
          <button key={m.label} {...trigger(`menu:${m.label}`)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="menubar-right">
        {lan && (
          <button {...trigger('ip:lan', 'menubar-ip')} aria-label={tr('Local IP {0}', lan.ipv4)} title={tr('Local network ({0})', lan.interface)}>
            <EthernetPort size={14} />
            <span className="menubar-ip-text">{lan.ipv4}</span>
          </button>
        )}
        {tailscale && (
          <button
            {...trigger('ip:tailscale', 'menubar-ip')}
            aria-label={tr('Tailscale IP {0}', tailscale.ipv4)}
            title={tailscale.dnsName ? tr('Tailscale · {0}', tailscale.dnsName) : tr('Tailscale')}
          >
            <Waypoints size={14} />
            <span className="menubar-ip-text">{tailscale.ipv4}</span>
          </button>
        )}
        {status(
          'cpu',
          tr('CPU usage'),
          'menubar-stat',
          <>
            <Cpu size={14} /> {cpu === undefined ? '–' : `${Math.round(cpu)}%`}
          </>,
          stats && history && (
            <CpuPanel
              stats={stats}
              history={history}
              onOpen={() => {
                setPanel(null)
                onOpenWindow('activity')
              }}
            />
          ),
        )}
        {power &&
          status(
            'power',
            tr('Power draw {0} watts', power.watts.toFixed(1)),
            'menubar-stat',
            <>
              <Zap size={13} /> {power.watts < 10 ? power.watts.toFixed(1) : Math.round(power.watts)} W
            </>,
            history && <PowerPanel power={power} history={history} />,
          )}
        {status(
          'net',
          lan ? tr('Network: {0}', lan.ipv4) : tr('Network'),
          'menubar-icon',
          isWireless(lan?.interface) ? <Wifi size={15} /> : <EthernetPort size={15} />,
          stats && history && (
            <NetworkPanel
              stats={stats}
              history={history}
              onOpen={() => {
                setPanel(null)
                onOpenWindow('network')
              }}
            />
          ),
        )}
        <button className="menubar-icon" onClick={onQuickSearch} aria-label={tr('Quick Search')}>
          <Search size={15} />
        </button>
        {status('cc', tr('Quick Settings'), 'menubar-icon', <SlidersHorizontal size={15} />,
          <ControlCenter
            onWallpapers={() => {
              setPanel(null)
              if (onOpenSettings) onOpenSettings('appearance')
              else onOpenWindow('settings')
            }}
          />,
        )}
        {status(
          'clock',
          tr('Date and time'),
          'menubar-clock',
          <>
            <span className="menubar-date">
              {date}
              {tr('  ')}
            </span>
            {time}
          </>,
          <ClockPanel
            now={now}
            onSettings={() => {
              setPanel(null)
              if (onOpenSettings) onOpenSettings('datetime')
              else onOpenWindow('settings')
            }}
          />,
        )}
      </div>
      {menu && openItems && (
        <ContextMenu key={menu.key} items={openItems} anchor={menu.anchor} onClose={closeMenu} />
      )}
    </header>
  )
}

function ControlCenter({ onWallpapers }: { onWallpapers: () => void }) {
  const { settings, update } = useSettings()
  const dark = settings.theme === 'dark'
  const refraction = settings.refraction && supportsRefraction
  return (
    <Glass
      radius={28}
      bezel={18}
      depth={18}
      blur={18}
      className="control-center tint-panel"
      role="dialog"
      aria-label={tr('Quick Settings')}
    >
      <CcToggle
        icon={dark ? Moon : Sun}
        label={tr('Dark Mode')}
        sub={dark ? tr('Turned on') : tr('Turned off')}
        on={dark}
        onClick={() => update({ theme: dark ? 'light' : 'dark' })}
      />
      <CcToggle
        icon={Sparkles}
        label={tr('Glass Effect')}
        sub={supportsRefraction ? (refraction ? tr('Refraction on') : tr('Refraction off')) : tr('Chromium browsers only')}
        on={refraction}
        disabled={!supportsRefraction}
        onClick={() => update({ refraction: !settings.refraction })}
      />
      <CcToggle
        icon={Droplets}
        label={tr('Reduce Transparency')}
        sub={settings.reduceTransparency ? tr('Turned on') : tr('Turned off')}
        on={settings.reduceTransparency}
        onClick={() => update({ reduceTransparency: !settings.reduceTransparency })}
      />
      <div>
        <span className="cc-label">{tr('Wallpaper')}</span>
        <WallpaperPicker compact onMore={onWallpapers} />
      </div>
    </Glass>
  )
}

interface CcToggleProps {
  icon: LucideIcon
  label: string
  sub: string
  on: boolean
  disabled?: boolean
  onClick: () => void
}

function CcToggle({ icon: Icon, label, sub, on, disabled, onClick }: CcToggleProps) {
  return (
    <button className={`cc-toggle ${on ? 'is-on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
      <span className="cc-toggle-icon">
        <Icon size={16} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{sub}</small>
      </span>
    </button>
  )
}
