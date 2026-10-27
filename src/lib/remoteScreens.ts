// VNC shares every screen of the other computer as one wide picture. It's cut back into screens
// by width (two 1920s side by side are 3840 wide), and one is shown: big enough to read, and less
// for this browser to draw. RDP always draws a single screen the size of the window.

/** A screen within the picture: where it starts and how wide it is (it spans the full height). */
export type Region = { x: number; w: number }
/** auto, n<count> (equal widths), or w<width,width…> (left to right). */
export type Layout = string
const COMMON_WIDTHS = [3840, 3440, 2560, 2048, 1920, 1680, 1600, 1536, 1440, 1366, 1280, 1024]

const fromWidths = (widths: number[]): Region[] => {
  let x = 0
  return widths.map(w => {
    const r = { x, w }
    x += w
    return r
  })
}
const equalSplit = (w: number, n: number) => fromWidths(Array.from({ length: n }, (_, i) => Math.round(((i + 1) * w) / n) - Math.round((i * w) / n)))

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

/** The screens in a picture, for a layout. A normal (or ultrawide) shape is one screen. */
export function screenRegions(w: number, h: number, layout: Layout): Region[] {
  if (/^n[1-4]$/.test(layout)) return equalSplit(w, Number(layout.slice(1)))
  if (layout.startsWith('w')) {
    const widths = layout.slice(1).split(',').map(Number)
    if (widths.every(n => n > 0) && widths.reduce((a, b) => a + b, 0) === w) return fromWidths(widths)
  }
  if (w / h <= 2.5) return equalSplit(w, 1)
  const n = Math.min(4, Math.max(2, Math.round(w / h / (16 / 9))))
  if (COMMON_WIDTHS.includes(w / n)) return equalSplit(w, n)
  const split = screenSplits(w, h)[0]
  return split ? fromWidths(split) : equalSplit(w, n)
}

