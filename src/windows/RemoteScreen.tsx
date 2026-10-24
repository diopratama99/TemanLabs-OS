import { useEffect, useRef, useState } from 'react'
import { ClipboardCopy, Expand, Keyboard as KeyboardIcon, LoaderCircle, MonitorOff, RotateCw, Shrink, TriangleAlert } from 'lucide-react'
// The package's ES build exports the whole Guacamole namespace as its default export.
import Guacamole, { type Client, type Status } from 'guacamole-common-js'
import { api } from '../api'
import type { Device } from '../api/types'
import { copyText } from '../lib/clipboard'
import { tr } from '../lib/i18n'
import { KIND_ICON } from './Devices'

// A device's screen in a window. The server opens the VNC or RDP session (with the saved
// password) through the remote desktop engine and relays it here; this only draws the picture
// and sends keys, clicks and copied text.

type Phase = 'connecting' | 'connected' | 'error' | 'closed'

// X11 keysyms for the modifier keys.
const CTRL_L = 0xffe3
const CTRL_R = 0xffe4
const META_L = 0xffe7
const META_R = 0xffe8
const ALT_L = 0xffe9
const DELETE = 0xffff
const KEY_V = [0x76, 0x56]
// How long to wait for the browser's paste event after Ctrl+V before sending the key anyway.
const PASTE_WAIT_MS = 200
const RESIZE_DEBOUNCE_MS = 300

const localIsMac = /Mac|iPhone|iPad/.test(navigator.platform)

const swapKey = (keysym: number) =>
  keysym === CTRL_L ? META_L : keysym === CTRL_R ? META_R : keysym === META_L ? CTRL_L : keysym === META_R ? CTRL_R : keysym

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
  const clientRef = useRef<Client | null>(null)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [fit, setFit] = useState(true)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [remoteText, setRemoteText] = useState<string | null>(null)
  const [swap, setSwap] = useState(() => readSwap(device))
  const swapRef = useRef(swap)
  swapRef.current = swap
  const fitRef = useRef(fit)
  fitRef.current = fit

  // Scales the picture to the window (or shows it 1:1 with scroll bars).
  const rescale = () => {
    const client = clientRef.current
    const el = host.current
    if (!client || !el) return
    const display = client.getDisplay()
    const w = display.getWidth()
    const h = display.getHeight()
    if (!w || !h) return
    const scale = fitRef.current ? Math.min(el.clientWidth / w, el.clientHeight / h) : 1 / (window.devicePixelRatio || 1)
    display.scale(scale)
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
    mount.appendChild(view)
    let failed = false

    client.onstatechange = state => {
      if (state === Guacamole.Client.State.CONNECTED) {
        setPhase('connected')
        el.focus({ preventScroll: true })
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

    const mouse = new Guacamole.Mouse(view)
    mouse.onEach(['mousedown', 'mousemove', 'mouseup'], e => client.sendMouseState((e as unknown as { state: InstanceType<typeof Guacamole.Mouse.State> }).state, true))
    display.oncursor = (canvas, x, y) => mouse.setCursor(canvas, x, y)

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

    // Remote desktops (RDP) take the window's size; VNC keeps its own and is scaled.
    let resizeTimer = 0
    const observer = new ResizeObserver(() => {
      rescale()
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        if (device.protocol === 'rdp' && client.getDisplay().getWidth()) client.sendSize(Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr))
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(el)

    const params = new URLSearchParams({
      width: String(Math.round(el.clientWidth * dpr)),
      height: String(Math.round(el.clientHeight * dpr)),
      dpi: String(Math.round(96 * dpr)),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    client.connect(params.toString())

    return () => {
      observer.disconnect()
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

  useEffect(rescale, [fit])

  // Typing goes to the screen while its window is in front.
  useEffect(() => {
    if (active && phase === 'connected') host.current?.focus({ preventScroll: true })
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

  const ctrlAltDel = () => {
    const client = clientRef.current
    if (!client) return
    for (const k of [CTRL_L, ALT_L, DELETE]) client.sendKeyEvent(1, k)
    for (const k of [DELETE, ALT_L, CTRL_L]) client.sendKeyEvent(0, k)
    host.current?.focus()
  }

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
        {phase === 'connected' && (
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
      <div ref={host} className={`rs-view ${fit ? 'is-fit' : ''}`} tabIndex={0} onPointerDown={() => host.current?.focus({ preventScroll: true })}>
        <div ref={surface} className="rs-surface" />
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
    </div>
  )
}
