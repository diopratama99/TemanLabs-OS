// The TemanLabs "T": two leaf-shaped bars and a stem, traced from the brand artwork.
const VIEWBOX = '160 190 940 860'
const TOP_BAR = 'M350 224H586Q604 224 604 242V305C604 371 551 424 485 424H192Q174 424 177 406C195 300 265 224 350 224Z'
const ARM = 'M749 411H1061Q1079 411 1079 429V487C1079 553 1025 607 955 607H749Z'
const STEM = 'M633 411H750V1011Q750 1029 732 1029H620C556 1029 504 977 504 912V540C504 469 562 411 633 411Z'

export const BRAND_LIGHT = '#0479ff'
export const BRAND_DARK = '#034bb8'

interface Props {
  size?: number
  /** One colour (currentColor), for the menu bar. */
  mono?: boolean
  className?: string
}

export function LogoGlyph({ size = 16, mono = false, className }: Props) {
  return (
    <svg className={className} width={size} height={size} viewBox={VIEWBOX} aria-hidden focusable="false">
      <path d={TOP_BAR} fill={mono ? 'currentColor' : BRAND_LIGHT} />
      <path d={ARM} fill={mono ? 'currentColor' : BRAND_LIGHT} />
      <path d={STEM} fill={mono ? 'currentColor' : BRAND_DARK} opacity={mono ? 0.78 : 1} />
    </svg>
  )
}

/** The logo on its white app-icon tile (login screen, About). */
export function LogoTile({ size = 72 }: { size?: number }) {
  return (
    <span className="logo-tile" style={{ width: size, height: size, borderRadius: size * 0.27 }}>
      <LogoGlyph size={size * 0.68} />
    </span>
  )
}

