import { useState, type FormEvent } from 'react'
import { Clock, Info, KeyRound, Palette, Server, Users, type LucideIcon } from 'lucide-react'
import { api, MOCK_MODE } from '../api'
import type { SystemStats } from '../api/types'
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

export type SettingsSection = 'general' | 'appearance' | 'users' | 'datetime' | 'account' | 'about'
type Section = SettingsSection

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: Server },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'users', label: 'Users & Groups', icon: Users },
  { id: 'datetime', label: 'Date & Time', icon: Clock },
  { id: 'account', label: 'Account', icon: KeyRound },
  { id: 'about', label: 'About', icon: Info },
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
      setMessage({ ok: true, text: 'Password changed. Other signed-in browsers were signed out.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not change the password.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="group">
        <div className="row">
          <span>
            Signed in to {hostname || 'this server'}
            <small>Sessions last 30 days, or until you sign out.</small>
          </span>
          <button className="btn" onClick={() => void signOut()}>
            Sign Out
          </button>
        </div>
      </div>
      <form className="group password-form" onSubmit={submit}>
        <div className="row">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <div className="row">
          <span>
            New password
            <small>At least {MIN_PASSWORD} characters.</small>
          </span>
          <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
        </div>
        <div className="row">
          <span>Confirm new password</span>
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
            {message?.text ?? (mismatch ? 'The new passwords don’t match.' : '')}
          </span>
          <button className="btn btn-primary" type="submit" disabled={!canSubmit || MOCK_MODE}>
            Change Password
          </button>
        </div>
      </form>
    </>
  )
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
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
      label: 'View',
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
            <Row label="Hostname" value={stats?.hostname} />
            <Row label="Operating system" value={stats?.os} />
            <Row label="Kernel" value={stats?.kernel} />
            <Row
              label="Local IP"
              value={stats?.addresses.lan && `${stats.addresses.lan.ipv4} (${stats.addresses.lan.interface})`}
            />
            <Row
              label="Tailscale"
              value={stats && (stats.addresses.tailscale ? stats.addresses.tailscale.ipv4 : 'Not connected')}
            />
            <Row label="Processor" value={stats && `${stats.cpu.model} · ${stats.cpu.cores} cores`} />
            <Row label="Memory" value={stats && formatBytes(stats.memory.total, 0)} />
            <Row label="Uptime" value={stats && formatUptime(stats.uptime)} />
          </div>
        )}

        {section === 'appearance' && (
          <>
            <div className="group">
              <div className="row">
                <span>Appearance</span>
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
                <span>Wallpaper</span>
                <WallpaperPicker />
              </div>
            </div>
            <div className="group">
              <div className="row">
                <span>
                  Desktop widgets
                  <small>Clock, CPU, memory, storage, network and apps on the desktop.</small>
                </span>
                <Switch
                  label="Desktop widgets"
                  checked={settings.showWidgets}
                  onChange={v => update({ showWidgets: v })}
                />
              </div>
              <div className="row">
                <span>
                  Reduce transparency
                  <small>Replaces glass with solid surfaces. Helps on slower devices.</small>
                </span>
                <Switch
                  label="Reduce transparency"
                  checked={settings.reduceTransparency}
                  onChange={v => update({ reduceTransparency: v })}
                />
              </div>
              <div className="row">
                <span>
                  Lens refraction
                  <small>
                    {supportsRefraction
                      ? 'Bends the wallpaper behind glass surfaces.'
                      : 'Needs a Chromium-based browser (Chrome, Edge, Brave).'}
                  </small>
                </span>
                <Switch
                  label="Lens refraction"
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
            <h2>TemanLabsOS</h2>
            <p>Version 0.1.0 · Web desktop for your home server</p>
            <p className="about-dim">
              {MOCK_MODE
                ? 'Running on mock data (npm run dev:mock).'
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
