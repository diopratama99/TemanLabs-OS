import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { BookMarked, ClipboardPaste, Copy, Eraser, RotateCw } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { MenuItem } from '../components/ContextMenu'
import { useAppMenus } from '../lib/appMenus'
import { copyText } from '../lib/clipboard'
import { useContextMenu } from '../lib/contextMenu'
import { useSettings } from '../lib/settings'
import { tr } from '../lib/i18n'
import { SHELL } from '../lib/shell'

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
    // Transparent, but white: reverse video (bash highlights pasted text with it) draws the text
    // in the background colour made opaque, which must be light here.
    background: '#ffffff00',
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
  /** Where to connect instead of the server shell, e.g. a shell inside a container. */
  connect?: (cols: number, rows: number) => string | null
  /** A command to put on the prompt (from Commands). It is pasted, never run: Enter is the user's. */
  input?: { text: string; nonce: number } | null
  /** Opens Commands (Shell → Find a Command…). */
  onFindCommand?: () => void
}

// After connecting, text can go in once the shell has drawn its prompt: when its output has been
// quiet this long (or, if it prints nothing, after the fallback).
const PROMPT_QUIET_MS = 250
const PROMPT_FALLBACK_MS = 2500

// A phone's keyboard has none of these; a row of them sits under the terminal there.
const PHONE_KEYS: { label: string; send: string; title?: string }[] = [
  { label: 'Esc', send: '\x1b' },
  { label: 'Tab', send: '\t' },
  { label: '^C', send: '\x03', title: 'Ctrl+C' },
  { label: '←', send: '\x1b[D' },
  { label: '↑', send: '\x1b[A' },
  { label: '↓', send: '\x1b[B' },
  { label: '→', send: '\x1b[C' },
  { label: '|', send: '|' },
  { label: '/', send: '/' },
  { label: '-', send: '-' },
  { label: '~', send: '~' },
]

/** What Ctrl and a key make: Ctrl+C is 0x03, Ctrl+D 0x04… (letters and a few signs only). */
const withCtrl = (data: string) => {
  if (data.length !== 1) return data
  const code = data.toUpperCase().charCodeAt(0)
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data
}

/** A real shell on the server: xterm.js bridged to a PTY over the /ws/terminal WebSocket. */
export function Terminal({ menus = true, onTitle, connect, input, onFindCommand }: Props) {
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
  const connectRef = useRef(connect)
  connectRef.current = connect
  // A command that arrived before the shell was ready.
  const pending = useRef<string | null>(null)
  // On a phone: Ctrl held for the next key typed.
  const [ctrl, setCtrl] = useState(false)
  const ctrlRef = useRef(false)
  ctrlRef.current = ctrl

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

    const url = (connectRef.current ?? api.terminalUrl)(term.cols, term.rows)
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

    // A waiting command goes in once the shell has gone quiet (its prompt is drawn), or after a
    // while if it never says anything.
    let pasteTimer = 0
    const pasteSoon = (ms: number) => {
      if (pending.current === null) return
      clearTimeout(pasteTimer)
      pasteTimer = window.setTimeout(() => {
        if (pending.current === null || socket.readyState !== WebSocket.OPEN) return
        term.paste(pending.current)
        pending.current = null
      }, ms)
    }
    socket.onopen = () => {
      setStatus('open')
      fit.fit()
      sendResize()
      term.focus()
      pasteSoon(PROMPT_FALLBACK_MS)
    }
    socket.onmessage = e => {
      term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
      pasteSoon(PROMPT_QUIET_MS)
    }
    socket.onclose = () => {
      setStatus('closed')
      term.writeln('\r\n\x1b[2m[session ended — right-click → Reconnect]\x1b[0m')
    }

    let shellTitle = 'Terminal'
    const showTitle = () => titleRef.current?.(`${shellTitle} — ${term.cols}×${term.rows}`)
    showTitle()
    const subscriptions = [
      term.onData(data => {
        if (ctrlRef.current) {
          data = withCtrl(data)
          setCtrl(false)
        }
        send(encoder.encode(data))
      }),
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
      clearTimeout(pasteTimer)
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

  // Pasted (bracketed paste when the shell supports it), so even a multi-line command waits for Enter.
  useEffect(() => {
    if (!input) return
    const term = termRef.current
    if (term && socketRef.current?.readyState === WebSocket.OPEN) {
      term.paste(input.text)
      term.focus()
    } else pending.current = input.text
  }, [input?.nonce])

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
      { label: tr('Copy'), icon: Copy, disabled: !selection, onSelect: () => void copyText(selection) },
      { label: tr('Paste'), icon: ClipboardPaste, disabled: !navigator.clipboard?.readText, onSelect: paste },
    ]
  }
  const shellItems = (): MenuItem[] => [
    ...(onFindCommand ? [{ label: tr('Find a Command…'), icon: BookMarked, onSelect: onFindCommand }, 'separator' as const] : []),
    { label: tr('Clear Scrollback'), icon: Eraser, onSelect: clear },
    { label: status === 'open' ? tr('Restart Session') : tr('Reconnect'), icon: RotateCw, onSelect: reconnect },
  ]

  const openMenu = (e: MouseEvent) => show(e, [...editItems(), 'separator', ...shellItems()])

  useAppMenus(
    () => [
      { label: tr('Shell'), items: shellItems() },
      { label: tr('Edit'), items: editItems() },
    ],
    menus,
  )

  const key = (data: string) => {
    termRef.current?.input(data)
    termRef.current?.focus()
  }

  return (
    <div className={`terminal terminal-${status}`} onContextMenu={openMenu}>
      <div className="terminal-host" ref={hostRef} />
      {status === 'connecting' && <div className="terminal-status">{tr('Connecting…')}</div>}
      {SHELL === 'mobile' && (
        // Pressing these keeps the keyboard up: they don't take the focus from the terminal.
        <div className="terminal-keys" onPointerDown={e => e.preventDefault()}>
          <button className={ctrl ? 'is-on' : ''} onClick={() => setCtrl(c => !c)} aria-pressed={ctrl}>
            Ctrl
          </button>
          {PHONE_KEYS.map(k => (
            <button key={k.label} onClick={() => key(k.send)} title={k.title}>
              {k.label}
            </button>
          ))}
          <button onClick={e => openMenu(e)} aria-label={tr('More')}>
            ⋯
          </button>
        </div>
      )}
    </div>
  )
}
