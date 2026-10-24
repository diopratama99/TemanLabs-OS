import { useEffect, useState } from 'react'
import { Clock, Server } from 'lucide-react'
import { api } from '../../api'
import type { TimeInfo } from '../../api/types'
import { Switch } from '../Switch'
import { tr } from '../../lib/i18n'

/** Date & Time plus the server's name: timedatectl and hostnamectl without a terminal. */
export function DateTimeSection() {
  const [info, setInfo] = useState<TimeInfo | null>(null)
  const [hostname, setHostname] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [, tick] = useState(0)

  const load = () =>
    api.timeInfo().then(
      t => {
        setInfo(t)
        setHostname(t.hostname)
      },
      () => {},
    )
  useEffect(() => {
    void load()
    const timer = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const apply = async (change: Parameters<typeof api.setTime>[0], done: string) => {
    setMessage(null)
    try {
      await api.setTime(change)
      setMessage({ ok: true, text: done })
      await load()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  const serverTime = info
    ? new Date().toLocaleString(undefined, { timeZone: info.timezone, dateStyle: 'full', timeStyle: 'medium' })
    : '…'

  return (
    <>
      <div className="group">
        <div className="row">
          <span>
            <Clock size={13} /> {tr('Server time')}
          </span>
          <span className="row-value">{serverTime}</span>
        </div>
        <div className="row">
          <span>{tr('Time zone')}</span>
          <select
            className="ug-input"
            value={info?.timezone ?? ''}
            onChange={e => void apply({ timezone: e.target.value }, `Time zone set to ${e.target.value}.`)}
          >
            {(info?.zones ?? []).map(z => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span>
            {tr('Set time automatically')}
            <small className="row-hint">{info?.synced ? tr('In sync with internet time servers') : tr('Not synchronized yet')}</small>
          </span>
          <Switch checked={!!info?.ntp} onChange={ntp => void apply({ ntp }, ntp ? 'Automatic time is on.' : 'Automatic time is off.')} label="NTP" />
        </div>
      </div>
      <p className="pane-note">{tr('Scheduled tasks and log times use the server’s time zone.')}</p>

      <h4 className="du-heading">{tr('Server name')}</h4>
      <form
        className="group ug-password"
        onSubmit={e => {
          e.preventDefault()
          void apply({ hostname }, `Renamed to ${hostname}. Other devices may show the old name until they refresh.`)
        }}
      >
        <Server size={14} />
        <input value={hostname} onChange={e => setHostname(e.target.value)} spellCheck={false} />
        <button className="btn" disabled={!hostname || hostname === info?.hostname}>
          {tr('Rename')}
        </button>
      </form>
      {message && <p className={message.ok ? 'form-ok' : 'form-error'}>{message.text}</p>}
    </>
  )
}
