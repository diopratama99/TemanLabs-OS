import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronLeft, Menu } from 'lucide-react'
import type { WindowId } from '../components/Window'
import { WindowErrorBoundary } from '../components/WindowErrorBoundary'
import { WindowIdContext } from '../lib/appMenus'
import { tr } from '../lib/i18n'
import { MobileBackContext, type BackHandler } from '../lib/mobileBack'
import { WindowActiveContext, WindowToolbarContext } from '../lib/windowChrome'

// Apps that measure their own pixels (a terminal's cells, an editor's lines, a remote screen),
// shown at their own size rather than enlarged.
const EXACT = ['terminal', 'code', 'remote']

// Sidebar apps whose list is the tab's own first screen instead of a drawer.
const NO_DRAWER = ['settings']

interface Props {
  id: WindowId | string
  title: string
  /** On top of its tab's stack, and the tab open. */
  visible: boolean
  onBack?: () => void
  /** The screen tells its back handler, if its app has pages of its own. */
  onBackHandler: (handler: BackHandler | null) => void
  /** How the desktop lays the app out (its sidebar becomes a drawer here). */
  variant?: 'sidebar' | 'compact' | 'default'
  actions?: ReactNode
  children: ReactNode
}

/**
 * One full screen on a phone: a bar with the way back, the app's own controls (what goes in a
 * window's title bar on the desktop), and the app below. An app's sidebar (Files' places, Disk
 * Manager's drives) opens as a drawer from the ☰ button.
 */
export function MobileScreen({ id, title, visible, onBack, onBackHandler, variant = 'default', actions, children }: Props) {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null)
  const drawerable = variant === 'sidebar' && !NO_DRAWER.includes(String(id))
  const [drawer, setDrawer] = useState(false)

  // Back closes the drawer first, then asks the app (its own pages), then leaves the screen.
  const appBack = useRef<BackHandler | null>(null)
  const drawerRef = useRef(drawer)
  drawerRef.current = drawer
  useEffect(() => {
    onBackHandler(() => {
      if (drawerRef.current) {
        setDrawer(false)
        return true
      }
      return appBack.current?.() ?? false
    })
    return () => onBackHandler(null)
  }, [onBackHandler])
  const setAppBack = useCallback((handler: BackHandler | null) => {
    appBack.current = handler
  }, [])

  // Choosing something in the drawer opens it, and puts the drawer away.
  const onBodyClick = (e: MouseEvent) => {
    if (!drawer) return
    const t = e.target as HTMLElement
    if (!t.closest('.split > .sidebar')) return
    if (t.closest('input, textarea, select, label.sidebar-search')) return
    if (t.closest('button, a, [role="option"], .sidebar-item')) setTimeout(() => setDrawer(false), 0)
  }

  const exact = EXACT.some(x => String(id) === x || String(id).startsWith(`${x}:`))
  return (
    <section
      className={`m-screen window is-active is-maximized is-${variant} ${exact ? 'is-exact' : ''} ${drawerable ? 'has-drawer' : ''} ${drawer ? 'is-drawer-open' : ''}`}
      hidden={!visible}
      aria-label={title}
    >
      <header className="m-bar">
        {onBack && (
          <button className="m-back" onClick={onBack} aria-label={tr('Back')}>
            <ChevronLeft size={24} />
          </button>
        )}
        {drawerable && (
          <button className="m-icon-btn m-drawer-btn" onClick={() => setDrawer(d => !d)} aria-label={tr('Show the list')} aria-expanded={drawer}>
            <Menu size={22} />
          </button>
        )}
        <h1 className="m-bar-title">{title}</h1>
        <div className="window-toolbar m-toolbar" ref={setToolbar} />
        {actions && <div className="m-bar-actions">{actions}</div>}
      </header>
      <div className="window-body m-body" onClickCapture={onBodyClick}>
        {drawer && <div className="m-drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden />}
        <MobileBackContext.Provider value={setAppBack}>
          <WindowIdContext.Provider value={id as WindowId}>
            <WindowActiveContext.Provider value={visible}>
              <WindowToolbarContext.Provider value={toolbar}>
                <WindowErrorBoundary>{children}</WindowErrorBoundary>
              </WindowToolbarContext.Provider>
            </WindowActiveContext.Provider>
          </WindowIdContext.Provider>
        </MobileBackContext.Provider>
      </div>
    </section>
  )
}
