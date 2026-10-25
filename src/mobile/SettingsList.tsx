import { useState } from 'react'
import { ChevronRight, Monitor, Search } from 'lucide-react'
import { tr } from '../lib/i18n'
import { switchShell } from '../lib/shell'
import { GENERAL_LIST, SETTINGS_INFO, SIDEBAR, SectionIcon, type SettingsSection } from '../windows/Settings'

// Sections about the desktop's own look and keys: nothing to set on a phone.
const DESKTOP_ONLY: SettingsSection[] = ['dock', 'menubar', 'wallpaper', 'keyboard']

/** The Settings tab: every section as a list, each opening as a screen of its own. */
export function SettingsList({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const groups = SIDEBAR.map(g => g.filter(id => !DESKTOP_ONLY.includes(id))).filter(g => g.length)
  const all = [...groups.flat(), ...GENERAL_LIST.flat()]
  const matches = q ? all.filter(id => `${SETTINGS_INFO[id].label} ${SETTINGS_INFO[id].keywords}`.toLowerCase().includes(q)) : []
  const row = (id: SettingsSection) => (
    <button key={id} className="m-row" onClick={() => onOpen(id)}>
      <SectionIcon info={SETTINGS_INFO[id]} size={30} />
      <span className="m-row-text">
        <strong>{SETTINGS_INFO[id].label}</strong>
      </span>
      <ChevronRight size={18} className="m-chevron" />
    </button>
  )
  return (
    <div className="m-settings">
      <label className="m-search">
        <Search size={17} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('Search settings')} />
      </label>
      {q ? (
        <section className="m-section">
          <div className="m-list">{matches.map(row)}</div>
          {matches.length === 0 && <p className="m-empty">{tr('No results for “{0}”', query.trim())}</p>}
        </section>
      ) : (
        <>
          {groups.map((group, i) => (
            <section key={i} className="m-section">
              <div className="m-list">{group.map(row)}</div>
            </section>
          ))}
          <section className="m-section">
            <div className="m-list">
              <button className="m-row" onClick={() => switchShell('desktop')}>
                <Monitor size={22} className="m-row-icon" />
                <span className="m-row-text">
                  <strong>{tr('Use the desktop')}</strong>
                  <small>{tr('The full desktop, as on a computer. Its Settings → Appearance brings this back.')}</small>
                </span>
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
