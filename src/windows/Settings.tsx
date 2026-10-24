import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Accessibility,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleFadingArrowUp,
  Contrast,
  Globe,
  HardDrive,
  Image,
  Info,
  Keyboard,
  KeyRound,
  Languages,
  Lock,
  LoaderCircle,
  PanelBottom,
  PanelTop,
  Search,
  ShieldCheck,
  Waypoints,
  Settings as SettingsIcon,
  DatabaseBackup,
  LayoutGrid,
  Rocket,
  Share2,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { api, MOCK_MODE } from '../api'
import type { Job, ReleaseStatus, SystemStats, InstalledApp } from '../api/types'
import { WallpaperPicker } from '../components/Wallpaper'
import type { WindowId } from '../components/Window'
import { useAppMenus } from '../lib/appMenus'
import { useAuth } from '../lib/auth'
import { LogoTile } from '../components/Logo'
import { BackupSection } from '../components/settings/BackupSection'
import { AppsSection, type AppActions } from '../components/settings/AppsSection'
import { DateTimeSection } from '../components/settings/DateTimeSection'
import { UsersSection } from '../components/settings/UsersSection'
import {
  AccessibilitySection,
  AppearanceSection,
  ClockGroup,
  DockSection,
  KeyboardSection,
  LanguageSection,
  MenuBarSection,
} from '../components/settings/DesktopSections'
import {
  AdblockSection,
  LockScreenSection,
  NetworkSection,
  PowerSection,
  RemoteAccessSection,
  AboutSection,
  StartupSection,
  SharingSection,
  SignedInBrowsers,
  StorageSection,
} from '../components/settings/ServerSections'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { language, tr } from '../lib/i18n'

export type SettingsSection =
  | 'general'
  | 'about'
  | 'updates'
  | 'storage'
  | 'datetime'
  | 'language'
  | 'sharing'
  | 'startup'
  | 'apps'
  | 'network'
  | 'adblock'
  | 'remote'
  | 'power'
  | 'backup'
  | 'accessibility'
  | 'appearance'
  | 'dock'
  | 'menubar'
  | 'wallpaper'
  | 'lockscreen'
  | 'users'
  | 'account'
  | 'keyboard'
type Section = SettingsSection

interface SectionInfo {
  id: Section
  label: string
  icon: LucideIcon
  /** The icon tile's colours. */
  color: [string, string]
  /** Extra words the sidebar search finds it by. */
  keywords: string
  /** A page under General (shown in the General list, not the sidebar). */
  inGeneral?: true
}

