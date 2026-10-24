import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * Keeps something mounted for `exitMs` after `open` turns false, so it can play its closing
 * animation (styled through `closing`) before it disappears.
 */
export function usePresence(open: boolean, exitMs: number) {
  const [rendered, setRendered] = useState(open)
  useEffect(() => {
    if (open) {
      setRendered(true)
      return
    }
    const timer = setTimeout(() => setRendered(false), prefersReducedMotion() ? 0 : exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs])
  return { mounted: open || rendered, closing: !open && rendered }
}
