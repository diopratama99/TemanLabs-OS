import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Clock, Info, KeyRound, LoaderCircle, Palette, Server, Users, type LucideIcon } from 'lucide-react'
import { api, MOCK_MODE } from '../api'
import type { Job, ReleaseStatus, SystemStats } from '../api/types'
import { Switch } from '../components/Switch'
import { WallpaperPicker } from '../components/Wallpaper'
import { useAppMenus } from '../lib/appMenus'
import { useAuth } from '../lib/auth'
import { formatBytes, formatUptime } from '../lib/format'
import { supportsRefraction, useSettings, type Theme } from '../lib/settings'
import { LogoTile } from '../components/Logo'
import { DateTimeSection } from '../components/settings/DateTimeSection'
import { UsersSection } from '../components/settings/UsersSection'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { language, LANGUAGES, tr } from '../lib/i18n'
import { PopUpButton } from '../components/PopUpButton'

export type SettingsSection = 'general' | 'appearance' | 'users' | 'datetime' | 'account' | 'about'
type Section = SettingsSection

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: tr('General'), icon: Server },
  { id: 'appearance', label: tr('Appearance'), icon: Palette },
  { id: 'users', label: tr('Users & Groups'), icon: Users },
  { id: 'datetime', label: tr('Date & Time'), icon: Clock },
  { id: 'account', label: tr('Account'), icon: KeyRound },
  { id: 'about', label: tr('About'), icon: Info },
]

const MIN_PASSWORD = 8

function AccountSection() {
  const { hostname, signOut } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, setPending] = useState(false)

  const mismatch = confirm !== '' && next !== confirm
  const canSubmit = current !== '' && next.length >= MIN_PASSWORD && next === confirm && !pending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setMessage(null)
    try {
      await api.changePassword(current, next)
      setMessage({ ok: true, text: tr('Password changed. Other signed-in browsers were signed out.') })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : tr('Could not change the password.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="group">
        <div className="row">
          <span>
            {tr('Signed in to')} {hostname || tr('this server')}
            <small>{tr('Sessions last 30 days, or until you sign out.')}</small>
          </span>
          <button className="btn" onClick={() => void signOut()}>
            {tr('Sign Out')}
          </button>
        </div>
      </div>
      <form className="group password-form" onSubmit={submit}>
        <div className="row">
          <span>{tr('Current password')}</span>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <div className="row">
          <span>
            {tr('New password')}
            <small>{tr('At least')} {MIN_PASSWORD} {tr('characters.')}</small>
          </span>
          <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
        </div>
        <div className="row">
          <span>{tr('Confirm new password')}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            aria-invalid={mismatch}
          />
        </div>
        <div className="row">
          <span className={message ? (message.ok ? 'form-ok' : 'form-error') : 'form-hint'}>
            {message?.text ?? (mismatch ? tr('The new passwords don’t match.') : '')}
          </span>
          <button className="btn btn-primary" type="submit" disabled={!canSubmit || MOCK_MODE}>
            {tr('Change Password')}
          </button>
        </div>
      </form>
    </>
  )
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: tr('Light') },
  { id: 'dark', label: tr('Dark') },
]

interface Props {
  stats: SystemStats | null
  section: Section
  onSectionChange: (section: Section) => void
}

