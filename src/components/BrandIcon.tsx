import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from 'simple-icons'

// Sites' own logos (from Simple Icons), on a tile the way each site shows its app icon.
const BRANDS = {
  instagram: { icon: siInstagram, glyph: '#fff' },
  x: { icon: siX, glyph: '#fff' },
  tiktok: { icon: siTiktok, glyph: '#fff' },
  youtube: { icon: siYoutube, glyph: `#${siYoutube.hex}` },
  facebook: { icon: siFacebook, glyph: `#${siFacebook.hex}` },
}

export type Brand = keyof typeof BRANDS

export function BrandIcon({ brand, size = 30 }: { brand: Brand; size?: number }) {
  const { icon, glyph } = BRANDS[brand]
  return (
    <span className={`brand-icon is-${brand}`} style={{ width: size, height: size }} role="img" aria-label={icon.title}>
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill={glyph} aria-hidden="true">
        <path d={icon.path} />
      </svg>
    </span>
  )
}
