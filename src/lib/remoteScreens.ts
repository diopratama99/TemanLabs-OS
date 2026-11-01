// VNC shares every screen of the other computer as one picture, without saying where each screen
// is (a remote desktop app with its own program on the computer can ask it; VNC can't). So the
// screens are found on the picture itself: what no screen covers is drawn pure black, and screens
// of different heights or places show as steps along the edges (findScreens). Screens that touch
// edge to edge are told apart by their common sizes. One is shown: big enough to read, and less for
// this browser to draw. RDP always draws a single screen the size of the window.

/** A screen within the picture. */
export type Region = { x: number; y: number; w: number; h: number }
/** auto, n<count> (equal widths), or w<width,width…> (left to right). */
export type Layout = string
const COMMON_WIDTHS = [3840, 3440, 2560, 2048, 1920, 1680, 1600, 1536, 1440, 1366, 1280, 1024]

const fromWidths = (widths: number[], h: number): Region[] => {
  let x = 0
  return widths.map(w => {
    const r = { x, y: 0, w, h }
    x += w
    return r
  })
}
const equalSplit = (w: number, h: number, n: number) =>
  fromWidths(
    Array.from({ length: n }, (_, i) => Math.round(((i + 1) * w) / n) - Math.round((i * w) / n)),
    h,
  )

/** Ways to cut a picture this wide into 2–4 screens of common widths, fewest screens first. */
export function screenSplits(w: number, h: number): number[][] {
  const out: number[][] = []
  const walk = (left: number, parts: number[]) => {
    if (left === 0) {
      if (parts.length >= 2) out.push(parts)
      return
    }
    if (parts.length === 4 || out.length >= 12) return
    for (const c of COMMON_WIDTHS) if (c <= left && c / h <= 2.4 && c / h >= 0.5) walk(left - c, [...parts, c])
  }
  walk(w, [])
  return out.sort((a, b) => a.length - b.length)
}

/**
 * The screens in a picture, for a layout. auto takes the screens found on the picture when there
 * are (found), else goes by size: a normal (or ultrawide) shape is one screen.
 */
export function screenRegions(w: number, h: number, layout: Layout, found?: Region[] | null): Region[] {
  if (/^n[1-4]$/.test(layout)) return equalSplit(w, h, Number(layout.slice(1)))
  if (layout.startsWith('w')) {
    const widths = layout.slice(1).split(',').map(Number)
    if (widths.every(n => n > 0) && widths.reduce((a, b) => a + b, 0) === w) return fromWidths(widths, h)
  }
  if (found?.length) return found
  if (w / h <= 2.5) return equalSplit(w, h, 1)
  const n = Math.min(4, Math.max(2, Math.round(w / h / (16 / 9))))
  if (COMMON_WIDTHS.includes(w / n)) return equalSplit(w, h, n)
  const split = screenSplits(w, h)[0]
  return split ? fromWidths(split, h) : equalSplit(w, h, n)
}

// Screen sizes, landscape (portrait ones are these turned).
const COMMON_SIZES: [number, number][] = [
  [3840, 2160], [3440, 1440], [2560, 1600], [2560, 1440], [2560, 1080], [2048, 1152], [1920, 1200], [1920, 1080],
  [1680, 1050], [1600, 900], [1536, 864], [1440, 900], [1366, 768], [1280, 1024], [1280, 800], [1280, 720], [1024, 768],
]
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(8, b * 0.01)
const isScreenSize = (w: number, h: number) => COMMON_SIZES.some(([a, b]) => (near(w, a) && near(h, b)) || (near(w, b) && near(h, a)))

/** A covered area made of screens edge to edge: as one screen, or cut into same-size ones. */
function cutBySize(r: Region): Region[] {
  if (isScreenSize(r.w, r.h)) return [r]
  for (const [a, b] of COMMON_SIZES)
    for (const [sw, sh] of [[a, b], [b, a]]) {
      for (let n = 2; n <= 4; n++) {
        if (near(r.h, sh) && near(r.w, sw * n)) return Array.from({ length: n }, (_, i) => ({ x: r.x + Math.round((i * r.w) / n), y: r.y, w: Math.round(r.w / n), h: r.h }))
        if (near(r.w, sw) && near(r.h, sh * n)) return Array.from({ length: n }, (_, i) => ({ x: r.x, y: r.y + Math.round((i * r.h) / n), w: r.w, h: Math.round(r.h / n) }))
      }
    }
  // Side by side screens of different widths, as before.
  const split = r.w / r.h > 2.5 ? screenSplits(r.w, r.h)[0] : null
  return split ? fromWidths(split, r.h).map(s => ({ ...s, x: s.x + r.x, y: r.y })) : [r]
}

