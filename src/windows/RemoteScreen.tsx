import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ClipboardCopy,
  Expand,
  Hand,
  Keyboard as KeyboardIcon,
  LoaderCircle,
  Monitor,
  MonitorOff,
  MousePointer2,
  RotateCw,
  Shrink,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
// The package's ES build exports the whole Guacamole namespace as its default export.
import Guacamole, { type Client, type Status } from 'guacamole-common-js'
import { api } from '../api'
import type { Device } from '../api/types'
import { copyText } from '../lib/clipboard'
import { tr } from '../lib/i18n'
import { screenRegions, screenSplits, type Layout } from '../lib/remoteScreens'
import { KIND_ICON } from './Devices'

// A device's screen in a window. The server opens the VNC or RDP session (with the saved
// password) through the remote desktop engine and relays it here; this only draws the picture
// and sends keys, clicks and copied text. On a touch screen it works like a remote desktop app on
// a phone: the finger drives a pointer (touchpad) or clicks where it lands (touch), a keyboard
// comes up on screen, and the picture zooms.

type Phase = 'connecting' | 'connected' | 'error' | 'closed'
type TouchMode = 'touchpad' | 'touch'

// X11 keysyms for the modifier keys.
const CTRL_L = 0xffe3
const CTRL_R = 0xffe4
const META_L = 0xffe7
const META_R = 0xffe8
const ALT_L = 0xffe9
const SUPER_L = 0xffeb
const DELETE = 0xffff
const BACKSPACE = 0xff08
const RETURN = 0xff0d
const TAB = 0xff09
const ESCAPE = 0xff1b
const KEY_V = [0x76, 0x56]
// How long to wait for the browser's paste event after Ctrl+V before sending the key anyway.
const PASTE_WAIT_MS = 200
const RESIZE_DEBOUNCE_MS = 300
// Zoom steps on a touch screen, over the picture fitted to the window.
const ZOOMS = [1, 1.5, 2, 3, 4]
// How close to the edge the pointer may come before a zoomed picture follows it.
const FOLLOW_MARGIN = 48
// A remote desktop's size when asked from a phone: a desktop's, zoomed into, rather than one the
// shape of a phone.
const TOUCH_SIZE = { width: 1600, height: 900 }
// What the hidden text field holds, so a backspace always has something to delete.
const SENTINEL = '  '

function readStored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered; fine.
  }
}

const localIsMac = /Mac|iPhone|iPad/.test(navigator.platform)
const touchScreen = matchMedia('(pointer: coarse)').matches

const swapKey = (keysym: number) =>
  keysym === CTRL_L ? META_L : keysym === CTRL_R ? META_R : keysym === META_L ? CTRL_L : keysym === META_R ? CTRL_R : keysym

// A typed character as a keysym: Latin-1 as itself, anything else by its code point.
const charKeysym = (ch: string) => {
  if (ch === '\n') return RETURN
  if (ch === '\t') return TAB
  const code = ch.codePointAt(0)!
  return code < 0x100 ? code : 0x01000000 | code
}

function readSwap(device: Device) {
  try {
    const saved = localStorage.getItem(`remote.swap.${device.id}`)
    if (saved !== null) return saved === '1'
  } catch {
    // Storage unavailable: use the default.
  }
  // The shortcut key differs (Ctrl here, Command there, or the other way round).
  return localIsMac !== (device.kind === 'mac')
}

function readMode(): TouchMode {
  try {
    return localStorage.getItem('remote.touchMode') === 'touch' ? 'touch' : 'touchpad'
  } catch {
    return 'touchpad'
  }
}

