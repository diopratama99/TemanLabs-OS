import { createContext, useContext, useEffect, useRef } from 'react'
import type { MenuItem } from '../components/ContextMenu'
import type { WindowId } from '../components/Window'

/** One menu-bar menu, e.g. "File" with its items. */
export interface AppMenu {
  label: string
  items: MenuItem[]
}

export type MenuBuilder = () => AppMenu[]

export interface MenuRegistry {
  register: (id: WindowId, build: MenuBuilder) => void
  unregister: (id: WindowId, build: MenuBuilder) => void
}

export const MenuRegistryContext = createContext<MenuRegistry | null>(null)

/** Provided by each Window so the content inside knows which window it belongs to. */
export const WindowIdContext = createContext<WindowId | null>(null)

/**
 * Supplies this window's menus (File, Edit, View…) to the menu bar while the window is frontmost,
 * like a desktop app. The builder is called whenever the menu bar renders or opens a menu, so its
 * items always reflect the component's current state.
 */
export function useAppMenus(build: MenuBuilder, enabled = true) {
  const id = useContext(WindowIdContext)
  const registry = useContext(MenuRegistryContext)
  const latest = useRef(build)
  latest.current = build

  useEffect(() => {
    if (!id || !registry || !enabled) return
    const getter = () => latest.current()
    registry.register(id, getter)
    return () => registry.unregister(id, getter)
  }, [id, registry, enabled])
}
