import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
  type RefObject,
} from 'react'
import { displacementMap } from '../lib/displacement'
import { supportsRefraction, useSettings } from '../lib/settings'

interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  /** Corner radius in px. */
  radius?: number
  /** Width of the refracting rim in px. */
  bezel?: number
  /** Maximum backdrop shift at the very edge in px. */
  depth?: number
  /** Frost applied on top of the refraction, in px. */
  blur?: number
  ref?: Ref<HTMLDivElement>
}

function useSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0]
      const w = Math.round(box ? box.inlineSize : entry.contentRect.width)
      const h = Math.round(box ? box.blockSize : entry.contentRect.height)
      setSize(s => (s.w === w && s.h === h ? s : { w, h }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * frosted glass surface. In Chromium the backdrop is bent through a per-size SVG displacement
 * filter (lens rim) before being frosted; elsewhere it falls back to the plain blur in glass.css.
 */
export function Glass({
  radius = 24,
  bezel = 18,
  depth = 24,
  blur = 8,
  className = '',
  style,
  children,
  ref,
  ...rest
}: GlassProps) {
  const inner = useRef<HTMLDivElement | null>(null)
  const { w, h } = useSize(inner)
  const { settings } = useSettings()
  const filterId = `lg${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  const liquid = settings.refraction && supportsRefraction && !settings.reduceTransparency && w > 0 && h > 0
  const map = useMemo(
    () => (liquid ? displacementMap(w, h, radius, bezel) : null),
    [liquid, w, h, radius, bezel],
  )

  const setRef = (node: HTMLDivElement | null) => {
    inner.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as RefObject<HTMLDivElement | null>).current = node
  }

  const backdrop = `url(#${filterId}) blur(${blur}px) saturate(170%) brightness(1.05)`
  const merged = {
    '--radius': `${radius}px`,
    // Without refraction the frost has to do all the work, so it is stronger.
    '--glass-blur': `${Math.max(blur * 2, 16)}px`,
    ...(map ? { backdropFilter: backdrop } : null),
    ...style,
  } as CSSProperties

  return (
    <div ref={setRef} className={`glass ${className}`} style={merged} {...rest}>
      {map && (
        <svg className="glass-filter" aria-hidden focusable="false">
          <filter
            id={filterId}
            x="0"
            y="0"
            width={w}
            height={h}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage href={map} x="0" y="0" width={w} height={h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={depth * 2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {children}
    </div>
  )
}
