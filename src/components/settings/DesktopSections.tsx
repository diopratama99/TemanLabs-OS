import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { ALT, MOD, SHIFT } from '../../lib/platform'
import { ACCENT_COLORS, DEFAULT_MENU_BAR, supportsRefraction, useSettings, type DockMagnification, type MenuBarPrefs, type Theme } from '../../lib/settings'
import { language, LANGUAGES, tr } from '../../lib/i18n'
import { SHELL, switchShell } from '../../lib/shell'
import { QUICK_SEARCH_SHORTCUT } from '../MenuBar'
import { PopUpButton } from '../PopUpButton'
import { Switch } from '../Switch'

// Settings for the desktop itself: how it looks, the Dock, the menu bar, language, keys. These
// are kept in this browser.

/** A row with a label (and a note under it) and a control on the right. */
export function SettingRow({ label, note, children }: { label: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      <span>
        {label}
        {note && <small>{note}</small>}
      </span>
      {children}
    </div>
  )
}

function Toggle({ label, note, checked, onChange, disabled }: { label: string; note?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <SettingRow label={label} note={note}>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </SettingRow>
  )
}

export function GroupTitle({ children }: { children: ReactNode }) {
  return <h4 className="set-group-title">{children}</h4>
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: tr('Light') },
  { id: 'dark', label: tr('Dark') },
]

