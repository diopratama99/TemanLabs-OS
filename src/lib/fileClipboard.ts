import { useSyncExternalStore } from 'react'

/** Files' Cut/Copy clipboard: paths on the server, shared by every Files window. */
export interface FileClip {
  paths: string[]
  cut: boolean
}

let clip: FileClip | null = null
const listeners = new Set<() => void>()

export function setFileClipboard(next: FileClip | null) {
  clip = next
  listeners.forEach(l => l())
}

export function useFileClipboard() {
  return useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => clip,
  )
}
