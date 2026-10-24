import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { InstalledApp } from '../api/types'
import { prefersReducedMotion } from '../lib/motion'
import { LAUNCHER, TRASH, SYSTEM_APPS, VIEWER_APPS } from '../lib/systemApps'
import { DRAG_GROUP_TYPE, DRAG_TYPE } from '../lib/dockDrag'
import { AppIcon } from './AppIcon'
import type { MenuAnchor } from './ContextMenu'
import { displacementSlices } from '../lib/displacement'
import { DOCK_SCALE, supportsRefraction, useSettings } from '../lib/settings'
import type { SystemWindowId, WindowId } from './Window'
import { tr } from '../lib/i18n'

export type DockGroup = 'system' | 'apps'

interface Props {
  /** Installed apps in the Dock: the kept ones in order, then any others with a window open. */
  apps: InstalledApp[]
  /** Installed apps kept in the Dock, in order. */
  pinnedApps: string[]
  /** Built-in apps kept in the Dock, in order (others show only while open). */
  systemIds: string[]
  openIds: WindowId[]
  /** An app dragged in from the Launcher (its Launcher key), to keep at that place in its group. */
  onDropApp: (key: string, index: number) => void
  /** Icons dragged into a new order: the group's kept ids (a dragged open app is kept from then on). */
  onReorder: (group: DockGroup, ids: string[]) => void
  /** An icon dragged off the Dock. */
  onRemove: (group: DockGroup, id: string) => void
  onLauncher: () => void
  onOpenWindow: (id: WindowId) => void
  onOpenApp: (app: InstalledApp) => void
  onAppMenu: (app: InstalledApp, anchor: MenuAnchor) => void
  onSystemMenu: (id: SystemWindowId | 'launchpad', anchor: MenuAnchor) => void
  /** Counts shown on icons, by Dock id ("store", "settings", "app:<id>"…). */
  badges?: Record<string, number>
  /** The Trash at the end of the Dock: opens it in Files; its menu empties it. */
  onTrash: () => void
  onTrashMenu: (anchor: MenuAnchor) => void
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
// apart, and the Dock widens to fit them. How much is a setting (DOCK_SCALE).
/** Distance from the pointer (px) at which an icon is back to normal size. */
const RANGE = 140
const LIFT = 6
/** Per-frame easing of the pointer position and of the magnification itself. */
const FOLLOW = 0.35
const SETTLE = 0.2

const falloff = (d: number) => (d >= RANGE ? 0 : (1 + Math.cos((Math.PI * d) / RANGE)) / 2)

// The Dock's glass, as in Glass.tsx.
const RADIUS = 30
const BEZEL = 20
const DEPTH = 22
const BLUR = 6

/**
 * The Dock's glass is its own layer behind the icons, so magnification widens it by changing its
 * width rather than scaling it: a scaled glass bends its backdrop through a stretched map, and
 * its rim shimmers as the scale changes every frame. The refraction map comes in three slices
 * (see displacementSlices) placed for the current width, in the same frame as the resize.
 */
function DockSkin({ skinRef, dropping }: { skinRef: RefObject<HTMLDivElement | null>; dropping: boolean }) {
  const { settings } = useSettings()
  const filterId = `dock${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [height, setHeight] = useState(0)
  const filter = useRef<SVGFilterElement>(null)
  const middle = useRef<SVGFEImageElement>(null)
  const right = useRef<SVGFEImageElement>(null)
  const liquid = settings.refraction && supportsRefraction && !settings.reduceTransparency && height > 0
  const slices = useMemo(() => (liquid ? displacementSlices(height, RADIUS, BEZEL) : null), [liquid, height])

  // ResizeObserver runs after layout and before paint, so the map always matches the width.
  useLayoutEffect(() => {
    const el = skinRef.current
    if (!el) return
    const place = (w: number, h: number) => {
      setHeight(h)
      if (!slices) return
      const mid = Math.max(0, w - slices.cap * 2)
      filter.current?.setAttribute('width', String(w))
      middle.current?.setAttribute('width', String(mid))
      right.current?.setAttribute('x', String(slices.cap + mid))
    }
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0]
      place(Math.round(box ? box.inlineSize : entry.contentRect.width), Math.round(box ? box.blockSize : entry.contentRect.height))
    })
    observer.observe(el)
    place(el.offsetWidth, el.offsetHeight)
    return () => observer.disconnect()
  }, [skinRef, slices])

  const style = {
    '--radius': `${RADIUS}px`,
    '--glass-blur': `${Math.max(BLUR * 2, 16)}px`,
    ...(slices ? { backdropFilter: `url(#${filterId}) blur(${BLUR}px) saturate(170%) brightness(1.05)` } : null),
  } as CSSProperties
  return (
    <div ref={skinRef} className={`glass dock-skin ${dropping ? 'is-drop' : ''}`} style={style} aria-hidden>
      {slices && (
        <svg className="glass-filter" focusable="false">
          <filter
            ref={filter}
            id={filterId}
            x="0"
            y="0"
            width="0"
            height={height}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage href={slices.left} x="0" y="0" width={slices.cap} height={height} preserveAspectRatio="none" result="left" />
            <feImage
              ref={middle}
              href={slices.middle}
              x={slices.cap}
              y="0"
              width="0"
              height={height}
              preserveAspectRatio="none"
              result="middle"
            />
            <feImage
              ref={right}
              href={slices.right}
              x={slices.cap}
              y="0"
              width={slices.cap}
              height={height}
              preserveAspectRatio="none"
              result="right"
            />
            <feMerge result="map">
              <feMergeNode in="left" />
              <feMergeNode in="middle" />
              <feMergeNode in="right" />
            </feMerge>
            <feDisplacementMap in="SourceGraphic" in2="map" scale={DEPTH * 2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
    </div>
  )
}

interface Magnifier {
  /** Settles every icon back to its own size at once and ignores the pointer until resume. */
  pause: () => void
  resume: () => void
}

function useMagnification(
  ref: RefObject<HTMLDivElement | null>,
  skinRef: RefObject<HTMLDivElement | null>,
  control: RefObject<Magnifier | null>,
  maxScale: RefObject<number>,
) {
  useEffect(() => {
    const dock = ref.current
    const skin = skinRef.current
    if (!dock || window.matchMedia('(hover: none)').matches) return
    let paused = false
    type Item = { el: HTMLElement; center: number; width: number; grows: boolean }
    let items: Item[] = []
    let dockWidth = 0
    let dockLeft = 0
    // The pointer in page coordinates; the Dock's own position is measured every frame.
    let clientX: number | null = null
    let x = 0
    let amount = 0
    let frame = 0

    // Layout positions (offsetLeft ignores our transforms), so measuring mid-animation is fine.
    // It happens every frame: an app pinned or opened while the pointer is on the Dock moves
    // the others.
    const measure = () => {
      dockWidth = dock.offsetWidth
      dockLeft = dock.getBoundingClientRect().left
      items = [...dock.querySelectorAll<HTMLElement>(':scope > .dock-item, :scope > .dock-sep')]
        .filter(el => el.offsetWidth > 0)
        .map(el => ({ el, center: el.offsetLeft + el.offsetWidth / 2, width: el.offsetWidth, grows: el.classList.contains('dock-item') }))
    }

    const reset = () => {
      if (skin) skin.style.width = ''
      for (const el of dock.querySelectorAll<HTMLElement>(':scope > .dock-item, :scope > .dock-sep')) {
        el.style.transform = ''
        el.style.removeProperty('--sx')
        el.style.removeProperty('--sy')
      }
    }

    const tick = () => {
      frame = 0
      measure()
      const pointer = clientX === null ? null : clientX - dockLeft
      if (pointer !== null) x += (pointer - x) * FOLLOW
      amount += ((pointer === null ? 0 : 1) - amount) * SETTLE
      if (pointer === null && amount < 0.003) {
        amount = 0
        reset()
        return
      }
      const max = maxScale.current
      const scales = items.map(it => (it.grows ? 1 + (max - 1) * amount * falloff(Math.abs(it.center - x)) : 1))
      const extras = scales.map((s, i) => (s - 1) * items[i].width)
      const total = extras.reduce((a, b) => a + b, 0)
      // The Dock grows about its centre: the glass gets wider, the icons spread out from the middle.
      if (skin) skin.style.width = `${dockWidth + total}px`
      let before = 0
      items.forEach((it, i) => {
        const center = it.center + before + extras[i] / 2 - total / 2
        before += extras[i]
        const s = scales[i]
        const lift = max > 1 ? (LIFT * (s - 1)) / (max - 1) : 0
        it.el.style.transform = `translate(${center - it.center}px, ${-lift}px) scale(${s})`
        it.el.style.setProperty('--sx', String(s))
        it.el.style.setProperty('--sy', String(s))
      })
      frame = requestAnimationFrame(tick)
    }

    control.current = {
      pause: () => {
        paused = true
        clientX = null
        amount = 0
        cancelAnimationFrame(frame)
        frame = 0
        reset()
      },
      resume: () => {
        paused = false
      },
    }
    const onMove = (e: PointerEvent) => {
      if (paused || e.pointerType === 'touch' || prefersReducedMotion()) return
      if (clientX === null && amount === 0) {
        measure()
        x = e.clientX - dockLeft
      }
      clientX = e.clientX
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onLeave = () => {
      clientX = null
      if (!frame) frame = requestAnimationFrame(tick)
    }
    dock.addEventListener('pointermove', onMove)
    dock.addEventListener('pointerleave', onLeave)
    return () => {
      dock.removeEventListener('pointermove', onMove)
      dock.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(frame)
      reset()
      control.current = null
    }
  }, [ref, skinRef, control])
}

const ALL_SYSTEM = [...SYSTEM_APPS, ...VIEWER_APPS]

// How long icons take to slide in and shrink away (keep in step with app.css).
const ENTER_MS = 420
const LEAVE_MS = 320
// A press becomes a drag after this many pixels; this far above the Dock it becomes "remove".
const DRAG_START = 5
const REMOVE_RISE = 70
const SETTLE_MS = 180

interface Entry {
  /** The window id: a built-in app's id, or "app:<id>". */
  dockId: string
  /** The id the group's order is kept by. */
  id: string
  group: DockGroup
  label: string
  icon: string
  iconUrl?: string
  color: [string, string]
  open: boolean
  stopped?: boolean
  pinned: boolean
  badge?: number
  onClick: () => void
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void
}

type Shown = Entry & { phase?: 'new' | 'leaving' }

// Icons slide in when they join the Dock and shrink away when they leave it (from any path:
// pinning, closing an app's window, the menu), so their neighbours move instead of jumping.
function useArrivals(entries: Entry[], quiet: RefObject<Set<string>>) {
  const seen = useRef<Entry[] | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [leaving, setLeaving] = useState<{ entry: Entry; after: string | null }[]>([])
  const ids = entries.map(e => e.dockId).join(' ')
  useLayoutEffect(() => {
    const before = seen.current
    seen.current = entries
    if (!before) return
    const now = new Set(entries.map(e => e.dockId))
    const added = entries.filter(e => !before.some(b => b.dockId === e.dockId) && !quiet.current.delete(e.dockId)).map(e => e.dockId)
    const gone = before
      .map((e, i) => ({ entry: e, after: i > 0 ? before[i - 1].dockId : null }))
      .filter(g => !now.has(g.entry.dockId) && !quiet.current.delete(g.entry.dockId))
    const timers: number[] = []
    if (added.length) {
      setFresh(f => new Set([...f, ...added]))
      timers.push(window.setTimeout(() => setFresh(f => new Set([...f].filter(id => !added.includes(id)))), ENTER_MS))
    }
    if (gone.length) {
      setLeaving(l => [...l, ...gone])
      timers.push(window.setTimeout(() => setLeaving(l => l.filter(g => !gone.includes(g))), LEAVE_MS))
    }
  }, [ids])
  const shown: Shown[] = entries.map(e => (fresh.has(e.dockId) ? { ...e, phase: 'new' as const } : e))
  for (const g of leaving) {
    if (shown.some(e => e.dockId === g.entry.dockId)) continue
    const ghost = { ...g.entry, phase: 'leaving' as const }
    const after = g.after === null ? -1 : shown.findIndex(e => e.dockId === g.after)
    // Its left neighbour left too: it shrinks away at the end of its group instead.
    if (g.after !== null && after < 0) shown.push(ghost)
    else shown.splice(after + 1, 0, ghost)
  }
  return shown
}

export function Dock({ apps, pinnedApps, systemIds, openIds, onDropApp, onReorder, onRemove, onLauncher, onOpenWindow, onOpenApp, onAppMenu, onSystemMenu, badges = {}, onTrash, onTrashMenu }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const skin = useRef<HTMLDivElement>(null)
  const magnifier = useRef<Magnifier | null>(null)
  const { settings } = useSettings()
  const maxScale = useRef(DOCK_SCALE.medium)
  maxScale.current = DOCK_SCALE[settings.dockMagnification] ?? DOCK_SCALE.medium
  useMagnification(ref, skin, magnifier, maxScale)

  const pinnedSystem = systemIds.map(id => ALL_SYSTEM.find(a => a.id === id)).filter(a => !!a)
  const system = [...pinnedSystem, ...ALL_SYSTEM.filter(a => !systemIds.includes(a.id) && openIds.includes(a.id))]
  const entries: Entry[] = [
    ...system.map(app => ({
      dockId: app.id,
      id: app.id,
      group: 'system' as const,
      label: app.label,
      icon: app.icon,
      color: app.color,
      open: openIds.includes(app.id),
      pinned: systemIds.includes(app.id),
      badge: badges[app.id],
      onClick: () => onOpenWindow(app.id),
      onContextMenu: (e: MouseEvent<HTMLButtonElement>) => onSystemMenu(app.id, anchorAbove(e)),
    })),
    ...apps.map(app => ({
      dockId: `app:${app.id}`,
      id: app.id,
      group: 'apps' as const,
      label: app.name,
      icon: app.icon,
      iconUrl: app.iconUrl,
      color: app.color,
      open: openIds.includes(`app:${app.id}`),
      stopped: app.status !== 'running',
      pinned: pinnedApps.includes(app.id),
      badge: badges[`app:${app.id}`],
      onClick: () => onOpenApp(app),
      onContextMenu: (e: MouseEvent<HTMLButtonElement>) => onAppMenu(app, anchorAbove(e)),
    })),
  ]
  // Icons that arrive or leave by dragging already moved into place: no slide for them.
  const quiet = useRef(new Set<string>())
  const shown = useArrivals(entries, quiet)

  // ----- Dragging icons to reorder them, or off the Dock to remove them -----
  type Drag = {
    entry: Entry
    el: HTMLElement
    pointerId: number
    x: number
    y: number
    active: boolean
    /** The group's icons at rest: element, left edge, width. */
    slots: { dockId: string; el: HTMLElement; left: number; width: number }[]
    from: number
    to: number
    remove: boolean
  }
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState<{ dockId: string; remove: boolean } | null>(null)
  const swallowClick = useRef(false)
  // Inline positions are cleared once React has put the icons in their new order (no flicker).
  const settle = useRef<HTMLElement[] | null>(null)
  useLayoutEffect(() => {
    if (!settle.current) return
    for (const el of settle.current) {
      el.style.transition = 'none'
      el.style.transform = ''
      el.style.opacity = ''
    }
    settle.current = null
  })

  const groupSlots = (group: DockGroup) =>
    [...(ref.current?.querySelectorAll<HTMLElement>(`.dock-item[data-dock-group="${group}"]:not(.is-leaving)`) ?? [])].map(el => ({
      dockId: el.dataset.dockId!,
      el,
      left: el.offsetLeft,
      width: el.offsetWidth,
    }))
  const gap = () => parseFloat(getComputedStyle(ref.current!).columnGap) || 0

  const onItemPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, entry: Entry) => {
    if (e.button !== 0 || e.pointerType === 'touch') return
    drag.current = { entry, el: e.currentTarget, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, slots: [], from: 0, to: 0, remove: false }
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.active) {
        if (Math.hypot(dx, dy) < DRAG_START) return
        magnifier.current?.pause()
        d.active = true
        d.slots = groupSlots(d.entry.group)
        d.from = d.to = d.slots.findIndex(s => s.dockId === d.entry.dockId)
        d.el.setPointerCapture?.(d.pointerId)
        setDragging({ dockId: d.entry.dockId, remove: false })
      }
      const step = d.slots[d.from].width + gap()
      // Off the Dock (well above it): remove, if it's an icon that's kept there.
      const dockTop = ref.current!.getBoundingClientRect().top
      const remove = d.entry.pinned && e.clientY < dockTop - REMOVE_RISE
      // Where it would land: past the middle of a neighbour, it takes that neighbour's place.
      const center = d.slots[d.from].left + d.slots[d.from].width / 2 + dx
      let to = d.from
      if (!remove) {
        to = d.slots.filter((s, i) => i !== d.from && s.left + s.width / 2 < center).length
        to = Math.max(0, Math.min(d.slots.length - 1, to))
      }
      d.el.style.transition = 'none'
      d.el.style.transform = `translate(${dx}px, ${dy}px) scale(${remove ? 0.85 : 1.08})`
      d.el.style.opacity = remove ? '0.55' : ''
      if (to !== d.to || remove !== d.remove) {
        d.to = to
        d.remove = remove
        setDragging({ dockId: d.entry.dockId, remove })
        d.slots.forEach((s, i) => {
          if (i === d.from) return
          const shift = d.from < to && i > d.from && i <= to ? -step : to < d.from && i >= to && i < d.from ? step : 0
          s.el.style.transition = `transform ${SETTLE_MS + 40}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
          s.el.style.transform = shift ? `translateX(${shift}px)` : ''
        })
      }
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      drag.current = null
      if (!d.active) return
      swallowClick.current = true
      setTimeout(() => (swallowClick.current = false), 0)
      const els = d.slots.map(s => s.el)
      const finish = () => {
        setDragging(null)
        magnifier.current?.resume()
      }
      if (d.remove) {
        // A puff: the icon vanishes where it was dropped.
        d.el.style.transition = `transform ${SETTLE_MS}ms ease-in, opacity ${SETTLE_MS}ms ease-in`
        d.el.style.transform += ' scale(0.3)'
        d.el.style.opacity = '0'
        setTimeout(() => {
          quiet.current.add(d.entry.dockId)
          settle.current = els
          onRemove(d.entry.group, d.entry.id)
          finish()
        }, SETTLE_MS)
        return
      }
      // Glide into the slot, then take the new order.
      const target = d.slots[d.to].left - d.slots[d.from].left + (d.to > d.from ? d.slots[d.to].width - d.slots[d.from].width : 0)
      d.el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 120ms`
      d.el.style.transform = `translate(${target}px, 0)`
      d.el.style.opacity = ''
      setTimeout(() => {
        const order = d.slots.map(s => s.dockId)
        const [moved] = order.splice(d.from, 1)
        order.splice(d.to, 0, moved)
        const keep = new Set(shown.filter(x => x.group === d.entry.group && x.pinned).map(x => x.dockId).concat(d.entry.dockId))
        const ids = order.filter(id => keep.has(id)).map(id => (d.entry.group === 'apps' ? id.slice(4) : id))
        settle.current = els
        if (d.to !== d.from || !d.entry.pinned) onReorder(d.entry.group, ids)
        finish()
      }, SETTLE_MS)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  })

  // ----- Apps dragged in from the Launcher: a gap opens where they'll land -----
  const [gapAt, setGapAt] = useState<{ group: DockGroup; index: number } | null>(null)
  const launcherGroup = (e: DragEvent): DockGroup | null =>
    e.dataTransfer.types.includes(DRAG_GROUP_TYPE('apps')) ? 'apps' : e.dataTransfer.types.includes(DRAG_GROUP_TYPE('system')) ? 'system' : null
  const slotAt = (group: DockGroup, clientX: number) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(`.dock-item[data-dock-group="${group}"]:not(.is-leaving)`) ?? [])]
    return items.filter(el => {
      const r = el.getBoundingClientRect()
      return r.left + r.width / 2 < clientX
    }).length
  }

  const renderGroup = (group: DockGroup) => {
    const items = shown.filter(e => e.group === group)
    const out = items.map(entry => (
      <DockItem
        key={entry.dockId}
        entry={entry}
        dragging={dragging?.dockId === entry.dockId}
        removing={dragging?.dockId === entry.dockId && dragging.remove}
        onPointerDown={e => onItemPointerDown(e, entry)}
        onClick={() => !swallowClick.current && entry.onClick()}
      />
    ))
    if (gapAt?.group === group) {
      // The gap's index counts icons only.
      out.splice(Math.min(gapAt.index, out.length), 0, <span key="gap" className="dock-gap" aria-hidden />)
    }
    return out
  }
  const hasApps = shown.some(e => e.group === 'apps') || gapAt?.group === 'apps'

  return (
    <nav className="dock-wrap" aria-label={tr('Dock')}>
      <div className="dock-shell">
        <DockSkin skinRef={skin} dropping={!!gapAt} />
        <div
          ref={ref}
          className={`dock ${dragging ? 'is-reordering' : ''}`}
          onDragOver={e => {
            const group = launcherGroup(e)
            if (!group && !e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            const g = group ?? 'apps'
            const index = slotAt(g, e.clientX)
            if (gapAt?.group !== g || gapAt.index !== index) setGapAt({ group: g, index })
          }}
          onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node | null) && setGapAt(null)}
          onDrop={e => {
            const key = e.dataTransfer.getData(DRAG_TYPE)
            const at = gapAt
            setGapAt(null)
            if (!key) return
            e.preventDefault()
            // It lands in the gap that's already open: no slide-in on top of that.
            quiet.current.add(key)
            onDropApp(key, at?.index ?? Number.MAX_SAFE_INTEGER)
          }}
        >
          <button
            data-dock-id="launchpad"
            className="dock-item"
            aria-label={LAUNCHER.label}
            onClick={onLauncher}
            onContextMenu={e => onSystemMenu('launchpad', anchorAbove(e))}
          >
            <span className="dock-tooltip">{LAUNCHER.label}</span>
            <AppIcon icon={LAUNCHER.icon} color={LAUNCHER.color} size={52} />
          </button>
          {renderGroup('system')}
          {hasApps && <span className="dock-sep dock-app" />}
          {renderGroup('apps')}
          <span className="dock-sep" />
          <button data-dock-id="trash" className="dock-item" aria-label={TRASH.label} onClick={onTrash} onContextMenu={e => onTrashMenu(anchorAbove(e))}>
            <span className="dock-tooltip">{TRASH.label}</span>
            <AppIcon icon={TRASH.icon} color={TRASH.color} size={52} />
          </button>
        </div>
      </div>
    </nav>
  )
}

interface ItemProps {
  entry: Shown
  dragging: boolean
  removing: boolean
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onClick: () => void
}

const BOUNCE_MS = 1100

function DockItem({ entry, dragging, removing, onPointerDown, onClick }: ItemProps) {
  // Bounces while the app launches; apps that are already open don't.
  const [launching, setLaunching] = useState(false)
  useEffect(() => {
    if (!launching) return
    const timer = setTimeout(() => setLaunching(false), BOUNCE_MS)
    return () => clearTimeout(timer)
  }, [launching])

  const phase = entry.phase === 'new' ? 'is-new' : entry.phase === 'leaving' ? 'is-leaving' : ''
  return (
    <button
      data-dock-id={entry.dockId}
      data-dock-group={entry.group}
      className={`dock-item ${entry.group === 'apps' ? 'dock-app' : ''} ${entry.stopped ? 'is-stopped' : ''} ${launching ? 'is-launching' : ''} ${phase} ${dragging ? 'is-dragging' : ''}`}
      aria-label={entry.label}
      onPointerDown={onPointerDown}
      onClick={() => {
        if (!entry.open) setLaunching(true)
        onClick()
      }}
      onContextMenu={entry.onContextMenu}
    >
      <span className="dock-tooltip">{entry.label}</span>
      <AppIcon icon={entry.icon} iconUrl={entry.iconUrl} color={entry.color} size={52} />
      {!!entry.badge && <span className="dock-badge">{entry.badge > 99 ? '99+' : entry.badge}</span>}
      {entry.open && <span className="dock-dot" />}
      {removing && <span className="dock-remove">{tr('Remove')}</span>}
    </button>
  )
}
