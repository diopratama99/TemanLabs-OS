import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { WallpaperImage } from '../api/types'
import { useContextMenu } from '../lib/contextMenu'
import { prepareWallpaper } from '../lib/image'
import { useSettings } from '../lib/settings'

// Colors for the actual wallpapers live in base.css under .wallpaper[data-wp]; these are swatch previews.
export const wallpapers = [
  { name: 'Twilight', preview: 'linear-gradient(160deg, #0d1b4c, #2c6bff 45%, #ff4f9a 75%, #ff9a4d)' },
  { name: 'Aurora', preview: 'linear-gradient(160deg, #04192b, #00c9a7 45%, #6e4bff)' },
  { name: 'Sunset', preview: 'linear-gradient(160deg, #2a0d36, #ff2e7e 50%, #ffb23a)' },
]

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
  return (
    <div className="wallpaper" data-wp={settings.wallpaper} aria-hidden>
      {photo && <Photo key={photo} url={photo} />}
      <svg className="wallpaper-art" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
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

/** The user's photo, faded in over the built-in art once it has loaded (the art stays if it fails). */
function Photo({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      className={`wallpaper-photo ${loaded ? 'is-loaded' : ''}`}
      src={url}
      alt=""
      decoding="async"
      onLoad={() => setLoaded(true)}
    />
  )
}

/** Built-in wallpapers, the user's photos, and a button (or drop target) to add a photo. */
export function WallpaperPicker() {
  const { settings, update } = useSettings()
  const { show } = useContextMenu()
  const [photos, setPhotos] = useState<WallpaperImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

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

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void add([...e.dataTransfer.files].find(f => f.type.startsWith('image/')))
  }

  return (
    <div className="wp-picker-wrap">
      <div
        className={`wp-picker ${dragging ? 'is-dropping' : ''}`}
        onDragOver={e => {
          if (![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {wallpapers.map((wp, i) => (
          <button
            key={wp.name}
            className={`wp-swatch ${!settings.customWallpaper && i === settings.wallpaper ? 'is-active' : ''}`}
            style={{ background: wp.preview }}
            onClick={() => update({ wallpaper: i, customWallpaper: null })}
            aria-label={`${wp.name} wallpaper`}
            title={wp.name}
          />
        ))}
        {photos.map(photo => (
          <button
            key={photo.name}
            className={`wp-swatch wp-photo ${settings.customWallpaper === photo.url ? 'is-active' : ''}`}
            style={{ backgroundImage: `url("${photo.url}")` }}
            onClick={() => update({ customWallpaper: photo.url })}
            onContextMenu={e =>
              show(e, [
                { label: 'Use as Wallpaper', onSelect: () => update({ customWallpaper: photo.url }) },
                'separator',
                { label: 'Remove Photo', icon: Trash2, danger: true, onSelect: () => void remove(photo) },
              ])
            }
            aria-label="Your photo"
            title="Your photo (right-click to remove)"
          />
        ))}
        <button
          className="wp-swatch wp-add"
          onClick={() => input.current?.click()}
          disabled={uploading}
          aria-label="Add a photo"
          title="Use your own photo (or drop one here)"
        >
          {uploading ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}
        </button>
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
      </div>
      {error && <p className="form-error wp-error">{error}</p>}
    </div>
  )
}
