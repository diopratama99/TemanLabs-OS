import { useCallback, useRef, useState, type ButtonHTMLAttributes } from 'react'
import {
  Copy,
  Cpu,
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
import type { NetworkAddresses } from '../api/types'
import { useClock } from '../hooks/useClock'
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
    { label: `Copy IP Address (${ip})`, icon: Copy, onSelect: () => void copyText(ip) },
    ...(dnsName
      ? ([{ label: `Copy MagicDNS Name (${dnsName})`, icon: Globe, onSelect: () => void copyText(dnsName) }] as MenuItem[])
      : []),
    { label: 'Copy Dashboard URL', icon: Link, onSelect: () => void copyText(dashboardUrl(ip)) },
  ]
}

interface Props {
  /**
   * Called on every render rather than passed as data, because the menus come from components
   * further down the tree whose state changes don't re-render the menu bar's parent.
 */
  getContent: () => MenuBarContent
  cpu?: number
  addresses?: NetworkAddresses
  onOpenWindow: (id: WindowId) => void
  onQuickSearch: () => void
  onPower: (action: 'restart' | 'shutdown') => void
}

export function MenuBar({ getContent, cpu, addresses, onOpenWindow, onQuickSearch, onPower }: Props) {
  const now = useClock()
  const [menu, setMenu] = useState<{ key: MenuKey; anchor: MenuAnchor } | null>(null)
  const [ccOpen, setCcOpen] = useState(false)
  const ccRef = useRef<HTMLDivElement>(null)
  const closeCc = useCallback(() => setCcOpen(false), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  useDismiss(ccRef, ccOpen, closeCc)

  const { appName, appMenu, menus } = getContent()

  const openMenu = (key: MenuKey, el: HTMLElement) => {
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
    { label: 'About This Server', icon: Info, onSelect: () => onOpenWindow('settings') },
    { label: 'Settings…', icon: Settings, onSelect: () => onOpenWindow('settings') },
    { label: 'App Center…', icon: ShoppingBag, onSelect: () => onOpenWindow('store') },
    'separator',
    { label: 'Quick Search', icon: Search, shortcut: QUICK_SEARCH_SHORTCUT, onSelect: onQuickSearch },
    'separator',
    { label: 'Restart Server…', icon: RotateCcw, confirm: 'Click Again to Restart', onSelect: () => onPower('restart') },
    { label: 'Shut Down Server…', icon: Power, danger: true, confirm: 'Click Again to Shut Down', onSelect: () => onPower('shutdown') },
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
        <button {...trigger('logo')} aria-label="TemanLabsOS menu">
          <LogoGlyph className="logo-mark" size={16} mono />
        </button>
        <button {...trigger('app', 'menubar-app')} aria-label={`${appName} menu`}>
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
          <button {...trigger('ip:lan', 'menubar-ip')} aria-label={`Local IP ${lan.ipv4}`} title={`Local network (${lan.interface})`}>
            <EthernetPort size={14} />
            <span className="menubar-ip-text">{lan.ipv4}</span>
          </button>
        )}
        {tailscale && (
          <button
            {...trigger('ip:tailscale', 'menubar-ip')}
            aria-label={`Tailscale IP ${tailscale.ipv4}`}
            title={tailscale.dnsName ? `Tailscale · ${tailscale.dnsName}` : 'Tailscale'}
          >
            <Waypoints size={14} />
            <span className="menubar-ip-text">{tailscale.ipv4}</span>
          </button>
        )}
        <span className="menubar-stat" title="CPU usage">
          <Cpu size={14} /> {cpu === undefined ? '–' : `${Math.round(cpu)}%`}
        </span>
        <span className="menubar-icon" title="Network connected">
          <Wifi size={15} />
        </span>
        <button className="menubar-icon" onClick={onQuickSearch} aria-label="Quick Search">
          <Search size={15} />
        </button>
        <div className="cc-anchor" ref={ccRef}>
          <button
            className={`menubar-icon ${ccOpen ? 'is-active' : ''}`}
            onClick={() => setCcOpen(o => !o)}
            aria-label="Quick Settings"
            aria-expanded={ccOpen}
          >
            <SlidersHorizontal size={15} />
          </button>
          {ccOpen && <ControlCenter />}
        </div>
        <span className="menubar-clock">
          <span className="menubar-date">{date}&nbsp;&nbsp;</span>
          {time}
        </span>
      </div>
      {menu && openItems && (
        <ContextMenu key={menu.key} items={openItems} anchor={menu.anchor} onClose={closeMenu} />
      )}
    </header>
  )
}

function ControlCenter() {
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
      aria-label="Quick Settings"
    >
      <CcToggle
        icon={dark ? Moon : Sun}
        label="Dark Mode"
        sub={dark ? 'On' : 'Off'}
        on={dark}
        onClick={() => update({ theme: dark ? 'light' : 'dark' })}
      />
      <CcToggle
        icon={Sparkles}
        label="Glass Effect"
        sub={supportsRefraction ? (refraction ? 'Refraction on' : 'Refraction off') : 'Chromium browsers only'}
        on={refraction}
        disabled={!supportsRefraction}
        onClick={() => update({ refraction: !settings.refraction })}
      />
      <CcToggle
        icon={Droplets}
        label="Reduce Transparency"
        sub={settings.reduceTransparency ? 'On' : 'Off'}
        on={settings.reduceTransparency}
        onClick={() => update({ reduceTransparency: !settings.reduceTransparency })}
      />
      <div>
        <span className="cc-label">Wallpaper</span>
        <WallpaperPicker />
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