export function AppearanceSection() {
  const { settings, update } = useSettings()
  return (
    <>
      <div className="group">
        <SettingRow label={tr('Appearance')}>
          <div className="theme-picker">
            {THEMES.map(t => (
              <button key={t.id} className={`theme-option ${settings.theme === t.id ? 'is-active' : ''}`} onClick={() => update({ theme: t.id })}>
                <span className={`theme-preview theme-preview-${t.id}`} />
                {t.label}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={tr('Accent colour')} note={tr('Buttons, selections and switches.')}>
          <div className="accent-picker" role="radiogroup" aria-label={tr('Accent colour')}>
            {ACCENT_COLORS.map(c => (
              <button
                key={c.id}
                role="radio"
                aria-checked={settings.accent === c.id}
                aria-label={c.label}
                title={c.label}
                className={`accent-swatch ${settings.accent === c.id ? 'is-active' : ''}`}
                style={{ background: c.swatch }}
                onClick={() => update({ accent: c.id })}
              >
                {settings.accent === c.id && <Check size={11} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>
      <div className="group">
        <Toggle
          label={tr('Lens refraction')}
          note={supportsRefraction ? tr('Bends the wallpaper behind glass surfaces.') : tr('Needs a Chromium-based browser (Chrome, Edge, Brave).')}
          checked={settings.refraction && supportsRefraction}
          disabled={!supportsRefraction}
          onChange={v => update({ refraction: v })}
        />
      </div>
      <div className="group">
        <SettingRow
          label={tr('Layout')}
          note={SHELL === 'mobile' ? tr('This browser has the phone layout: screens and tabs.') : tr('A phone gets its own layout, with screens and tabs; this switches it on for this browser too.')}
        >
          <button className="btn" onClick={() => switchShell(SHELL === 'mobile' ? 'desktop' : 'mobile')}>
            {SHELL === 'mobile' ? tr('Use the Desktop') : tr('Use the Phone Layout')}
          </button>
        </SettingRow>
      </div>
    </>
  )
}

export function AccessibilitySection() {
  const { settings, update } = useSettings()
  return (
    <div className="group">
      <Toggle
        label={tr('Reduce motion')}
        note={tr('Windows, the Dock and panels appear without animating.')}
        checked={settings.reduceMotion}
        onChange={v => update({ reduceMotion: v })}
      />
      <Toggle
        label={tr('Reduce transparency')}
        note={tr('Replaces glass with solid surfaces. Helps on slower devices.')}
        checked={settings.reduceTransparency}
        onChange={v => update({ reduceTransparency: v })}
      />
    </div>
  )
}

const MAGNIFICATION: { id: DockMagnification; label: string }[] = [
  { id: 'off', label: tr('Off') },
  { id: 'small', label: tr('Small') },
  { id: 'medium', label: tr('Medium') },
  { id: 'large', label: tr('Large') },
]

export function DockSection({ onEditWidgets }: { onEditWidgets: () => void }) {
  const { settings, update } = useSettings()
  const [confirmReset, setConfirmReset] = useState(false)
  const hidden = settings.hiddenApps.length
  return (
    <>
      <GroupTitle>{tr('Dock')}</GroupTitle>
      <div className="group">
        <SettingRow label={tr('Magnification')} note={tr('How much icons grow under the pointer.')}>
          <div className="segmented set-segmented" role="radiogroup" aria-label={tr('Magnification')}>
            {MAGNIFICATION.map(m => (
              <button key={m.id} role="radio" aria-checked={settings.dockMagnification === m.id} className={settings.dockMagnification === m.id ? 'is-active' : ''} onClick={() => update({ dockMagnification: m.id })}>
                {m.label}
              </button>
            ))}
          </div>
        </SettingRow>
        <Toggle
          label={tr('Automatically hide and show the Dock')}
          note={tr('It slides away, and comes back when the pointer reaches the bottom of the screen.')}
          checked={settings.dockAutohide}
          onChange={v => update({ dockAutohide: v })}
        />
        <SettingRow label={tr('Dock apps')} note={tr('Back to the built-in apps and the apps that are running.')}>
          <button
            className={`btn ${confirmReset ? 'btn-danger' : ''}`}
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true)
              update({ dockApps: null, dockSystem: null })
              setConfirmReset(false)
            }}
            onBlur={() => setConfirmReset(false)}
          >
            {confirmReset ? tr('Click Again to Reset') : tr('Reset Dock')}
          </button>
        </SettingRow>
      </div>

      <GroupTitle>{tr('Desktop')}</GroupTitle>
      <div className="group">
        <Toggle label={tr('Desktop widgets')} note={tr('Clock, CPU, memory, storage, network, notes and more on the desktop.')} checked={settings.showWidgets} onChange={v => update({ showWidgets: v })} />
        <SettingRow label={tr('Widgets')} note={tr('Add, remove and rearrange them.')}>
          <button className="btn" onClick={onEditWidgets} disabled={!settings.showWidgets}>
            {tr('Edit Widgets…')}
          </button>
        </SettingRow>
        <Toggle label={tr('Show the data drive on the desktop')} checked={settings.showDesktopDrive} onChange={v => update({ showDesktopDrive: v })} />
      </div>

      <GroupTitle>{tr('Launcher')}</GroupTitle>
      <div className="group">
        <SettingRow label={tr('Hidden apps')} note={hidden ? tr('{0} apps are hidden from the Launcher.', hidden) : tr('No apps are hidden.')}>
          <button className="btn" onClick={() => update({ hiddenApps: [] })} disabled={!hidden}>
            {tr('Show All')}
          </button>
        </SettingRow>
      </div>
    </>
  )
}

export function MenuBarSection() {
  const { settings, update } = useSettings()
  const bar = settings.menuBar ?? DEFAULT_MENU_BAR
  const set = (patch: Partial<MenuBarPrefs>) => update(s => ({ menuBar: { ...(s.menuBar ?? DEFAULT_MENU_BAR), ...patch } }))
  return (
    <>
      <GroupTitle>{tr('Shown in the menu bar')}</GroupTitle>
      <div className="group">
        <Toggle label={tr('Local IP address')} checked={bar.lanIp} onChange={v => set({ lanIp: v })} />
        <Toggle label={tr('Tailscale IP address')} checked={bar.tailscaleIp} onChange={v => set({ tailscaleIp: v })} />
        <Toggle label={tr('Processor usage')} checked={bar.cpu} onChange={v => set({ cpu: v })} />
        <Toggle label={tr('Power draw')} note={tr('On servers that report it.')} checked={bar.power} onChange={v => set({ power: v })} />
        <Toggle label={tr('Network')} checked={bar.network} onChange={v => set({ network: v })} />
        <Toggle label={tr('My Devices')} note={tr('Wake or connect to your other computers from the menu bar.')} checked={bar.devices} onChange={v => set({ devices: v })} />
      </div>
      <ClockGroup />
    </>
  )
}

/** The menu bar clock: shared by Menu Bar and Language & Region. */
export function ClockGroup() {
  const { settings, update } = useSettings()
  const bar = settings.menuBar ?? DEFAULT_MENU_BAR
  const set = (patch: Partial<MenuBarPrefs>) => update(s => ({ menuBar: { ...(s.menuBar ?? DEFAULT_MENU_BAR), ...patch } }))
  return (
    <>
      <GroupTitle>{tr('Clock')}</GroupTitle>
      <div className="group">
        <Toggle label={tr('Show the date')} checked={bar.date} onChange={v => set({ date: v })} />
        <Toggle label={tr('Show seconds')} checked={bar.seconds} onChange={v => set({ seconds: v })} />
        <Toggle label={tr('24-hour time')} checked={!bar.hour12} onChange={v => set({ hour12: !v })} />
      </div>
    </>
  )
}

export function LanguageSection() {
  const { update } = useSettings()
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const locale = language === 'id' ? 'id-ID' : 'en-GB'
  return (
    <>
      <div className="group">
        <SettingRow label={tr('Language')} note={tr('The interface language. Changing it reloads the page.')}>
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
        </SettingRow>
        <SettingRow label={tr('Date format')}>
          <span className="value">{now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </SettingRow>
        <SettingRow label={tr('Numbers')}>
          <span className="value">{(1234567.89).toLocaleString(locale)}</span>
        </SettingRow>
      </div>
      <ClockGroup />
    </>
  )
}

/** Shortcuts that exist in the apps (each comes from a menu item or a viewer's own keys). */
export function KeyboardSection() {
  const groups: { title: string; keys: [string, string][] }[] = [
    { title: tr('Desktop'), keys: [[QUICK_SEARCH_SHORTCUT, tr('Quick Search')], ['Esc', tr('Close a menu, panel or sheet')]] },
    {
      title: tr('Files'),
      keys: [
        [`${MOD}C`, tr('Copy')],
        [`${MOD}X`, tr('Cut')],
        [`${MOD}V`, tr('Paste')],
        [`${MOD}D`, tr('Duplicate')],
        [`${MOD}A`, tr('Select All')],
      ],
    },
    {
      title: tr('Code'),
      keys: [
        [`${MOD}S`, tr('Save')],
        [`${MOD}O`, tr('Open File…')],
        [`${MOD}P`, tr('Go to File…')],
        [`${MOD}F`, tr('Find')],
        [`${MOD}H`, tr('Replace')],
        [`${MOD}${SHIFT}F`, tr('Find in Files')],
        [`${MOD}${SHIFT}P`, tr('Command Palette…')],
        [`${MOD}B`, tr('Toggle Sidebar')],
        [`${MOD}\``, tr('Toggle Terminal')],
        [`${MOD}/`, tr('Toggle Line Comment')],
        [`${SHIFT}${ALT}F`, tr('Format Document')],
      ],
    },
    {
      title: tr('Video Player'),
      keys: [
        [tr('Space'), tr('Play or pause')],
        ['← →', tr('Back or forward 5 seconds')],
        ['J L', tr('Back or forward 10 seconds')],
        ['↑ ↓', tr('Volume')],
        ['M', tr('Mute')],
        ['F', tr('Full screen')],
      ],
    },
    {
      title: tr('Image Viewer'),
      keys: [
        ['← →', tr('Previous or next image')],
        ['+ −', tr('Zoom in or out')],
        ['0', tr('Fit to the window')],
      ],
    },
  ]
  return (
    <>
      {groups.map(g => (
        <div key={g.title}>
          <GroupTitle>{g.title}</GroupTitle>
          <div className="group">
            {g.keys.map(([key, what]) => (
              <SettingRow key={what} label={what}>
                <kbd className="set-kbd">{key}</kbd>
              </SettingRow>
            ))}
          </div>
        </div>
      ))}
      <p className="pane-note">{tr('Shortcuts also appear next to their commands in each app’s menus.')}</p>
    </>
  )
}
