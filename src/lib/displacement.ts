const cache = new Map<string, string>()
const CACHE_LIMIT = 64
// The map is smooth, so it is rendered small and stretched by feImage.
const MAX_MAP_SIZE = 320

/**
 * Displacement map for a rounded rectangle, used by feDisplacementMap. The centre is neutral;
 * inside a `bezel`-wide band along the edge every pixel samples the backdrop further inward,
 * so the rim magnifies what sits behind it the way the edge of a thick lens does.
 * Red/green encode the x/y shift around 128.
 */
export function displacementMap(width: number, height: number, radius: number, bezel: number) {
  const key = `${width}x${height}:${radius}:${bezel}`
  const hit = cache.get(key)
  if (hit) return hit

  const k = Math.min(1, MAX_MAP_SIZE / Math.max(width, height))
  const w = Math.max(1, Math.round(width * k))
  const h = Math.max(1, Math.round(height * k))
  const r = Math.min(radius * k, w / 2, h / 2)
  const band = Math.max(1, bezel * k)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const halfW = w / 2
  const halfH = h / 2

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - halfW
      const py = y + 0.5 - halfH
      // Distance to the straight parts of the edge (positive once inside a corner zone).
      const qx = Math.abs(px) - (halfW - r)
      const qy = Math.abs(py) - (halfH - r)
      let nx = 0
      let ny = 0
      let dist: number
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy)
        dist = r - len
        nx = qx / len
        ny = qy / len
      } else if (qx > qy) {
        dist = r - qx
        nx = 1
      } else {
        dist = r - qy
        ny = 1
      }

      let strength = 0
      if (dist >= 0 && dist < band) {
        const t = 1 - dist / band
        strength = t * t
      }

      const i = (y * w + x) * 4
      img.data[i] = 128 - Math.sign(px) * nx * strength * 127
      img.data[i + 1] = 128 - Math.sign(py) * ny * strength * 127
      img.data[i + 2] = 128
      img.data[i + 3] = 255
    }
  }

  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL()
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, url)
  return url
}
