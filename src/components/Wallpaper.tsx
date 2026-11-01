import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { ImagePlus, LoaderCircle, Trash2, X } from 'lucide-react'
import { api } from '../api'
import type { WallpaperImage } from '../api/types'
import { useContextMenu } from '../lib/contextMenu'
import { prepareWallpaper } from '../lib/image'
import { useSettings } from '../lib/settings'
import { tr } from '../lib/i18n'

// The TemanLabsOS mark (the "T" of the logo), drawn around 627, 627.
const MARK = [
  'M350 224H586Q604 224 604 242V305C604 371 551 424 485 424H192Q174 424 177 406C195 300 265 224 350 224Z',
  'M749 411H1061Q1079 411 1079 429V487C1079 553 1025 607 955 607H749Z',
  'M633 411H750V1011Q750 1029 732 1029H620C556 1029 504 977 504 912V540C504 469 562 411 633 411Z',
]
const markPreview = `center / cover no-repeat url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100'><defs><radialGradient id='g' cx='.5' cy='.46' r='.8'><stop offset='0' stop-color='#1d5be0'/><stop offset='.5' stop-color='#0a2470'/><stop offset='1' stop-color='#030a24'/></radialGradient></defs><rect width='160' height='100' fill='url(#g)'/><g transform='translate(80 47) scale(.045) translate(-627 -627)'><path d='${MARK[0]}' fill='#8ec2ff'/><path d='${MARK[1]}' fill='#5aa2ff'/><path d='${MARK[2]}' fill='#2d74ff'/></g></svg>`,
)}")`

// Colors for the ribbon wallpapers live in base.css under .wallpaper[data-wp]; these are swatch
// previews. TemanLabs (the logo, the default) is drawn on its own (LogoArt).
export const wallpapers = [
  { name: 'Twilight', preview: 'linear-gradient(160deg, #0d1b4c, #2c6bff 45%, #ff4f9a 75%, #ff9a4d)' },
  { name: 'Aurora', preview: 'linear-gradient(160deg, #04192b, #00c9a7 45%, #6e4bff)' },
  { name: 'Sunset', preview: 'linear-gradient(160deg, #2a0d36, #ff2e7e 50%, #ffb23a)' },
  { name: 'TemanLabs', preview: markPreview },
]
/** The logo wallpaper's number: what a new desktop starts with. */
export const LOGO_WALLPAPER = 3

const RIBBONS = [
  'M0 470 C 260 330, 560 600, 860 470 S 1360 250, 1600 380',
  'M0 610 C 300 500, 640 790, 940 640 S 1400 460, 1600 570',
  'M0 770 C 360 650, 720 910, 1040 780 S 1440 650, 1600 720',
]
const TOP_RIBBON = 'M0 210 C 300 90, 640 330, 980 200 S 1440 40, 1600 150'

function Gradient({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0.35">
      <stop offset="0" style={{ stopColor: `var(${from})` }} />
      <stop offset="1" style={{ stopColor: `var(${to})` }} />
    </linearGradient>
  )
}

/**
 * Layered ribbons with crisp highlight lines: glass needs detail behind it, otherwise there is
 * nothing for the blur and the lens rim to visibly bend.
 */