const SECTIONS: SectionInfo[] = [
  { id: 'apps', label: tr('Applications'), icon: LayoutGrid, color: ['#5ac8fa', '#2d55ff'], keywords: 'installed apps containers docker start stop update uninstall' },
  { id: 'network', label: tr('Network'), icon: Globe, color: ['#4fa8ff', '#1a6dff'], keywords: 'ip address tailscale wifi ethernet interface lan' },
  { id: 'adblock', label: tr('Ad Blocking'), icon: ShieldCheck, color: ['#ff7a6b', '#e0352b'], keywords: 'ads adblock dns pihole adguard tracker privacy' },
  { id: 'remote', label: tr('Remote Access'), icon: Waypoints, color: ['#6e8bff', '#3b4fd6'], keywords: 'tailscale vpn anywhere outside phone' },
  { id: 'backup', label: tr('Backup'), icon: DatabaseBackup, color: ['#7ad3a0', '#1f8f5a'], keywords: 'backup restore restic snapshot version recovery copy drive cloud' },
  { id: 'power', label: tr('Power'), icon: Zap, color: ['#5ee07b', '#1fa83c'], keywords: 'watt energy battery restart shut down uptime' },
  { id: 'general', label: tr('General'), icon: SettingsIcon, color: ['#a1a1a8', '#5d5d63'], keywords: 'server' },
  { id: 'accessibility', label: tr('Accessibility'), icon: Accessibility, color: ['#4fa8ff', '#1a6dff'], keywords: 'motion animation transparency' },
  { id: 'appearance', label: tr('Appearance'), icon: Contrast, color: ['#4a4a50', '#1c1c1f'], keywords: 'dark light theme accent colour color glass' },
  { id: 'dock', label: tr('Desktop & Dock'), icon: PanelBottom, color: ['#3a3a40', '#121214'], keywords: 'dock magnification hide widgets launcher desktop icons' },
  { id: 'menubar', label: tr('Menu Bar'), icon: PanelTop, color: ['#8e8e93', '#55555b'], keywords: 'clock seconds date status bar cpu ip' },
  { id: 'wallpaper', label: tr('Wallpaper'), icon: Image, color: ['#5ee0f0', '#1a8fd6'], keywords: 'background photo picture' },
  { id: 'lockscreen', label: tr('Lock Screen'), icon: Lock, color: ['#3a3a40', '#121214'], keywords: 'lock idle inactive password away' },
  { id: 'users', label: tr('Users & Groups'), icon: Users, color: ['#4fa8ff', '#1a6dff'], keywords: 'linux account group sudo' },
  { id: 'account', label: tr('Login & Password'), icon: KeyRound, color: ['#a1a1a8', '#5d5d63'], keywords: 'password sign out session security' },
  { id: 'keyboard', label: tr('Keyboard'), icon: Keyboard, color: ['#a1a1a8', '#5d5d63'], keywords: 'shortcuts keys' },
  // Pages inside General.
  { id: 'about', label: tr('About'), icon: Info, color: ['#a1a1a8', '#5d5d63'], keywords: 'version hostname kernel processor memory', inGeneral: true },
  { id: 'updates', label: tr('Software Update'), icon: CircleFadingArrowUp, color: ['#a1a1a8', '#5d5d63'], keywords: 'update release version upgrade', inGeneral: true },
  { id: 'storage', label: tr('Storage'), icon: HardDrive, color: ['#a1a1a8', '#5d5d63'], keywords: 'disk space usb drive', inGeneral: true },
  { id: 'datetime', label: tr('Date & Time'), icon: CalendarClock, color: ['#4fa8ff', '#1a6dff'], keywords: 'time zone clock ntp hostname', inGeneral: true },
  { id: 'language', label: tr('Language & Region'), icon: Languages, color: ['#4fa8ff', '#1a6dff'], keywords: 'language indonesian english bahasa format', inGeneral: true },
  { id: 'startup', label: tr('Startup Apps'), icon: Rocket, color: ['#a1a1a8', '#5d5d63'], keywords: 'boot start autostart restart policy services', inGeneral: true },
  { id: 'sharing', label: tr('Sharing'), icon: Share2, color: ['#a1a1a8', '#5d5d63'], keywords: 'smb samba share remote desktop', inGeneral: true },
]
const byId = Object.fromEntries(SECTIONS.map(s => [s.id, s])) as Record<Section, SectionInfo>
// The sidebar in groups (separated by a gap), as on a desktop's own settings.
const SIDEBAR: Section[][] = [['network', 'adblock', 'remote', 'backup', 'power', 'apps'], ['general', 'accessibility', 'appearance', 'dock', 'menubar', 'wallpaper'], ['lockscreen', 'users', 'account'], ['keyboard']]
const GENERAL_LIST: Section[][] = [['about', 'updates', 'storage'], ['datetime', 'language', 'startup', 'sharing']]

function SectionIcon({ info, size = 20 }: { info: SectionInfo; size?: number }) {
  const Icon = info.icon
  return (
    <span className="set-icon" style={{ width: size, height: size, background: `linear-gradient(160deg, ${info.color[0]}, ${info.color[1]})` }}>
      <Icon size={Math.round(size * 0.62)} />
    </span>
  )
}

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

interface Props {
  stats: SystemStats | null
  section: Section
  onSectionChange: (section: Section) => void
  onOpenWindow: (id: WindowId) => void
  onPower: (action: 'restart' | 'shutdown') => void
  onEditWidgets: () => void
  /** App image updates waiting (from the App Center). */
  appUpdates: number
  onOpenAppUpdates: () => void
  /** Installed apps, for Settings → Apps, and what can be done with them. */
  apps: InstalledApp[]
  appActions: AppActions
}

