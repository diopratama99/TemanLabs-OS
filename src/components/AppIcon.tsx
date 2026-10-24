import { useState } from 'react'
import { Boxes } from 'lucide-react'
import { appIcons } from '../lib/icons'

interface Props {
  icon: string
  /** Image icon (e.g. from CasaOS); the glyph shows until it loads, and stays if it fails. */
  iconUrl?: string
  color: [string, string]
  size?: number
}

// Shared across mounts so the Dock doesn't flash glyphs, or retry broken URLs, on every render.
const loadedIcons = new Set<string>()
const brokenIcons = new Set<string>()

export function AppIcon({ icon, iconUrl, color, size = 56 }: Props) {
  const [, rerender] = useState(0)
  const Icon = appIcons[icon] ?? Boxes
  const image = iconUrl && !brokenIcons.has(iconUrl) ? iconUrl : null
  const loaded = !!image && loadedIcons.has(image)
  const radius = size * 0.28

  return (
    <span
      className={`app-icon ${loaded ? 'app-icon-image' : ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: loaded ? undefined : `linear-gradient(150deg, ${color[0]}, ${color[1]})`,
      }}
    >
      {!loaded && <Icon size={size * 0.5} strokeWidth={1.75} color="#fff" />}
      {image && (
        <img
          src={image}
          alt=""
          width={size * 0.72}
          height={size * 0.72}
          draggable={false}
          loading="lazy"
          style={loaded ? undefined : { position: 'absolute', opacity: 0 }}
          onLoad={() => {
            loadedIcons.add(image)
            rerender(n => n + 1)
          }}
          onError={() => {
            brokenIcons.add(image)
            rerender(n => n + 1)
          }}
        />
      )}
    </span>
  )
}
