import { useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { tr } from '../lib/i18n'

const POLL_MS = 3000
const LINES = 400

interface Props {
  title: string
  /** What the logs belong to (a container ID, a service); null when nothing is selected. */
  source: string | null
  load: (source: string, lines: number) => Promise<string>
  emptyText: string
  onClose: () => void
}

/** Bottom pane of System Monitor showing the latest log lines, refreshed while Live is on. */
export function LogsPane({ title, source, load, emptyText, onClose }: Props) {
  const [logs, setLogs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const body = useRef<HTMLPreElement>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!source) return
    let alive = true
    const fetchLogs = async () => {
      try {
        const text = await loadRef.current(source, LINES)
        if (!alive) return
        setLogs(text)
        setError(null)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    }
    setLogs('')
    void fetchLogs()
    const timer = follow ? setInterval(fetchLogs, POLL_MS) : 0
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [source, follow])

  useEffect(() => {
    const el = body.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [logs, follow])

  return (
    <div className="am-logs">
      <div className="am-logs-head">
        <strong>{title}</strong>
        <label className="am-follow">
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> {tr('Live')}
        </label>
        <button className="icon-btn" onClick={() => void copyText(logs)} aria-label={tr('Copy logs')} title={tr('Copy logs')} disabled={!logs}>
          <Copy size={13} />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label={tr('Close logs')} title={tr('Close')}>
          ×
        </button>
      </div>
      <pre className="am-logs-body" ref={body}>
        {!source ? emptyText : error ? `Couldn’t read logs: ${error}` : logs || 'No log output.'}
      </pre>
    </div>
  )
}