/**
 * Finds the screens on a picture of them all: lit(x, y) says whether a pixel isn't the pure black
 * drawn where no screen is. The picture is looked at in cells of step pixels. An area is cut where a
 * band of black runs across it, or where its edge steps (a screen lower, shorter or narrower than
 * the one beside it); where it could be cut either way, the way that makes the fewest parts of
 * screen sizes wins. Each part's edges are then found to the pixel. Screens come out in reading
 * order. Empty when nothing is lit (a screen that's off).
 */
export function findScreens(lit: (x: number, y: number) => boolean, w: number, h: number, step = 8): Region[] {
  const cols = Math.ceil(w / step)
  const rows = Math.ceil(h / step)
  const grid = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = c * step
      const y0 = r * step
      const x1 = Math.min(w - 1, x0 + step - 1)
      const y1 = Math.min(h - 1, y0 + step - 1)
      const mx = (x0 + x1) >> 1
      const my = (y0 + y1) >> 1
      grid[r * cols + c] = lit(x0, y0) || lit(x1, y1) || lit(mx, my) || lit(x1, y0) || lit(x0, y1) ? 1 : 0
    }
  const on = (c: number, r: number) => grid[r * cols + c] === 1
  type Box = { c0: number; r0: number; c1: number; r1: number } // c1, r1 exclusive
  const tolerance = 2 // cells: a step this small is the same edge
  const toRegion = (b: Box): Region => {
    const x = Math.min(w, b.c0 * step)
    const y = Math.min(h, b.r0 * step)
    return { x, y, w: Math.min(w, b.c1 * step) - x, h: Math.min(h, b.r1 * step) - y }
  }
  // How good a way of cutting is: fewer parts, and parts that are screen sizes.
  const score = (boxes: Box[]) =>
    boxes.map(toRegion).flatMap(cutBySize).reduce((sum, r) => sum + 10 + (isScreenSize(r.w, r.h) ? 0 : 25), 0)
  const memo = new Map<string, Box[]>()

  const solve = (b: Box, depth: number): Box[] => {
    // Trim to what's lit.
    let { c0, r0, c1, r1 } = b
    const colLit = (c: number) => {
      for (let r = r0; r < r1; r++) if (on(c, r)) return true
      return false
    }
    const rowLit = (r: number) => {
      for (let c = c0; c < c1; c++) if (on(c, r)) return true
      return false
    }
    while (c0 < c1 && !colLit(c0)) c0++
    while (c1 > c0 && !colLit(c1 - 1)) c1--
    while (r0 < r1 && !rowLit(r0)) r0++
    while (r1 > r0 && !rowLit(r1 - 1)) r1--
    if (c0 >= c1 || r0 >= r1) return []
    const box = { c0, r0, c1, r1 }
    const key = `${c0},${r0},${c1},${r1}`
    const known = memo.get(key)
    if (known) return known
    let result: Box[] = [box]
    if (depth < 16) {
      // A black band across: two areas, whatever else.
      let band: [Box, Box] | null = null
      for (let c = c0 + 1; c < c1 - 1 && !band; c++) if (!colLit(c)) band = [{ c0, r0, c1: c, r1 }, { c0: c + 1, r0, c1, r1 }]
      for (let r = r0 + 1; r < r1 - 1 && !band; r++) if (!rowLit(r)) band = [{ c0, r0, c1, r1: r }, { c0, r0: r + 1, c1, r1 }]
      if (band) result = [...solve(band[0], depth + 1), ...solve(band[1], depth + 1)]
      else {
        // An edge that steps, down the columns or along the rows: both are tried.
        const cuts: [Box, Box][] = []
        const span = (c: number) => {
          let top = r0
          while (top < r1 && !on(c, top)) top++
          let bottom = r1 - 1
          while (bottom > top && !on(c, bottom)) bottom--
          return [top, bottom]
        }
        for (let c = c0 + 1; c < c1; c++) {
          const [t0, b0] = span(c - 1)
          const [t1, b1] = span(c)
          if (Math.abs(t0 - t1) > tolerance || Math.abs(b0 - b1) > tolerance) {
            cuts.push([{ c0, r0, c1: c, r1 }, { c0: c, r0, c1, r1 }])
            break
          }
        }
        const reach = (r: number) => {
          let left = c0
          while (left < c1 && !on(left, r)) left++
          let right = c1 - 1
          while (right > left && !on(right, r)) right--
          return [left, right]
        }
        for (let r = r0 + 1; r < r1; r++) {
          const [l0, e0] = reach(r - 1)
          const [l1, e1] = reach(r)
          if (Math.abs(l0 - l1) > tolerance || Math.abs(e0 - e1) > tolerance) {
            cuts.push([{ c0, r0, c1, r1: r }, { c0, r0: r, c1, r1 }])
            break
          }
        }
        let best = Infinity
        for (const [a, z] of cuts) {
          const parts = [...solve(a, depth + 1), ...solve(z, depth + 1)]
          const sc = score(parts)
          if (sc < best) {
            best = sc
            result = parts
          }
        }
      }
    }
    memo.set(key, result)
    return result
  }

  // A part's edges to the pixel: a cell on a black edge is only partly the screen's, so the edge
  // moves in to where it's lit, along a few lines. (Between two screens it stays on the cell edge.)
  const lines = (from: number, len: number) => [0.2, 0.5, 0.8].map(f => Math.min(from + len - 1, Math.round(from + f * len)))
  const litAcross = (x: number, ys: number[]) => ys.filter(y => lit(x, y)).length >= 2
  const litAlong = (y: number, xs: number[]) => xs.filter(x => lit(x, y)).length >= 2
  const refine = (r: Region): Region => {
    const ys = lines(r.y, r.h)
    const xs = lines(r.x, r.w)
    let x0 = r.x
    while (x0 < r.x + step && !litAcross(x0, ys)) x0++
    let x1 = r.x + r.w
    while (x1 > r.x + r.w - step && !litAcross(x1 - 1, ys)) x1--
    let y0 = r.y
    while (y0 < r.y + step && !litAlong(y0, xs)) y0++
    let y1 = r.y + r.h
    while (y1 > r.y + r.h - step && !litAlong(y1 - 1, xs)) y1--
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : r
  }
  // A screen showing black along an edge (a film's bars) looks smaller than it is: it's taken to
  // the screen size it falls short of, over the black, when the picture has room.
  const blackRows = (y0: number, y1: number, xs: number[]) => {
    for (let y = y0; y < y1; y += 4) if (litAlong(y, xs)) return false
    return true
  }
  const blackCols = (x0: number, x1: number, ys: number[]) => {
    for (let x = x0; x < x1; x += 4) if (litAcross(x, ys)) return false
    return true
  }
  const grow = (r: Region): Region => {
    if (isScreenSize(r.w, r.h)) return r
    for (const [a, b] of COMMON_SIZES)
      for (const [sw, sh] of [[a, b], [b, a]]) {
        const extraH = sh - r.h
        if (near(r.w, sw) && extraH > 0 && extraH <= sh * 0.4) {
          const xs = lines(r.x, r.w)
          if (r.y - extraH >= 0 && blackRows(r.y - extraH, r.y, xs)) return { ...r, y: r.y - extraH, h: sh }
          if (r.y + r.h + extraH <= h && blackRows(r.y + r.h, r.y + r.h + extraH, xs)) return { ...r, h: sh }
        }
        const extraW = sw - r.w
        if (near(r.h, sh) && extraW > 0 && extraW <= sw * 0.4) {
          const ys = lines(r.y, r.h)
          if (r.x - extraW >= 0 && blackCols(r.x - extraW, r.x, ys)) return { ...r, x: r.x - extraW, w: sw }
          if (r.x + r.w + extraW <= w && blackCols(r.x + r.w, r.x + r.w + extraW, ys)) return { ...r, w: sw }
        }
      }
    return r
  }

  const screens = solve({ c0: 0, r0: 0, c1: cols, r1: rows }, 0)
    .map(toRegion)
    .map(refine)
    .filter(r => r.w >= 480 && r.h >= 360)
    .flatMap(cutBySize)
    .map(grow)
  return screens.sort((a, b) => (Math.abs(a.y - b.y) < 64 ? a.x - b.x : a.y - b.y))
}