// The server's own failures come as keys; the rest are guacd's.
function errorText(status: Status, device: Device) {
  switch (status.message) {
    case 'screen-off':
      return tr('{0} is on, but nothing answers on port {1}. Turn on its screen sharing, and allow it through the firewall.', device.name, device.port)
    case 'unreachable':
      return tr('Couldn’t reach {0}. It may be off or asleep; try Wake in Devices.', device.name)
    case 'engine-down':
      return tr('The remote desktop engine isn’t running.')
    case 'device-gone':
      return tr('This device no longer exists.')
    case 'no-screen':
      return tr('Screen sharing isn’t set up for this device.')
  }
  switch (status.code) {
    // The server checked that the port answers, so this is the sign-in failing.
    case 0x0207: // UPSTREAM_NOT_FOUND
    case 0x0203: // UPSTREAM_ERROR
    case 0x0301: // CLIENT_UNAUTHORIZED
    case 0x0303: // CLIENT_FORBIDDEN
      return device.kind === 'mac'
        ? tr('{0} didn’t accept the sign-in. Check the password in the device’s settings, and that the Mac lets VNC viewers control the screen with a password.', device.name)
        : tr('{0} didn’t accept the sign-in. Check the user name and password in the device’s settings.', device.name)
    case 0x0202: // UPSTREAM_TIMEOUT
      return tr('{0} stopped answering.', device.name)
    case 0x0209: // SESSION_CONFLICT
      return tr('Someone else took over this session.')
  }
  return status.message || tr('The connection failed.')
}

