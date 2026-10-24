import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarClock, Clock, LoaderCircle, Pencil, Play, Plus, Timer, Trash2, User } from 'lucide-react'
import { api } from '../api'
import type { CronTask, Crontab, SystemTimer } from '../api/types'
import { Switch } from '../components/Switch'
import { usePresence } from '../hooks/usePresence'
import { useAppMenus } from '../lib/appMenus'
import { formatFileDate } from '../lib/format'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { tr } from '../lib/i18n'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = (n: string | number) => String(n).padStart(2, '0')
const isNum = (s: string) => /^\d+$/.test(s)

/** Cron schedules in plain words, for the common shapes; anything else is shown as written. */
export function describeSchedule(schedule: string): string {
  const s = schedule.trim()
  const named: Record<string, string> = {
    '@reboot': 'When the server starts',
    '@hourly': 'Every hour',
    '@daily': 'Every day at 00:00',
    '@midnight': 'Every day at 00:00',
    '@weekly': 'Every Sunday at 00:00',
    '@monthly': 'On the 1st of every month',
    '@yearly': 'Every year on 1 January',
    '@annually': 'Every year on 1 January',
  }
  if (named[s]) return named[s]
  const f = s.split(/\s+/)
  if (f.length !== 5) return s
  const [m, h, dom, mon, dow] = f
  const at = isNum(m) && isNum(h) ? `${pad(h)}:${pad(m)}` : null
  if (s === '* * * * *') return 'Every minute'
  if (/^\*\/\d+$/.test(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${m.slice(2)} minutes`
  if (isNum(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `Every hour at :${pad(m)}`
  if (isNum(m) && /^\*\/\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') return `Every ${h.slice(2)} hours at :${pad(m)}`
  if (at && dom === '*' && mon === '*' && dow === '*') return `Every day at ${at}`
  if (at && dom === '*' && mon === '*' && dow === '1-5') return `Weekdays at ${at}`
  if (at && dom === '*' && mon === '*' && isNum(dow)) return `Every ${DAYS[Number(dow) % 7]} at ${at}`
  if (at && isNum(dom) && mon === '*' && dow === '*') return `Every month on day ${dom} at ${at}`
  return s
}

type Preset = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'reboot' | 'custom'

interface Draft {
  preset: Preset
  every: string
  minute: string
  time: string
  day: string
  date: string
  custom: string
}

function draftFrom(schedule: string): Draft {
  const d: Draft = { preset: 'daily', every: '15', minute: '0', time: '03:00', day: '1', date: '1', custom: schedule || '0 3 * * *' }
  const f = schedule.trim().split(/\s+/)
  if (schedule === '@reboot') return { ...d, preset: 'reboot' }
  if (f.length !== 5) return schedule ? { ...d, preset: 'custom' } : d
  const [m, h, dom, mon, dow] = f
  if (/^\*\/\d+$/.test(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return { ...d, preset: 'minutes', every: m.slice(2) }
  if (isNum(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return { ...d, preset: 'hourly', minute: m }
  if (isNum(m) && isNum(h) && mon === '*') {
    const time = `${pad(h)}:${pad(m)}`
    if (dom === '*' && dow === '*') return { ...d, preset: 'daily', time }
    if (dom === '*' && isNum(dow)) return { ...d, preset: 'weekly', time, day: dow }
    if (isNum(dom) && dow === '*') return { ...d, preset: 'monthly', time, date: dom }
  }
  return { ...d, preset: 'custom' }
}

function scheduleFrom(d: Draft): string {
  const [h, m] = d.time.split(':').map(n => String(Number(n) || 0))
  switch (d.preset) {
    case 'minutes':
      return `*/${Math.max(1, Number(d.every) || 1)} * * * *`
    case 'hourly':
      return `${Number(d.minute) || 0} * * * *`
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekly':
      return `${m} ${h} * * ${d.day}`
    case 'monthly':
      return `${m} ${h} ${d.date} * *`
    case 'reboot':
      return '@reboot'
    default:
      return d.custom.trim()
  }
}

/** Scheduled Tasks: cron jobs (with plain-language schedules) and systemd timers. */
export function ScheduledTasks() {
  const [tabs, setTabs] = useState<Crontab[]>([])
  const [timers, setTimers] = useState<SystemTimer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<string>('')
  const [editing, setEditing] = useState<{ user: string; index: number | null; task: CronTask } | null>(null)
  const [output, setOutput] = useState<{ title: string; text: string; running: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.cron()
      setTabs(res.crontabs)
      setTimers(res.timers)
      setSection(s => s || res.crontabs[0]?.user || 'timers')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const tab = tabs.find(t => t.user === section)
  const save = async (next: Crontab) => {
    setError(null)
    try {
      await api.saveCron(next)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }
  const update = (index: number, task: CronTask | null) => {
    if (!tab) return Promise.resolve()
    const tasks = [...tab.tasks]
    if (task) tasks[index] = task
    else tasks.splice(index, 1)
    return save({ ...tab, tasks })
  }
  const run = async (user: string, task: CronTask) => {
    setOutput({ title: task.name || task.command, text: '', running: true })
    try {
      const res = await api.runCron(user, task.command)
      setOutput({ title: task.name || task.command, text: tr("{0}\n\n— finished with exit code {1}", res.output || '(no output)', res.exit), running: false })
    } catch (err) {
      setOutput({ title: task.name || task.command, text: err instanceof Error ? err.message : String(err), running: false })
    }
  }

  useAppMenus(() => [
    {
      label: tr('File'),
      items: [
        {
          label: tr('New Task…'),
          icon: Plus,
          disabled: !tab,
          onSelect: () => tab && setEditing({ user: tab.user, index: null, task: { schedule: '0 3 * * *', command: '', enabled: true } }),
        },
      ],
    },
  ])

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-group">{tr('Tasks of')}</div>
        {tabs.map(t => (
          <button key={t.user} className={`sidebar-item ${section === t.user ? 'is-active' : ''}`} onClick={() => setSection(t.user)}>
            <User size={15} /> {t.user}
            <span className="sidebar-badge">{t.tasks.length}</span>
          </button>
        ))}
        <div className="sidebar-group">{tr('System')}</div>
        <button className={`sidebar-item ${section === 'timers' ? 'is-active' : ''}`} onClick={() => setSection('timers')}>
          <Timer size={15} /> {tr('systemd timers')}
          <span className="sidebar-badge">{timers.length}</span>
        </button>
      </aside>
      <div className="pane st">
        <WindowToolbar>
          <ToolbarTitle title={section === 'timers' ? tr('systemd timers') : tr('Tasks of {0}', section)} subtitle={section === 'timers' ? tr('Read only') : 'cron'} />
          <span className="tb-spacer" />
          {tab && (
            <div className="tb-group">
              <button
                className="tb-btn"
                onClick={() => setEditing({ user: tab.user, index: null, task: { schedule: '0 3 * * *', command: '', enabled: true } })}
                aria-label={tr('New task')}
                title={tr('New Task')}
              >
                <Plus size={17} />
              </button>
            </div>
          )}
        </WindowToolbar>
        {error && <p className="form-error">{error}</p>}

        {tab && (
          <div className="group st-list">
            {tab.tasks.length === 0 && <p className="sh-empty">{tr('No scheduled tasks. Click + to add one.')}</p>}
            {tab.tasks.map((t, i) => (
              <div key={i} className={`st-row ${t.enabled ? '' : 'is-off'}`}>
                <CalendarClock size={20} className="st-icon" />
                <span className="st-main">
                  <strong>{t.name || describeSchedule(t.schedule)}</strong>
                  <small>
                    {t.name ? `${describeSchedule(t.schedule)} · ` : ''}
                    <code>{t.command}</code>
                  </small>
                </span>
                <button className="icon-btn" onClick={() => void run(tab.user, t)} title={tr('Run now')} aria-label={tr('Run now')}>
                  <Play size={14} />
                </button>
                <button className="icon-btn" onClick={() => setEditing({ user: tab.user, index: i, task: t })} title={tr('Edit')} aria-label={tr('Edit')}>
                  <Pencil size={14} />
                </button>
                <Switch checked={t.enabled} onChange={enabled => void update(i, { ...t, enabled })} label={tr('Enabled')} />
              </div>
            ))}
          </div>
        )}

        {section === 'timers' && (
          <div className="group st-list">
            {timers.map(t => (
              <div key={t.unit} className="st-row">
                <Clock size={20} className="st-icon" />
                <span className="st-main">
                  <strong>{t.unit.replace(/\.timer$/, '')}</strong>
                  <small>{tr('runs')} {t.activates}</small>
                </span>
                <span className="st-when">
                  <small>{tr('Next:')} {t.next ? formatFileDate(new Date(t.next).toISOString()) : '—'}</small>
                  <small>{tr('Last:')} {t.last ? formatFileDate(new Date(t.last).toISOString()) : 'never'}</small>
                </span>
              </div>
            ))}
          </div>
        )}

        {output && (
          <div className="su-job">
            <div className="su-job-head">
              {output.running ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
              <strong>{output.title}</strong>
              <button className="icon-btn" onClick={() => setOutput(null)} aria-label={tr('Close output')}>
                ×
              </button>
            </div>
            <pre className="su-log">{output.running ? 'Running…' : output.text}</pre>
          </div>
        )}

        <TaskSheet
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={async task => {
            if (!editing) return
            const t = tabs.find(x => x.user === editing.user)
            if (!t) return
            const tasks = [...t.tasks]
            if (editing.index === null) tasks.push(task)
            else tasks[editing.index] = task
            await save({ ...t, tasks })
            setEditing(null)
          }}
          onDelete={async () => {
            if (!editing || editing.index === null) return
            await update(editing.index, null)
            setEditing(null)
          }}
        />
      </div>
    </div>
  )
}

function TaskSheet({
  editing,
  onClose,
  onSave,
  onDelete,
}: {
  editing: { user: string; index: number | null; task: CronTask } | null
  onClose: () => void
  onSave: (task: CronTask) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const { mounted, closing } = usePresence(!!editing, 220)
  const [last, setLast] = useState(editing)
  if (editing && editing !== last) setLast(editing)
  if (!mounted || !last) return null
  return <TaskForm key={`${last.user}-${last.index}`} closing={closing} editing={last} onClose={onClose} onSave={onSave} onDelete={onDelete} />
}

function TaskForm({
  closing,
  editing,
  onClose,
  onSave,
  onDelete,
}: {
  closing: boolean
  editing: { user: string; index: number | null; task: CronTask }
  onClose: () => void
  onSave: (task: CronTask) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(editing.task.name ?? '')
  const [command, setCommand] = useState(editing.task.command)
  const [draft, setDraft] = useState(() => draftFrom(editing.task.schedule))
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p }))
  const schedule = scheduleFrom(draft)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await onSave({ name: name.trim() || undefined, command: command.trim(), schedule, enabled: editing.task.enabled })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className={`sheet-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <form className="sheet sh-sheet ci" onSubmit={e => void submit(e)}>
        <header className="ci-head">
          <strong>{editing.index === null ? tr('New Scheduled Task') : tr('Edit Task')}</strong>
          <small className="form-hint">{tr('runs as')} {editing.user}</small>
        </header>
        <div className="ci-body">
          <label className="ci-field">
            <span className="ci-label">{tr('Name')}</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={tr('e.g. Nightly backup')} />
          </label>
          <label className="ci-field">
            <span className="ci-label">{tr('Command')}</span>
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder="/home/user/backup.sh >> /home/user/backup.log 2>&1" spellCheck={false} autoFocus />
            <small>{tr('Runs in a plain shell; give full paths. Add')} {tr('>> file.log 2>&1')} {tr('to keep its output.')}</small>
          </label>
          <div className="ci-field">
            <span className="ci-label">{tr('When')}</span>
            <div className="st-when-row">
              <select value={draft.preset} onChange={e => set({ preset: e.target.value as Preset })}>
                <option value="minutes">{tr('Every few minutes')}</option>
                <option value="hourly">{tr('Every hour')}</option>
                <option value="daily">{tr('Every day')}</option>
                <option value="weekly">{tr('Every week')}</option>
                <option value="monthly">{tr('Every month')}</option>
                <option value="reboot">{tr('When the server starts')}</option>
                <option value="custom">{tr('Custom (cron)')}</option>
              </select>
              {draft.preset === 'minutes' && (
                <label className="st-inline">
                  {tr('every')} <input value={draft.every} onChange={e => set({ every: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /> {tr('minutes')}
                </label>
              )}
              {draft.preset === 'hourly' && (
                <label className="st-inline">
                  {tr('at minute')} <input value={draft.minute} onChange={e => set({ minute: e.target.value.replace(/\D/g, '') })} inputMode="numeric" />
                </label>
              )}
              {draft.preset === 'weekly' && (
                <select value={draft.day} onChange={e => set({ day: e.target.value })} aria-label={tr('Day')}>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {draft.preset === 'monthly' && (
                <label className="st-inline">
                  {tr('on day')} <input value={draft.date} onChange={e => set({ date: e.target.value.replace(/\D/g, '') })} inputMode="numeric" />
                </label>
              )}
              {(draft.preset === 'daily' || draft.preset === 'weekly' || draft.preset === 'monthly') && (
                <input type="time" value={draft.time} onChange={e => set({ time: e.target.value })} aria-label={tr('Time')} />
              )}
              {draft.preset === 'custom' && (
                <input value={draft.custom} onChange={e => set({ custom: e.target.value })} placeholder={tr('m h dom mon dow')} spellCheck={false} />
              )}
            </div>
            <small>
              {describeSchedule(schedule)} · <code>{schedule}</code> {tr('(server time)')}
            </small>
          </div>
        </div>
        <footer className="ci-foot">
          {error ? <p className="form-error">{error}</p> : <p className="form-hint" />}
          {editing.index !== null && (
            <button
              type="button"
              className={`btn ${confirmDelete ? 'btn-danger' : ''}`}
              onClick={() => (confirmDelete ? void onDelete() : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              <Trash2 size={13} /> {confirmDelete ? tr('Click Again to Delete') : tr('Delete')}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!command.trim()}>
            {tr('Save')}
          </button>
        </footer>
      </form>
    </div>
  )
}
