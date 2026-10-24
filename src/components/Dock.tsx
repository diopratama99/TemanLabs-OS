import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import type { InstalledApp } from '../api/types'
import { prefersReducedMotion } from '../lib/motion'
import { LAUNCHER, SYSTEM_APPS, VIEWER_APPS } from '../lib/systemApps'
import { AppIcon } from './AppIcon'
import type { MenuAnchor } from './ContextMenu'
import { Glass } from './Glass'
import type { SystemWindowId, WindowId } from './Window'

interface Props {
  apps: InstalledApp[]
  openIds: WindowId[]
  onLauncher: () => void
  onOpenWindow: (id: WindowId) => void
  onOpenApp: (app: InstalledApp) => void
  onAppMenu: (app: InstalledApp, anchor: MenuAnchor) => void
  onSystemMenu: (id: SystemWindowId | 'launchpad', anchor: MenuAnchor) => void
}

// A hovered icon is magnified and rises this far above the Dock; menus must clear it, since
// a glass menu overlapping the scaled icon makes Chrome render the icon washed out.
const MAGNIFY_CLEARANCE = 28

// Dock menus open centered over the icon, above the Dock.
const anchorAbove = (e: MouseEvent<HTMLElement>): MenuAnchor => {
  e.preventDefault()
  const icon = e.currentTarget.getBoundingClientRect()
  const dockTop = e.currentTarget.closest('.dock')?.getBoundingClientRect().top ?? icon.top
  return { x: icon.left + icon.width / 2, y: dockTop - MAGNIFY_CLEARANCE, placement: 'above', align: 'center' }
}

// Magnification: icons near the pointer grow and push their neighbours
// apart, and the Dock widens to fit them.
const MAX_SCALE = 1.55
/** Distance from the pointer (px) at which an icon is back to normal size. */
const RANGE = 140
const LIFT = 6
/** Per-frame easing of the pointer position and of the magnification itself. */
const FOLLOW = 0.35
const SETTLE = 0.2

const falloff = (d: number) => (d >= RANGE ? 0 : (1 + Math.cos((Math.PI * d) / RANGE)) / 2)

function useMagnification(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const dock = ref.current
    if (!dock || window.matchMedia('(hover: none)').matches) return
    type Item = { el: HTMLElement; center: number; width: number; grows: boolean }
    let items: Item[] = []
    let dockWidth = 0
    let dockLeft = 0
    let pointer: number | null = null
    let x = 0
    let amount = 0
    let frame = 0

    // Layout positions (offsetLeft ignores our transforms), so measuring mid-animation is fine.
    const measure = () => {
      dockWidth = dock.offsetWidth
      const box = dock.getBoundingClientRect()
      dockLeft = box.left + box.width / 2 - dockWidth / 2
      items = [...dock.querySelectorAll<HTMLElement>(':scope > .dock-item, :scope > .dock-sep')]
        .filter(el => el.offsetWidth > 0)
        .map(el => ({ el, center: el.offsetLeft + el.offsetWidth / 2, width: el.offsetWidth, grows: el.classList.contains('dock-item') }))
    }

    const reset = () => {
      dock.style.transform = ''
      for (const { el } of items) {
        el.style.transform = ''
        el.style.removeProperty('--sx')
        el.style.removeProperty('--sy')
      }
    }

    const tick = () => {
      frame = 0
      if (pointer !== null) x += (pointer - x) * FOLLOW
      amount += ((pointer === null ? 0 : 1) - amount) * SETTLE
      if (pointer === null && amount < 0.003) {
        amount = 0
        reset()
        return
      }
      const scales = items.map(it => (it.grows ? 1 + (MAX_SCALE - 1) * amount * falloff(Math.abs(it.center - x)) : 1))
      const extras = scales.map((s, i) => (s - 1) * items[i].width)
      const total = extras.reduce((a, b) => a + b, 0)
      // The Dock grows about its centre; children are laid out in its unscaled space.
      const k = (dockWidth + total) / dockWidth
      dock.style.transform = `scaleX(${k})`
      let before = 0
      items.forEach((it, i) => {
        const center = it.center + before + extras[i] / 2 - total / 2
        before += extras[i]
        const local = dockWidth / 2 + (center - dockWidth / 2) / k
        const s = scales[i]
        const lift = (LIFT * (s - 1)) / (MAX_SCALE - 1)
        it.el.style.transform = `translate(${local - it.center}px, ${-lift}px) scale(${s / k}, ${s})`
        it.el.style.setProperty('--sx', String(s / k))
        it.el.style.setProperty('--sy', String(s))
      })
      frame = requestAnimationFrame(tick)
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || prefersReducedMotion()) return
      if (pointer === null) {
        measure()
        if (amount === 0) x = e.clientX - dockLeft
      }
      pointer = e.clientX - dockLeft
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onLeave = () => {
      pointer = null
      if (!frame) frame = requestAnimationFrame(tick)
    }
    dock.addEventListener('pointermove', onMove)
    dock.addEventListener('pointerleave', onLeave)
    return () => {
      dock.removeEventListener('pointermove', onMove)
      dock.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(frame)
      reset()
    }
  }, [ref])
}