export function Settings({ stats, section, onSectionChange: setSection }: Props) {
  const { settings, update } = useSettings()
  const current = SECTIONS.find(s => s.id === section)!

  useAppMenus(() => [
    {
      label: tr('View'),
      items: SECTIONS.map(({ id, label, icon }) => ({
        label,
        icon,
        checked: id === section,
        onSelect: () => setSection(id),
      })),
    },
  ])

  return (
    <div className="split">
      <aside className="sidebar">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`sidebar-item ${id === section ? 'is-active' : ''}`}
            onClick={() => setSection(id)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </aside>

      <div className="pane">
        <WindowToolbar>
          <ToolbarTitle title={current.label} />
        </WindowToolbar>
        <h3 className="pane-title">{current.label}</h3>

        {section === 'general' && (
          <div className="group">
            <Row label={tr('Hostname')} value={stats?.hostname} />
            <Row label={tr('Operating system')} value={stats?.os} />
            <Row label={tr('Kernel')} value={stats?.kernel} />
            <Row
              label={tr('Local IP')}
              value={stats?.addresses.lan && `${stats.addresses.lan.ipv4} (${stats.addresses.lan.interface})`}
            />
            <Row
              label={tr('Tailscale')}
              value={stats && (stats.addresses.tailscale ? stats.addresses.tailscale.ipv4 : 'Not connected')}
            />
            <Row label={tr('Processor')} value={stats && `${stats.cpu.model} · ${stats.cpu.cores} cores`} />
            <Row label={tr('Memory')} value={stats && formatBytes(stats.memory.total, 0)} />
            <Row label={tr('Uptime')} value={stats && formatUptime(stats.uptime)} />
          </div>
        )}

        {section === 'appearance' && (
          <>
            <div className="group">
              <div className="row">
                <span>{tr('Appearance')}</span>
                <div className="theme-picker">
                  {THEMES.map(t => (
                    <button
                      key={t.id}
                      className={`theme-option ${settings.theme === t.id ? 'is-active' : ''}`}
                      onClick={() => update({ theme: t.id })}
                    >
                      <span className={`theme-preview theme-preview-${t.id}`} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="row">
                <span>
                  {tr('Language')}
                  <small className="row-hint">{tr('The interface language. Changing it reloads the page.')}</small>
                </span>
                <PopUpButton
                  className="lang-picker"
                  value={language}
                  aria-label={tr('Language')}
                  options={LANGUAGES.map(l => ({ value: l.id, label: l.label }))}
                  onChange={next => {
                    if (next === language) return
                    update({ language: next })
                    // Labels are translated when modules load, so a new language needs a fresh page.
                    window.setTimeout(() => location.reload(), 150)
                  }}
                />
              </div>
            </div>
            <WallpaperPicker />
            <div className="group">
              <div className="row">
                <span>
                  {tr('Desktop widgets')}
                  <small>{tr('Clock, CPU, memory, storage, network and apps on the desktop.')}</small>
                </span>
                <Switch
                  label={tr('Desktop widgets')}
                  checked={settings.showWidgets}
                  onChange={v => update({ showWidgets: v })}
                />
              </div>
              <div className="row">
                <span>
                  {tr('Reduce transparency')}
                  <small>{tr('Replaces glass with solid surfaces. Helps on slower devices.')}</small>
                </span>
                <Switch
                  label={tr('Reduce transparency')}
                  checked={settings.reduceTransparency}
                  onChange={v => update({ reduceTransparency: v })}
                />
              </div>
              <div className="row">
                <span>
                  {tr('Lens refraction')}
                  <small>
                    {supportsRefraction
                      ? tr('Bends the wallpaper behind glass surfaces.')
                      : tr('Needs a Chromium-based browser (Chrome, Edge, Brave).')}
                  </small>
                </span>
                <Switch
                  label={tr('Lens refraction')}
                  checked={settings.refraction && supportsRefraction}
                  disabled={!supportsRefraction}
                  onChange={v => update({ refraction: v })}
                />
              </div>
            </div>
          </>
        )}

        {section === 'users' && <UsersSection />}
        {section === 'datetime' && <DateTimeSection />}
        {section === 'account' && <AccountSection />}

        {section === 'about' && (
          <div className="about">
            <LogoTile size={72} />
            <h2>{tr('TemanLabsOS')}</h2>
            <p>{tr('Web desktop for your home server')}</p>
            <AboutUpdate />
            <p className="about-dim">
              {MOCK_MODE
                ? tr('Running on mock data (npm run dev:mock).')
                : (stats?.os ?? '')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span className="value">{value ?? '–'}</span>
    </div>
  )
}

/** Version and self-update from GitHub releases. */
function AboutUpdate() {
  const [status, setStatus] = useState<ReleaseStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const check = useCallback(async (refresh = false) => {
    setChecking(true)
    try {
      setStatus(await api.releaseStatus(refresh))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }, [])
  useEffect(() => {
    void check()
  }, [check])

  // Follow the update, then wait for the restarted server and reload into the new version.
  const running = !!job?.running
  useEffect(() => {
    if (!job) return
    const timer = setInterval(async () => {
      if (running) {
        const next = await api.job('self-update').catch(() => null)
        if (next) {
          setJob(next)
          if (!next.running && next.exit === 0) setRestarting(true)
        } else setRestarting(true)
        return
      }
      if (restarting) {
        const back = await api.releaseStatus().catch(() => null)
        if (back && back.current !== status?.current) location.reload()
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [job, running, restarting, status?.current])

  const install = async () => {
    setError(null)
    try {
      await api.installRelease()
      setJob(await api.job('self-update'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="about-update">
      <p className="about-version">
        {tr('Version')} <b>{status?.current ?? '…'}</b>
      </p>
      {restarting ? (
        <p className="about-dim">
          <LoaderCircle size={13} className="spin" /> {tr('Restarting into')} {status?.latest}…
        </p>
      ) : job ? (
        <pre className="su-log about-log">{job.log.join('\n')}</pre>
      ) : status?.available ? (
        <div className="about-new">
          <strong>{status.latest} {tr('is available')}</strong>
          {status.notes && <pre>{status.notes.slice(0, 600)}</pre>}
          <button className="btn btn-primary" onClick={() => void install()}>
            {tr('Update to')} {status.latest}
          </button>
        </div>
      ) : (
        <p className="about-dim">
          {status?.error ? tr('Updates: {0}.', status.error) : status?.latest ? tr('TemanLabsOS is up to date.') : ''}{' '}
          <button className="pill-btn" onClick={() => void check(true)} disabled={checking}>
            {checking ? <LoaderCircle size={12} className="spin" /> : null} {tr('Check for Updates')}
          </button>
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