export function Wallpaper() {
  const { settings } = useSettings()
  const photo = settings.customWallpaper
  const preview = photo && settings.customWallpaperPreview?.url === photo ? settings.customWallpaperPreview.data : null
  if (settings.wallpaper === LOGO_WALLPAPER)
    return (
      <div className="wallpaper" data-wp={settings.wallpaper} aria-hidden>
        {photo && <Photo key={photo} url={photo} />}
        {preview && <div className="wallpaper-preview" style={{ backgroundImage: `url("${preview}")` }} />}
        {!preview && <LogoArt light={settings.theme === 'light'} />}
      </div>
    )
  return (
    <div className="wallpaper" data-wp={settings.wallpaper} aria-hidden>
      {photo && <Photo key={photo} url={photo} />}
      {/* While the photo loads, a blurred copy of it stands in, so the built-in art never flashes. */}
      {preview && <div className="wallpaper-preview" style={{ backgroundImage: `url("${preview}")` }} />}
      <svg className="wallpaper-art" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" style={preview ? { display: 'none' } : undefined}>
        <defs>
          <linearGradient id="wp-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--wp-bg1)' }} />
            <stop offset="1" style={{ stopColor: 'var(--wp-bg2)' }} />
          </linearGradient>
          <Gradient id="wp-r1" from="--wp-1a" to="--wp-1b" />
          <Gradient id="wp-r2" from="--wp-2a" to="--wp-2b" />
          <Gradient id="wp-r3" from="--wp-3a" to="--wp-3b" />
          <Gradient id="wp-r4" from="--wp-4a" to="--wp-4b" />
          <radialGradient id="wp-glow">
            <stop offset="0" style={{ stopColor: 'var(--wp-glow)', stopOpacity: 0.85 }} />
            <stop offset="1" style={{ stopColor: 'var(--wp-glow)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        <rect width="1600" height="1000" fill="url(#wp-bg)" />
        <circle className="wp-glow" cx="1180" cy="300" r="340" fill="url(#wp-glow)" />
        <circle className="wp-glow wp-glow-2" cx="240" cy="160" r="240" fill="url(#wp-glow)" opacity="0.45" />
        <path d={`${TOP_RIBBON} L1600 0 L0 0 Z`} fill="url(#wp-r4)" opacity="0.55" />
        {RIBBONS.map((d, i) => (
          <path key={d} d={`${d} L1600 1000 L0 1000 Z`} fill={`url(#wp-r${i + 1})`} />
        ))}

        <g className="wp-lines">
          <path d={TOP_RIBBON} />
          {RIBBONS.map(d => (
            <g key={d}>
              <path d={d} />
              <path className="faint" d={d} transform="translate(0 22)" />
              <path className="faint" d={d} transform="translate(0 44)" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}

// The logo wallpaper's two looks: deep blue at night (dark), daylight blue (light).
const LOGO_LOOKS = {
  dark: {
    bg: ['#1d5be0', '#0a2470', '#030a24'],
    halo: ['#4a95ff', 0.95],
    sweep: ['#2f7bff', '#8a6cff', '#21d4fd', 0.85],
    rings: ['rgba(150, 196, 255, 0.16)', 'rgba(150, 196, 255, 0.07)'],
    mark: [['#e2f0ff', '#5ea0ff'], ['#a9d2ff', '#2a78ff'], ['#4f98ff', '#0d47e0']],
    glow: '#3d8bff',
    edge: 'rgba(255, 255, 255, 0.45)',
  },
  light: {
    bg: ['#f6f9ff', '#d4e4ff', '#a3c1f0'],
    halo: ['#79b0ff', 0.6],
    sweep: ['#8ab8ff', '#b49dff', '#74e2ff', 0.75],
    rings: ['rgba(40, 100, 210, 0.15)', 'rgba(40, 100, 210, 0.06)'],
    mark: [['#7cb7ff', '#2a74ff'], ['#4f97ff', '#0f57ea'], ['#2c74ff', '#0737b8']],
    glow: '#6aa6ff',
    edge: 'rgba(255, 255, 255, 0.65)',
  },
} as const

/**
 * The default wallpaper: the logo's mark glowing on blue, deep at night and bright by day (it
 * follows the theme), with rings of light and a sweep of colour around it for the glass to bend.
 */
function LogoArt({ light }: { light: boolean }) {
  const look = LOGO_LOOKS[light ? 'light' : 'dark']
  const [a, b, c] = look.mark
  return (
    <svg className="wallpaper-art wp-logo" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="tl-bg" cx="0.5" cy="0.46" r="0.8">
          <stop offset="0" stopColor={look.bg[0]} />
          <stop offset="0.42" stopColor={look.bg[1]} />
          <stop offset="1" stopColor={look.bg[2]} />
        </radialGradient>
        <linearGradient id="tl-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a[0]} />
          <stop offset="1" stopColor={a[1]} />
        </linearGradient>
        <linearGradient id="tl-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={b[0]} />
          <stop offset="1" stopColor={b[1]} />
        </linearGradient>
        <linearGradient id="tl-c" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={c[0]} />
          <stop offset="1" stopColor={c[1]} />
        </linearGradient>
        <linearGradient id="tl-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={look.sweep[0]} stopOpacity="0" />
          <stop offset="0.5" stopColor={look.sweep[1]} stopOpacity={look.sweep[3]} />
          <stop offset="1" stopColor={look.sweep[2]} stopOpacity="0" />
        </linearGradient>
        <radialGradient id="tl-halo">
          <stop offset="0" stopColor={look.halo[0]} stopOpacity={look.halo[1]} />
          <stop offset="1" stopColor={look.halo[0]} stopOpacity="0" />
        </radialGradient>
        <filter id="tl-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="60" />
        </filter>
        <filter id="tl-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      <rect width="1600" height="1000" fill="url(#tl-bg)" />
      <circle className="wp-glow" cx="800" cy="460" r="520" fill="url(#tl-halo)" />
      {/* Sweeps of colour across, blurred: the bloom behind the mark. */}
      <path d="M-100 820 C 300 560, 760 760, 1700 330" stroke="url(#tl-sweep)" strokeWidth="150" fill="none" filter="url(#tl-soft)" />
      <path d="M-100 240 C 420 420, 980 120, 1700 420" stroke="url(#tl-sweep)" strokeWidth="90" fill="none" opacity="0.6" filter="url(#tl-soft)" />
      {/* Rings of light: detail for the windows' glass to bend. */}
      <g fill="none" stroke={look.rings[0]} strokeWidth="1.5">
        {[250, 330, 420, 520, 640, 780].map(r => (
          <circle key={r} cx="800" cy="460" r={r} />
        ))}
      </g>
      <g fill="none" stroke={look.rings[1]} strokeWidth="1">
        {[290, 375, 470, 580, 710].map(r => (
          <circle key={r} cx="800" cy="460" r={r} />
        ))}
      </g>
      <g transform="translate(800 460) scale(0.44) translate(-627 -627)">
        <g filter="url(#tl-blur)" opacity={light ? 0.7 : 1}>
          {MARK.map(d => (
            <path key={d} d={d} fill={look.glow} stroke={look.glow} strokeWidth="60" />
          ))}
        </g>
        <path d={MARK[0]} fill="url(#tl-a)" />
        <path d={MARK[1]} fill="url(#tl-b)" />
        <path d={MARK[2]} fill="url(#tl-c)" />
        <g fill="none" stroke={look.edge} strokeWidth="5">
          {MARK.map(d => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  )
}

/** The user's photo, faded in over the built-in art once it has loaded (the art stays if it fails). */
function Photo({ url }: { url: string }) {
  const { settings, update } = useSettings()
  const [loaded, setLoaded] = useState(false)
  // A photo already in the browser cache appears at once instead of fading in.
  const [instant, setInstant] = useState(false)
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth) {
      setInstant(true)
      setLoaded(true)
    }
  }, [])
  const hasPreview = settings.customWallpaperPreview?.url === url
  return (
    <img
      ref={ref}
      className={`wallpaper-photo ${loaded ? 'is-loaded' : ''} ${instant ? 'is-instant' : ''}`}
      src={url}
      alt=""
      decoding="async"
      onLoad={e => {
        setLoaded(true)
        if (!hasPreview) {
          const data = tinyPreview(e.currentTarget)
          if (data) update({ customWallpaperPreview: { url, data } })
        }
      }}
    />
  )
}

/** A 48 px wide JPEG of the photo as a data URL: about 1–2 KB, small enough for the saved settings. */
function tinyPreview(img: HTMLImageElement) {
  const width = 48
  const height = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * width))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, width, height)
  try {
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}

/**
 * Built-in wallpapers and the user's photos, in a grid; drop an image anywhere on it to add one.
 * Compact (for Quick Settings) is a single small grid with a link to the full picker.
 */
export function WallpaperPicker({ compact = false, onMore }: { compact?: boolean; onMore?: () => void }) {
  const { settings, update } = useSettings()
  const { show } = useContextMenu()
  const [photos, setPhotos] = useState<WallpaperImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const columns = useColumns(grid)

  useEffect(() => {
    api.listWallpapers().then(setPhotos, () => {})
  }, [])

  const add = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const entry = await api.uploadWallpaper(await prepareWallpaper(file))
      setPhotos(p => [entry, ...p])
      update({ customWallpaper: entry.url })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const remove = async (photo: WallpaperImage) => {
    await api.deleteWallpaper(photo.name)
    setPhotos(p => p.filter(x => x.name !== photo.name))
    update(s => (s.customWallpaper === photo.url ? { customWallpaper: null } : {}))
  }

  const dropTarget = {
    onDragOver: (e: DragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void add([...e.dataTransfer.files].find(f => f.type.startsWith('image/')))
    },
  }

  const custom = settings.customWallpaper
  const builtIn = wallpapers[settings.wallpaper] ?? wallpapers[0]
  const current = custom ? photos.find(p => p.url === custom) : undefined
  const currentPreview = custom ? (current?.thumb ?? custom) : null

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={e => {
        void add(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )
  const builtInTile = (wp: (typeof wallpapers)[number], i: number) => (
    <div key={wp.name} className="wp-item">
      <button
        className={`wp-tile ${!custom && i === settings.wallpaper ? 'is-active' : ''}`}
        style={{ background: wp.preview }}
        onClick={() => update({ wallpaper: i, customWallpaper: null })}
        aria-label={tr('{0} wallpaper', wp.name)}
        aria-pressed={!custom && i === settings.wallpaper}
        title={wp.name}
      />
      {!compact && <small>{wp.name}</small>}
    </div>
  )
  const photoTile = (photo: WallpaperImage) => {
    const active = custom === photo.url
    return (
      <div key={photo.name} className="wp-item">
        <button
          className={`wp-tile wp-photo ${active ? 'is-active' : ''}`}
          onClick={() => update({ customWallpaper: photo.url })}
          onContextMenu={e =>
            show(e, [
              { label: tr('Use as Wallpaper'), onSelect: () => update({ customWallpaper: photo.url }) },
              'separator',
              { label: tr('Remove Photo'), icon: Trash2, danger: true, onSelect: () => void remove(photo) },
            ])
          }
          aria-label={tr('Your photo')}
          aria-pressed={active}
        >
          {/* The small copy, loaded only once it scrolls into view. */}
          <img src={photo.thumb ?? photo.url} alt="" loading="lazy" decoding="async" draggable={false} />
        </button>
        <button className="wp-remove" onClick={() => void remove(photo)} aria-label={tr('Remove Photo')} title={tr('Remove Photo')}>
          <X size={11} />
        </button>
      </div>
    )
  }
  const addTile = (
    <div className="wp-item">
      <button className="wp-tile wp-add" onClick={() => input.current?.click()} disabled={uploading} aria-label={tr('Add a photo')} title={tr('Add a photo')}>
        {uploading ? <LoaderCircle size={compact ? 15 : 18} className="spin" /> : <ImagePlus size={compact ? 15 : 18} />}
      </button>
    </div>
  )

  if (compact) {
    // Two rows of four: the built-in ones, the newest photos (always including the one in use),
    // and the add tile. The rest are in Settings.
    let recent = photos.slice(0, COMPACT_TILES - wallpapers.length - 1)
    if (current && !recent.includes(current)) recent = [...recent.slice(0, -1), current]
    return (
      <div className={`wp-compact ${dragging ? 'is-dropping' : ''}`} {...dropTarget}>
        <div className="wp-grid is-compact">
          {wallpapers.map(builtInTile)}
          {recent.map(photoTile)}
          {addTile}
        </div>
        {fileInput}
        {error && <p className="form-error wp-error">{error}</p>}
        {onMore && (
          <button className="wp-more" onClick={onMore}>
            {photos.length > recent.length ? tr('All Wallpapers ({0})…', wallpapers.length + photos.length) : tr('Wallpaper Settings…')}
          </button>
        )}
      </div>
    )
  }

  // Two rows until asked for more (the add tile takes a slot), so a long collection stays short.
  const limit = Math.max(1, columns * PHOTO_ROWS - 1)
  const shown = showAll ? photos : photos.slice(0, limit)

  return (
    <div className={`group wp-group ${dragging ? 'is-dropping' : ''}`} {...dropTarget}>
      <div className="wp-current">
        <span
          className="wp-current-preview"
          style={currentPreview ? { backgroundImage: `url("${currentPreview}")` } : { background: builtIn.preview }}
          aria-hidden
        />
        <span className="wp-current-text">
          <strong>{tr('Wallpaper')}</strong>
          <small>{custom ? tr('Your photo') : builtIn.name}</small>
          <small className="row-hint">{tr('Drop an image here to add it.')}</small>
        </span>
        <button className="btn" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <LoaderCircle size={13} className="spin" /> : <ImagePlus size={13} />} {tr('Add Photo…')}
        </button>
        {fileInput}
      </div>
      {error && <p className="form-error wp-error">{error}</p>}

      <div className="wp-section">
        <h5>{tr('Built-in')}</h5>
        <div className="wp-grid">{wallpapers.map(builtInTile)}</div>
      </div>

      <div className="wp-section">
        <div className="wp-section-head">
          <h5>
            {tr('Your Photos')}
            {photos.length > 0 && <span className="wp-count">{photos.length}</span>}
          </h5>
          {photos.length > limit && (
            <button className="wp-more" onClick={() => setShowAll(v => !v)}>
              {showAll ? tr('Show Less') : tr('Show All ({0})', photos.length)}
            </button>
          )}
        </div>
        <div className="wp-grid" ref={grid}>
          {addTile}
          {shown.map(photoTile)}
        </div>
      </div>
    </div>
  )
}

const COMPACT_TILES = 8
const PHOTO_ROWS = 2
const TILE_MIN = 92
const TILE_GAP = 12

/** How many tiles fit across the grid (mirrors its auto-fill columns in app.css). */
function useColumns(ref: RefObject<HTMLElement | null>) {
  const [columns, setColumns] = useState(5)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setColumns(Math.max(1, Math.floor((el.clientWidth + TILE_GAP) / (TILE_MIN + TILE_GAP))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return columns
}
