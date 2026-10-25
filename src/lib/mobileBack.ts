import { createContext, useContext, useEffect, useRef } from 'react'

// On a phone, the screen's back button (and the phone's own) asks the screen first: an app with
// pages of its own (Settings' sections, an app's details) steps back inside before the screen
// itself closes. A handler returns true when it went back.

export type BackHandler = () => boolean

export const MobileBackContext = createContext<((handler: BackHandler | null) => void) | null>(null)

export function useMobileBack(handler: BackHandler) {
  const set = useContext(MobileBackContext)
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    if (!set) return
    set(() => latest.current())
    return () => set(null)
  }, [set])
}
