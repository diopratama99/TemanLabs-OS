import { useEffect, useState } from 'react'
import { BookMarked } from 'lucide-react'
import { tr } from '../lib/i18n'
import { Commands } from './Commands'
import { Terminal } from './Terminal'

// Whether the Commands panel is open, kept while the window is closed and opened again.
const session = { commands: false }

interface Props {
  onTitle: (title: string) => void
  input: { text: string; nonce: number } | null
  /** Puts a command on the prompt (see App's runInTerminal). */
  onRun: (command: string) => void
  /** { part: 'commands' } opens the Commands panel (Commands' old name). */
  request?: { part: string; nonce: number } | null
}

/** The Terminal window: the shell, and the book of commands beside it when wanted. */
export function TerminalWindow({ onTitle, input, onRun, request }: Props) {
  const [commands, setCommandsState] = useState(session.commands)
  const setCommands = (open: boolean) => {
    session.commands = open
    setCommandsState(open)
  }
  useEffect(() => {
    if (request?.part === 'commands') setCommands(true)
  }, [request])

  return (
    <div className={`terminal-window ${commands ? 'has-commands' : ''}`}>
      <Terminal onTitle={onTitle} input={input} onFindCommand={() => setCommands(!commands)} />
      {commands ? (
        <Commands onRun={onRun} onClose={() => setCommands(false)} />
      ) : (
        <button className="terminal-commands-btn" onClick={() => setCommands(true)} title={tr('Commands')} aria-label={tr('Commands')}>
          <BookMarked size={14} />
        </button>
      )}
    </div>
  )
}