export function Settings({ stats, section, onSectionChange, onOpenWindow, onPower, onEditWidgets, appUpdates, onOpenAppUpdates, apps, appActions }: Props) {
  const { hostname, home } = useAuth()
  const [query, setQuery] = useState('')
  const [release, setRelease] = useState<ReleaseStatus | null>(null)
  const current = byId[section] ?? byId.general

  useEffect(() => {
    api.releaseStatus().then(setRelease, () => {})
  }, [section])

  // Back and forward through the pages visited, as in a browser.
  // A page inside a section (an app in Applications, a backup plan), part of the history too.
  const [sub, setSub] = useState<string | null>(null)
  const history = useRef<{ list: { section: Section; sub: string | null }[]; at: number }>({ list: [{ section, sub: null }], at: 0 })
  const walking = useRef(false)
  const [, rerender] = useState(0)
  useEffect(() => {
    const h = history.current
    if (walking.current) {
      walking.current = false
    } else if (h.list[h.at].section !== section) {
      h.list = [...h.list.slice(0, h.at + 1), { section, sub: null }]
      h.at = h.list.length - 1
      setSub(null)
    }
    rerender(n => n + 1)
  }, [section])
  const openSub = (next: string | null) => {
    const h = history.current
    if (h.list[h.at].sub === next) return
    h.list = [...h.list.slice(0, h.at + 1), { section, sub: next }]
    h.at = h.list.length - 1
    setSub(next)
    rerender(n => n + 1)
  }
  const walk = (step: number) => {
    const h = history.current
    const at = h.at + step
    if (at < 0 || at >= h.list.length) return
    h.at = at
    const entry = h.list[at]
    setSub(entry.sub)
    if (entry.section !== section) {
      walking.current = true
      onSectionChange(entry.section)
    } else rerender(n => n + 1)
  }
  // The section already open, from the sidebar: back to its first page.
  const go = (id: Section) => (id === section ? openSub(null) : onSectionChange(id))
  const canBack = history.current.at > 0
  const canForward = history.current.at < history.current.list.length - 1

  useAppMenus(() => [
    {
      label: tr('View'),
      items: [
        { label: tr('Back'), icon: ChevronLeft, disabled: !canBack, onSelect: () => walk(-1) },
        { label: tr('Forward'), icon: ChevronRight, disabled: !canForward, onSelect: () => walk(1) },
        'separator',
        ...SIDEBAR.flat().map(id => ({ label: byId[id].label, icon: byId[id].icon, checked: id === section, onSelect: () => onSectionChange(id) })),
      ],
    },
  ])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => (q ? SECTIONS.filter(s => `${s.label} ${s.keywords}`.toLowerCase().includes(q)) : []), [q])
  const selected = current.inGeneral ? 'general' : current.id
  const user = home?.split('/').filter(Boolean).pop()

  const item = (id: Section) => {
    const info = byId[id]
    return (
      <button key={id} className={`sidebar-item set-item ${selected === id ? 'is-active' : ''}`} onClick={() => go(id)}>
        <SectionIcon info={info} /> {info.label}
      </button>
    )
  }

  return (
    <div className="split">
      <aside className="sidebar set-sidebar">
        <label className="sidebar-search">
          <Search size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Search')} aria-label={tr('Search settings')} />
          {query && (
            <button className="set-search-clear" onClick={() => setQuery('')} aria-label={tr('Clear')}>
              <X size={12} />
            </button>
          )}
        </label>
        {q ? (
          <div className="set-group">
            {matches.map(s => (
              <button
                key={s.id}
                className={`sidebar-item set-item ${section === s.id ? 'is-active' : ''}`}
                onClick={() => {
                  onSectionChange(s.id)
                  setQuery('')
                }}
              >
                <SectionIcon info={s} /> {s.label}
              </button>
            ))}
            {matches.length === 0 && <p className="set-empty">{tr('No results for “{0}”', query.trim())}</p>}
          </div>
        ) : (
          <>
            <button className={`set-account ${section === 'account' ? 'is-active' : ''}`} onClick={() => onSectionChange('account')}>
              <span className="set-avatar">{(user ?? hostname ?? '?').slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{user ?? hostname}</strong>
                <small>{tr('TemanLabsOS on {0}', hostname || tr('this server'))}</small>
              </span>
            </button>
            {release?.available && (
              <button className={`set-update ${section === 'updates' ? 'is-active' : ''}`} onClick={() => onSectionChange('updates')}>
                <span>{tr('Software Update Available')}</span>
                <span className="set-badge">1</span>
              </button>
            )}
            {SIDEBAR.map((group, i) => (
              <div key={i} className="set-group">
                {group.map(item)}
              </div>
            ))}
          </>
        )}
      </aside>

      <div className="pane set-pane">
        <WindowToolbar>
          <div className="tb-group set-nav">
            <button className="tb-btn" onClick={() => walk(-1)} disabled={!canBack} aria-label={tr('Back')} title={tr('Back')}>
              <ChevronLeft size={16} />
            </button>
            <button className="tb-btn" onClick={() => walk(1)} disabled={!canForward} aria-label={tr('Forward')} title={tr('Forward')}>
              <ChevronRight size={16} />
            </button>
          </div>
          <ToolbarTitle title={current.label} />
        </WindowToolbar>

        {section === 'general' ? (
          <>
            <header className="set-hero">
              <SectionIcon info={byId.general} size={56} />
              <h2>{tr('General')}</h2>
              <p>{tr('The server’s overall setup: software updates, storage, date and time, language, sharing and more.')}</p>
            </header>
            {GENERAL_LIST.map((group, i) => (
              <div key={i} className="group set-links">
                {group.map(id => (
                  <button key={id} className="row set-link" onClick={() => go(id)}>
                    <span className="set-link-label">
                      <SectionIcon info={byId[id]} /> {byId[id].label}
                    </span>
                    {id === 'updates' && release?.available ? <span className="set-badge">1</span> : null}
                    <ChevronRight size={15} className="set-chevron" />
                  </button>
                ))}
              </div>
            ))}
          </>
        ) : (
          <h3 className="pane-title">{current.label}</h3>
        )}

        {section === 'about' && <AboutSection stats={stats} version={release?.current} onUpdates={() => onSectionChange('updates')} />}
        {section === 'updates' && (
          <>
            <div className="group set-update-box">
              <LogoTile size={48} />
              <AboutUpdate />
            </div>
            <div className="group">
              <div className="row">
                <span>
                  {tr('App updates')}
                  <small>{appUpdates ? tr('{0} apps have newer images.', appUpdates) : tr('Your apps are up to date.')}</small>
                </span>
                <button className="btn" onClick={onOpenAppUpdates}>
                  {tr('Show in App Center…')}
                </button>
              </div>
            </div>
          </>
        )}
        {section === 'storage' && <StorageSection stats={stats} onOpenWindow={onOpenWindow} />}
        {section === 'datetime' && (
          <>
            <DateTimeSection />
            <ClockGroup />
          </>
        )}
        {section === 'language' && <LanguageSection />}
        {section === 'sharing' && <SharingSection onOpenWindow={onOpenWindow} />}
        {section === 'startup' && <StartupSection />}
        {section === 'network' && <NetworkSection stats={stats} onOpenWindow={onOpenWindow} />}
        {section === 'adblock' && <AdblockSection stats={stats} />}
        {section === 'remote' && <RemoteAccessSection stats={stats} />}
        {section === 'apps' && <AppsSection apps={apps} actions={appActions} sub={sub} onSub={openSub} />}
        {section === 'backup' && <BackupSection sub={sub} onSub={openSub} />}
        {section === 'power' && <PowerSection stats={stats} onPower={onPower} />}
        {section === 'accessibility' && <AccessibilitySection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'dock' && <DockSection onEditWidgets={onEditWidgets} />}
        {section === 'menubar' && <MenuBarSection />}
        {section === 'wallpaper' && <WallpaperPicker />}
        {section === 'users' && <UsersSection />}
        {section === 'lockscreen' && <LockScreenSection />}
        {section === 'account' && (
          <>
            <AccountSection />
            <SignedInBrowsers />
          </>
        )}
        {section === 'keyboard' && <KeyboardSection />}
      </div>
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
        // The result, when it was checked, then the button on its own line.
        <div className="about-check">
          {(status?.error || status?.latest) && (
            <p className="about-dim">{status.error ? tr('Updates: {0}.', status.error) : tr('TemanLabsOS is up to date.')}</p>
          )}
          {status?.checked && !checking && (
            <small className="about-checked">
              {tr('Last checked {0}', new Date(status.checked).toLocaleString(language === 'id' ? 'id-ID' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}
            </small>
          )}
          <button className="pill-btn" onClick={() => void check(true)} disabled={checking}>
            {checking ? <LoaderCircle size={12} className="spin" /> : null} {checking ? tr('Checking…') : tr('Check for Updates')}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