export function RemoteScreen({ device, active }: { device: Device; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const crop = useRef<HTMLDivElement>(null)
  const typing = useRef<HTMLTextAreaElement>(null)
  const clientRef = useRef<Client | null>(null)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [fit, setFit] = useState(true)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [remoteText, setRemoteText] = useState<string | null>(null)
  const [swap, setSwap] = useState(() => readSwap(device))
  const [mode, setMode] = useState<TouchMode>(readMode)
  const [zoom, setZoom] = useState(1)
  const [keysOpen, setKeysOpen] = useState(false)
  // Modifiers held for the next key from the on-screen keys.
  const [held, setHeld] = useState<number[]>([])
  // Which screen is shown (an index, or "all"), and how the picture is cut into screens.
  const [screen, setScreen] = useState(() => readStored(`remote.screen.${device.id}`, '0'))
  const [layout, setLayout] = useState<Layout>(() => readStored(`remote.layout.${device.id}`, 'auto'))
  const [allNotice, setAllNotice] = useState(false)
  const regions = device.protocol === 'vnc' && size ? screenRegions(size.width, size.height, layout) : []
  const shownRegion = screen === 'all' || regions.length < 2 ? null : (regions[Number(screen)] ?? regions[0])
  const regionRef = useRef(shownRegion)
  regionRef.current = shownRegion
  const swapRef = useRef(swap)
  swapRef.current = swap
  const fitRef = useRef(fit)
  fitRef.current = fit
  const modeRef = useRef(mode)
  modeRef.current = mode
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const heldRef = useRef(held)
  heldRef.current = held
  const keysOpenRef = useRef(keysOpen)
  keysOpenRef.current = keysOpen

  // Scales the picture (or the one screen shown) to the window, or shows it 1:1 with scroll bars,
  // then zoomed. One screen is cut out with a negative margin in a box that hides the rest, which
  // keeps the mouse's positions right (Guacamole reads them from offsets, not transforms).
  const rescale = () => {
    const client = clientRef.current
    const el = host.current
    if (!client || !el) return
    const display = client.getDisplay()
    const w = display.getWidth()
    const h = display.getHeight()
    if (!w || !h) return
    const region = regionRef.current
    const shownW = region ? region.w : w
    const base = fitRef.current ? Math.min(el.clientWidth / shownW, el.clientHeight / h) : 1 / (window.devicePixelRatio || 1)
    const scale = base * zoomRef.current
    display.scale(scale)
    const box = crop.current
    const view = display.getElement()
    if (box) {
      box.style.width = region ? `${region.w * scale}px` : ''
      box.style.height = region ? `${h * scale}px` : ''
      view.style.marginLeft = region ? `${-region.x * scale}px` : ''
    }
  }

  // Zooms to a step, keeping the point under (x, y) in the window where it was.
  const zoomTo = (next: number, x?: number, y?: number) => {
    const el = host.current
    const client = clientRef.current
    if (!el || !client) return
    const before = client.getDisplay().getScale()
    const cx = x ?? el.clientWidth / 2
    const cy = y ?? el.clientHeight / 2
    const px = (el.scrollLeft + cx) / before
    const py = (el.scrollTop + cy) / before
    zoomRef.current = next
    setZoom(next)
    rescale()
    const after = client.getDisplay().getScale()
    el.scrollLeft = px * after - cx
    el.scrollTop = py * after - cy
  }
  // The next step up or down from wherever a pinch left it.
  const stepZoom = (dir: 1 | -1) => {
    const now = zoomRef.current
    const next = dir > 0 ? ZOOMS.find(z => z > now + 0.01) : [...ZOOMS].reverse().find(z => z < now - 0.01)
    if (next !== undefined) zoomTo(next)
  }

  // A key press and release, with any held modifiers around it.
  const tapKey = (keysym: number) => {
    const client = clientRef.current
    if (!client) return
    const mods = heldRef.current
    const send = (pressed: 0 | 1, k: number) => client.sendKeyEvent(pressed, swapRef.current ? swapKey(k) : k)
    for (const m of mods) send(1, m)
    send(1, keysym)
    send(0, keysym)
    for (const m of [...mods].reverse()) send(0, m)
    if (mods.length) setHeld([])
  }

  useEffect(() => {
    const el = host.current
    const mount = surface.current
    if (!el || !mount) return
    setPhase('connecting')
    setError(null)
    const url = api.remoteUrl(device.id)
    if (!url) {
      setPhase('error')
      setError(tr('Remote screens need the server; they aren’t available in this preview.'))
      return
    }
    const dpr = window.devicePixelRatio || 1
    const tunnel = new Guacamole.WebSocketTunnel(url)
    const client = new Guacamole.Client(tunnel)
    clientRef.current = client
    const display = client.getDisplay()
    const view = display.getElement()
    ;(crop.current ?? mount).appendChild(view)
    let failed = false

    client.onstatechange = state => {
      if (state === Guacamole.Client.State.CONNECTED) {
        setPhase('connected')
        if (!touchScreen) el.focus({ preventScroll: true })
        display.showCursor(touchScreen && modeRef.current === 'touchpad')
      } else if (state === Guacamole.Client.State.DISCONNECTED && !failed) setPhase('closed')
    }
    client.onerror = status => {
      failed = true
      setError(errorText(status, device))
      setPhase('error')
    }
    client.onrequired = params => {
      failed = true
      setError(tr('{0} asks for: {1}. Add it in the device’s settings.', device.name, params.join(', ')))
      setPhase('error')
      client.disconnect()
    }
    display.onresize = (width, height) => {
      setSize({ width, height })
      rescale()
    }

    // Text copied there: onto this computer's clipboard when the browser allows it, otherwise
    // offered with a button (copying needs a click on plain http).
    client.onclipboard = (stream, mimetype) => {
      if (!/^text\//.test(mimetype)) return
      const reader = new Guacamole.StringReader(stream)
      let text = ''
      reader.ontext = chunk => (text += chunk)
      reader.onend = () => {
        if (window.isSecureContext && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => setRemoteText(text))
        else setRemoteText(text)
      }
    }
    const sendClipboard = (text: string) => {
      const writer = new Guacamole.StringWriter(client.createClipboardStream('text/plain'))
      writer.sendText(text)
      writer.sendEnd()
    }

    type MouseEvent = { state: InstanceType<typeof Guacamole.Mouse.State> }
    const mouse = new Guacamole.Mouse(view)
    mouse.onEach(['mousedown', 'mousemove', 'mouseup'], e => client.sendMouseState((e as unknown as MouseEvent).state, true))
    display.oncursor = (canvas, x, y) => mouse.setCursor(canvas, x, y)

    // Touch: a touchpad (the finger moves a pointer; tap to click, two fingers to right-click or
    // scroll, tap then drag to drag) or a touch screen (it clicks where it lands; hold to
    // right-click). Both listen all the time; the chosen one is the one that's heard.
    const cleanups: (() => void)[] = []
    if (touchScreen) {
      const pad = new Guacamole.Mouse.Touchpad(view)
      pad.onEach(['mousedown', 'mousemove', 'mouseup'], e => {
        if (modeRef.current !== 'touchpad') return
        const state = (e as unknown as MouseEvent).state
        client.sendMouseState(state, true)
        const scale = display.getScale()
        display.moveCursor(state.x / scale, state.y / scale)
        // A zoomed picture follows the pointer.
        const left = view.offsetLeft + state.x - el.scrollLeft
        const top = view.offsetTop + state.y - el.scrollTop
        if (left < FOLLOW_MARGIN) el.scrollLeft -= FOLLOW_MARGIN - left
        else if (left > el.clientWidth - FOLLOW_MARGIN) el.scrollLeft += left - (el.clientWidth - FOLLOW_MARGIN)
        if (top < FOLLOW_MARGIN) el.scrollTop -= FOLLOW_MARGIN - top
        else if (top > el.clientHeight - FOLLOW_MARGIN) el.scrollTop += top - (el.clientHeight - FOLLOW_MARGIN)
      })
      const screen = new Guacamole.Mouse.Touchscreen(view)
      screen.onEach(['mousedown', 'mousemove', 'mouseup'], e => {
        if (modeRef.current === 'touch') client.sendMouseState((e as unknown as MouseEvent).state, true)
      })

      // Touch mode: two fingers pinch to zoom and drag to look around. (In touchpad mode two
      // fingers scroll the other computer, and the pointer leads the way.)
      let pinch: { dist: number; zoom: number; x: number; y: number } | null = null
      const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
      const middle = (t: TouchList) => {
        const r = el.getBoundingClientRect()
        return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top }
      }
      const onStart = (e: TouchEvent) => {
        if (modeRef.current !== 'touch' || e.touches.length !== 2) return
        const m = middle(e.touches)
        pinch = { dist: spread(e.touches) || 1, zoom: zoomRef.current, ...m }
      }
      const onMove = (e: TouchEvent) => {
        if (!pinch || e.touches.length !== 2) return
        e.preventDefault()
        const m = middle(e.touches)
        el.scrollLeft -= m.x - pinch.x
        el.scrollTop -= m.y - pinch.y
        pinch.x = m.x
        pinch.y = m.y
        const next = Math.min(ZOOMS.at(-1)!, Math.max(1, (pinch.zoom * spread(e.touches)) / pinch.dist))
        if (Math.abs(next - zoomRef.current) > 0.01) zoomTo(next, m.x, m.y)
      }
      const onEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) pinch = null
      }
      el.addEventListener('touchstart', onStart, { passive: true })
      el.addEventListener('touchmove', onMove, { passive: false })
      el.addEventListener('touchend', onEnd)
      el.addEventListener('touchcancel', onEnd)
      cleanups.push(() => {
        el.removeEventListener('touchstart', onStart)
        el.removeEventListener('touchmove', onMove)
        el.removeEventListener('touchend', onEnd)
        el.removeEventListener('touchcancel', onEnd)
      })
    }

    const keyboard = new Guacamole.Keyboard(el)
    const key = (pressed: boolean, keysym: number) => client.sendKeyEvent(pressed ? 1 : 0, swapRef.current ? swapKey(keysym) : keysym)
    // Ctrl+V (or Command+V) lets the browser paste first, so that text goes across before the
    // keystroke does.
    let pendingPaste: number | null = null
    let pasteTimer = 0
    const finishPaste = () => {
      clearTimeout(pasteTimer)
      if (pendingPaste !== null) key(true, pendingPaste)
      pendingPaste = null
    }
    keyboard.onkeydown = keysym => {
      const mods = keyboard.modifiers
      if (KEY_V.includes(keysym) && (mods.ctrl || mods.meta) && !mods.alt) {
        pendingPaste = keysym
        pasteTimer = window.setTimeout(finishPaste, PASTE_WAIT_MS)
        return true
      }
      key(true, keysym)
      return false
    }
    keyboard.onkeyup = keysym => key(false, keysym)
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain')
      if (text) sendClipboard(text)
      e.preventDefault()
      finishPaste()
    }
    // Keys typed here belong to the other computer, not to this desktop's shortcuts.
    const stop = (e: Event) => e.stopPropagation()
    el.addEventListener('paste', onPaste)
    el.addEventListener('keydown', stop)
    el.addEventListener('keyup', stop)
    el.addEventListener('keypress', stop)
    const release = () => keyboard.reset()
    el.addEventListener('blur', release)

    // Remote desktops (RDP) take the window's size; VNC keeps its own and is scaled. From a phone
    // the size stays a desktop's: the keyboard coming up shouldn't reshape the other screen.
    let resizeTimer = 0
    const observer = new ResizeObserver(() => {
      rescale()
      clearTimeout(resizeTimer)
      if (touchScreen) return
      resizeTimer = window.setTimeout(() => {
        if (device.protocol === 'rdp' && client.getDisplay().getWidth()) client.sendSize(Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr))
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(el)

    const params = new URLSearchParams({
      width: String(touchScreen ? TOUCH_SIZE.width : Math.round(el.clientWidth * dpr)),
      height: String(touchScreen ? TOUCH_SIZE.height : Math.round(el.clientHeight * dpr)),
      dpi: String(touchScreen ? 96 : Math.round(96 * dpr)),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    client.connect(params.toString())

    return () => {
      observer.disconnect()
      cleanups.forEach(f => f())
      clearTimeout(resizeTimer)
      clearTimeout(pasteTimer)
      el.removeEventListener('paste', onPaste)
      el.removeEventListener('keydown', stop)
      el.removeEventListener('keyup', stop)
      el.removeEventListener('keypress', stop)
      el.removeEventListener('blur', release)
      keyboard.onkeydown = null
      keyboard.onkeyup = null
      keyboard.reset()
      client.onstatechange = null
      client.onerror = null
      client.disconnect()
      view.remove()
      clientRef.current = null
    }
    // A new session only for another device, or a retry.
  }, [device.id, attempt])

  useEffect(rescale, [fit, shownRegion?.x, shownRegion?.w])

  const chooseScreen = (value: string) => {
    if (value.startsWith('layout:')) {
      const next = value.slice(7)
      setLayout(next)
      store(`remote.layout.${device.id}`, next)
      setScreen('0')
      store(`remote.screen.${device.id}`, '0')
      return
    }
    setScreen(value)
    store(`remote.screen.${device.id}`, value)
    setAllNotice(value === 'all')
  }

  // The pointer is drawn on the picture only in touchpad mode.
  useEffect(() => {
    if (phase === 'connected') clientRef.current?.getDisplay().showCursor(touchScreen && mode === 'touchpad')
  }, [mode, phase])

  // Typing goes to the screen while its window is in front.
  useEffect(() => {
    if (active && phase === 'connected' && !touchScreen) host.current?.focus({ preventScroll: true })
  }, [active, phase])

  const toggleSwap = () => {
    setSwap(s => {
      try {
        localStorage.setItem(`remote.swap.${device.id}`, s ? '0' : '1')
      } catch {
        // Not remembered; fine.
      }
      return !s
    })
  }

  const chooseMode = (next: TouchMode) => {
    setMode(next)
    try {
      localStorage.setItem('remote.touchMode', next)
    } catch {
      // Not remembered; fine.
    }
  }

  const ctrlAltDel = () => {
    const client = clientRef.current
    if (!client) return
    for (const k of [CTRL_L, ALT_L, DELETE]) client.sendKeyEvent(1, k)
    for (const k of [DELETE, ALT_L, CTRL_L]) client.sendKeyEvent(0, k)
    if (!touchScreen) host.current?.focus()
  }

  // ----- The on-screen keyboard -----
  // A hidden text field brings up the phone's own keyboard. What it types (and what autocorrect
  // changes) is compared with what was there, and sent as backspaces and characters.
  const typed = useRef(SENTINEL)
  const composing = useRef(false)
  const openKeys = () => {
    const field = typing.current
    if (!field) return
    if (keysOpenRef.current && document.activeElement === field) {
      field.blur()
      setKeysOpen(false)
      return
    }
    field.value = SENTINEL
    typed.current = SENTINEL
    field.focus({ preventScroll: true })
    field.setSelectionRange(SENTINEL.length, SENTINEL.length)
    setKeysOpen(true)
  }
  const onTyped = (e: FormEvent<HTMLTextAreaElement>) => {
    const field = e.currentTarget
    const before = typed.current
    const now = field.value
    let same = 0
    while (same < before.length && same < now.length && before[same] === now[same]) same++
    for (let i = same; i < before.length; i++) tapKey(BACKSPACE)
    for (const ch of now.slice(same)) tapKey(charKeysym(ch))
    typed.current = now
    if (!composing.current) {
      field.value = SENTINEL
      typed.current = SENTINEL
    }
  }

  const modifier = (keysym: number) => setHeld(h => (h.includes(keysym) ? h.filter(k => k !== keysym) : [...h, keysym]))
  const extraKeys: { label: string; keysym?: number; mod?: number; wide?: boolean }[] = [
    { label: 'Esc', keysym: ESCAPE },
    { label: 'Tab', keysym: TAB },
    { label: 'Ctrl', mod: CTRL_L },
    { label: 'Alt', mod: ALT_L },
    { label: device.kind === 'mac' ? '⌘' : '⊞', mod: device.kind === 'mac' ? META_L : SUPER_L },
    { label: '←', keysym: 0xff51 },
    { label: '↑', keysym: 0xff52 },
    { label: '↓', keysym: 0xff54 },
    { label: '→', keysym: 0xff53 },
    { label: 'Del', keysym: DELETE },
    { label: 'Home', keysym: 0xff50 },
    { label: 'End', keysym: 0xff57 },
  ]

  const zoomed = zoom > 1
  const Icon = KIND_ICON[device.kind]
  return (
    <div className="rs">
      <div className="rs-bar">
        <span className={`rs-state is-${phase}`}>
          <i />
          {phase === 'connected' ? (size ? `${size.width} × ${size.height}` : tr('Connected')) : phase === 'connecting' ? tr('Connecting…') : tr('Disconnected')}
        </span>
        <span className="tb-spacer" />
        {remoteText !== null && (
          <button
            className="pill-btn is-on"
            onClick={() => {
              void copyText(remoteText)
              setRemoteText(null)
            }}
            title={remoteText.slice(0, 200)}
          >
            <ClipboardCopy size={12} /> {tr('Copy text from {0}', device.name)}
          </button>
        )}
        {phase === 'connected' && touchScreen && (
          <>
            <div className="segmented rs-modes" role="radiogroup" aria-label={tr('Touch input')}>
              <button type="button" role="radio" aria-checked={mode === 'touchpad'} className={mode === 'touchpad' ? 'is-active' : ''} onClick={() => chooseMode('touchpad')} title={tr('Touchpad')}>
                <MousePointer2 size={14} /> <span>{tr('Touchpad')}</span>
              </button>
              <button type="button" role="radio" aria-checked={mode === 'touch'} className={mode === 'touch' ? 'is-active' : ''} onClick={() => chooseMode('touch')} title={tr('Touch')}>
                <Hand size={14} /> <span>{tr('Touch')}</span>
              </button>
            </div>
            <button className="icon-btn" onClick={() => stepZoom(-1)} disabled={!zoomed} aria-label={tr('Zoom out')} title={tr('Zoom out')}>
              <ZoomOut size={15} />
            </button>
            <button className="icon-btn" onClick={() => stepZoom(1)} disabled={zoom >= ZOOMS.at(-1)!} aria-label={tr('Zoom in')} title={tr('Zoom in')}>
              <ZoomIn size={15} />
            </button>
            <button className={`icon-btn ${keysOpen ? 'is-on' : ''}`} onPointerDown={e => e.preventDefault()} onClick={openKeys} aria-label={tr('Keyboard')} title={tr('Keyboard')}>
              <KeyboardIcon size={15} />
            </button>
          </>
        )}
        {phase === 'connected' && size && device.protocol === 'vnc' && (regions.length > 1 || layout !== 'auto') && (
          <label className="rs-screens" title={tr('Which screen to show')}>
            <Monitor size={13} />
            <select value={shownRegion ? String(regions.indexOf(shownRegion)) : regions.length > 1 ? 'all' : '0'} onChange={e => chooseScreen(e.target.value)} aria-label={tr('Which screen to show')}>
              {regions.length > 1 &&
                regions.map((r, i) => (
                  <option key={r.x} value={String(i)}>
                    {tr('Screen {0}', i + 1)} ({r.w} × {size.height})
                  </option>
                ))}
              <option value={regions.length > 1 ? 'all' : '0'}>{regions.length > 1 ? tr('All screens') : tr('One screen')}</option>
              <optgroup label={tr('Screens on {0}', device.name)}>
                <option value="layout:auto">{tr('Find them by size')}</option>
                {[1, 2, 3, 4].map(n => (
                  <option key={n} value={`layout:n${n}`}>
                    {n === 1 ? tr('One screen') : tr('{0} equal screens side by side', n)}
                  </option>
                ))}
                {screenSplits(size.width, size.height)
                  .filter((s, _, all) => new Set(s).size > 1 && s.length === all[0].length)
                  .slice(0, 6)
                  .map(s => (
                    <option key={s.join()} value={`layout:w${s.join(',')}`}>
                      {s.join(' + ')}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
        )}
        {phase === 'connected' && !touchScreen && (
          <>
            {(localIsMac || device.kind === 'mac') && (
              <button className={`pill-btn ${swap ? 'is-on' : ''}`} onClick={toggleSwap} title={tr('Swap the Ctrl and Command keys')}>
                <KeyboardIcon size={12} /> {localIsMac ? '⌘ → Ctrl' : 'Ctrl → ⌘'}
              </button>
            )}
            {device.kind === 'windows' && (
              <button className="pill-btn" onClick={ctrlAltDel}>
                Ctrl+Alt+Del
              </button>
            )}
            <button className="icon-btn" onClick={() => setFit(f => !f)} aria-label={fit ? tr('Actual Size') : tr('Fit to Window')} title={fit ? tr('Actual Size') : tr('Fit to Window')}>
              {fit ? <Expand size={14} /> : <Shrink size={14} />}
            </button>
          </>
        )}
        <button className="icon-btn" onClick={() => setAttempt(a => a + 1)} aria-label={tr('Reconnect')} title={tr('Reconnect')}>
          <RotateCw size={14} />
        </button>
      </div>
      <div
        ref={host}
        className={`rs-view ${fit && !zoomed ? 'is-fit' : ''} ${touchScreen ? `is-touch is-${mode}` : ''}`}
        tabIndex={0}
        onPointerDown={() => !touchScreen && host.current?.focus({ preventScroll: true })}
      >
        <div ref={surface} className="rs-surface">
          <div ref={crop} className="rs-crop" />
        </div>
        {allNotice && phase === 'connected' && (
          <div className="rs-notice">
            <TriangleAlert size={13} />
            <span>{tr('Showing every screen: everything gets smaller, and this browser draws a much bigger picture. The server and the connection carry every screen either way; to lighten them, let the other computer share one screen (see Setup Guide in Devices).')}</span>
            <button className="icon-btn" onClick={() => setAllNotice(false)} aria-label={tr('Close')}>
              <X size={13} />
            </button>
          </div>
        )}
        {phase !== 'connected' && (
          <div className="rs-overlay">
            <span className="rs-device">
              <Icon size={30} />
            </span>
            <strong>{device.name}</strong>
            {phase === 'connecting' && (
              <span className="rs-msg">
                <LoaderCircle size={14} className="spin" /> {tr('Connecting to {0}…', device.host)}
              </span>
            )}
            {phase === 'error' && (
              <span className="rs-msg is-error">
                <TriangleAlert size={14} /> {error}
              </span>
            )}
            {phase === 'closed' && (
              <span className="rs-msg">
                <MonitorOff size={14} /> {tr('The session ended.')}
              </span>
            )}
            {phase !== 'connecting' && (
              <button className="btn btn-primary" onClick={() => setAttempt(a => a + 1)}>
                <RotateCw size={13} /> {tr('Reconnect')}
              </button>
            )}
          </div>
        )}
      </div>
      {touchScreen && phase === 'connected' && keysOpen && (
        <div className="rs-keys" onPointerDown={e => e.preventDefault()}>
          {extraKeys.map(k => (
            <button
              key={k.label}
              type="button"
              className={k.mod && held.includes(k.mod) ? 'is-on' : ''}
              onClick={() => (k.mod ? modifier(k.mod) : k.keysym && tapKey(k.keysym))}
            >
              {k.label}
            </button>
          ))}
          {device.kind === 'windows' && (
            <button type="button" onClick={ctrlAltDel}>
              Ctrl+Alt+Del
            </button>
          )}
        </div>
      )}
      {touchScreen && (
        <textarea
          ref={typing}
          className="rs-typing"
          aria-label={tr('Type on {0}', device.name)}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onInput={onTyped}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={e => {
            composing.current = false
            onTyped(e as unknown as FormEvent<HTMLTextAreaElement>)
          }}
          onKeyDown={e => {
            e.stopPropagation()
            // Keys a phone keyboard sends as keys rather than text.
            const special: Record<string, number> = { Enter: RETURN, Backspace: BACKSPACE, Tab: TAB, Escape: ESCAPE }
            if (e.key in special && e.currentTarget.value === SENTINEL && !composing.current) {
              e.preventDefault()
              tapKey(special[e.key])
            }
          }}
          onBlur={() => setKeysOpen(false)}
        />
      )}
    </div>
  )
}
