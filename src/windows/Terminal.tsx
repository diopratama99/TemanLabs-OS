import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ClipboardPaste, Copy, Eraser, RotateCw } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { MenuItem } from '../components/ContextMenu'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { useSettings } from '../lib/settings'

const THEMES: Record<'light' | 'dark', ITheme> = {
  dark: {
    background: '#00000000',
    foreground: '#e6e6e6',
    cursor: '#5af78e',
    selectionBackground: '#3a5f9a99',
    black: '#1d1f21',
    green: '#5af78e',
    blue: '#57c7ff',
    cyan: '#9aedfe',
    yellow: '#f3f99d',
    red: '#ff5c57',
    magenta: '#ff6ac1',
    white: '#f1f1f0',
  },
  light: {
    background: '#00000000',
    foreground: '#1d1d1f',
    cursor: '#0a7d32',
    selectionBackground: '#0a84ff44',
    black: '#1d1d1f',
    green: '#0a7d32',
    blue: '#0064c8',
    cyan: '#007a8a',
    yellow: '#8a6d00',
    red: '#c41a16',
    magenta: '#a0339f',
    white: '#6e6e73',
  },
}

type Status = 'connecting' | 'open' | 'closed' | 'unavailable'

interface Props {
  /** Register Shell/Edit menus in the menu bar; off when embedded in another app (Code's panel). */
  menus?: boolean
  /** Window title, as terminal apps show it: the shell's title and the size, e.g. "user@host: ~ — 80×24". */
  onTitle?: (title: string) => void
}

/** A real shell on the server: xterm.js bridged to a PTY over the /ws/terminal WebSocket. */
export function Terminal({ menus = true, onTitle }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  // Bumped by Reconnect to tear the session down and open a new one.
  const [session, setSession] = useState(0)
  const { settings } = useSettings()
  const { show } = useContextMenu()
  const titleRef = useRef(onTitle)
  titleRef.current = onTitle

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new XTerm({
      fontFamily: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: THEMES[settings.theme],
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    termRef.current = term
    setStatus('connecting')

    const url = api.terminalUrl(term.cols, term.rows)
    if (!url) {
      term.writeln('The terminal needs the TemanLabsOS server; it is not available in mock mode.')
      setStatus('unavailable')
      return () => term.dispose()
    }

    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    const encoder = new TextEncoder()
    const send = (data: string | Uint8Array<ArrayBuffer>) => socket.readyState === WebSocket.OPEN && socket.send(data)
    const sendResize = () => send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))

    socket.onopen = () => {
      setStatus('open')
      fit.fit()
      sendResize()
      term.focus()
    }
    socket.onmessage = e => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
    socket.onclose = () => {
      setStatus('closed')
      term.writeln('\r\n\x1b[2m[session ended — right-click → Reconnect]\x1b[0m')
    }

    let shellTitle = 'Terminal'
    const showTitle = () => titleRef.current?.(`${shellTitle} — ${term.cols}×${term.rows}`)
    showTitle()
    const subscriptions = [
      term.onData(data => send(encoder.encode(data))),
      term.onBinary(data => send(Uint8Array.from(data, ch => ch.charCodeAt(0)))),
      term.onResize(() => {
        sendResize()
        showTitle()
      }),
      // Bash in Ubuntu sets "user@host: dir" through the xterm title escape on every prompt.
      term.onTitleChange(title => {
        shellTitle = title || 'Terminal'
        showTitle()
      }),
    ]
    const observer = new ResizeObserver(() => {
      // Hidden (minimized) windows have no size; fitting then would collapse the terminal.
      if (host.offsetWidth > 0 && host.offsetHeight > 0) fit.fit()
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      subscriptions.forEach(s => s.dispose())
      socket.close()
      term.dispose()
      termRef.current = null
      socketRef.current = null
    }
    // settings.theme is deliberately not a dependency: the effect below restyles the running
    // terminal instead of restarting the shell.
  }, [session])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[settings.theme]
  }, [settings.theme])

  const paste = () =>
    void navigator.clipboard
      .readText()
      .then(text => {
        termRef.current?.paste(text)
        termRef.current?.focus()
      })
      .catch(() => {})
  const clear = () => termRef.current?.clear()
  const reconnect = () => setSession(s => s + 1)

  const editItems = (): MenuItem[] => {
    const selection = termRef.current?.getSelection() ?? ''
    return [
      { label: 'Copy', icon: Copy, disabled: !selection, onSelect: () => void copyText(selection) },
      { label: 'Paste', icon: ClipboardPaste, disabled: !navigator.clipboard?.readText, onSelect: paste },
    ]
  }
  const shellItems = (): MenuItem[] => [
    { label: 'Clear Scrollback', icon: Eraser, onSelect: clear },
    { label: status === 'open' ? 'Restart Session' : 'Reconnect', icon: RotateCw, onSelect: reconnect },
  ]

  const openMenu = (e: MouseEvent) => show(e, [...editItems(), 'separator', ...shellItems()])

  useAppMenus(
    () => [
      { label: 'Shell', items: shellItems() },
      { label: 'Edit', items: editItems() },
    ],
    menus,
  )

  return (
    <div className={`terminal terminal-${status}`} onContextMenu={openMenu}>
      <div className="terminal-host" ref={hostRef} />
      {status === 'connecting' && <div className="terminal-status">Connecting…</div>}
    </div>
  )
}