export function Dock({ apps, openIds, onLauncher, onOpenWindow, onOpenApp, onAppMenu, onSystemMenu }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useMagnification(ref)
  return (
    <nav className="dock-wrap" aria-label="Dock">
      <Glass ref={ref} radius={30} bezel={20} depth={22} blur={6} className="dock">
        <DockItem
          dockId="launchpad"
          label={LAUNCHER.label}
          icon={LAUNCHER.icon}
          color={LAUNCHER.color}
          onClick={onLauncher}
          onContextMenu={e => onSystemMenu('launchpad', anchorAbove(e))}
        />
        {[...SYSTEM_APPS.filter(app => app.dock !== false || openIds.includes(app.id)), ...VIEWER_APPS.filter(app => openIds.includes(app.id))].map(app => (
          <DockItem
            key={app.id}
            dockId={app.id}
            label={app.label}
            icon={app.icon}
            color={app.color}
            open={openIds.includes(app.id)}
            onClick={() => onOpenWindow(app.id)}
            onContextMenu={e => onSystemMenu(app.id, anchorAbove(e))}
          />
        ))}
        {apps.length > 0 && <span className="dock-sep dock-app" />}
        {apps.map(app => (
          <DockItem
            key={app.id}
            dockId={`app:${app.id}`}
            className="dock-app"
            label={app.name}
            icon={app.icon}
            iconUrl={app.iconUrl}
            color={app.color}
            open={openIds.includes(`app:${app.id}`)}
            stopped={app.status !== 'running'}
            onClick={() => onOpenApp(app)}
            onContextMenu={e => onAppMenu(app, anchorAbove(e))}
          />
        ))}
      </Glass>
    </nav>
  )
}

interface ItemProps {
  /** The window this icon opens; windows zoom out of and minimize into it. */
  dockId: string
  label: string
  icon: string
  iconUrl?: string
  color: [string, string]
  open?: boolean
  stopped?: boolean
  className?: string
  onClick: () => void
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void
}

const BOUNCE_MS = 1100

function DockItem({ dockId, label, icon, iconUrl, color, open, stopped, className = '', onClick, onContextMenu }: ItemProps) {
  // Bounces while the app launches; apps that are already open don't.
  const [launching, setLaunching] = useState(false)
  useEffect(() => {
    if (!launching) return
    const timer = setTimeout(() => setLaunching(false), BOUNCE_MS)
    return () => clearTimeout(timer)
  }, [launching])

  return (
    <button
      data-dock-id={dockId}
      className={`dock-item ${stopped ? 'is-stopped' : ''} ${launching ? 'is-launching' : ''} ${className}`}
      aria-label={label}
      onClick={() => {
        if (!open && dockId !== 'launchpad') setLaunching(true)
        onClick()
      }}
      onContextMenu={onContextMenu}
    >
      <span className="dock-tooltip">{label}</span>
      <AppIcon icon={icon} iconUrl={iconUrl} color={color} size={52} />
      {open && <span className="dock-dot" />}
    </button>
  )
}
