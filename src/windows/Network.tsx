import { useEffect, useState, type ReactNode } from 'react'
import { Activity, ArrowDown, ArrowUp, Cable, ChevronRight, Gauge, Globe, LayoutDashboard, Network as NetworkIcon, Router as RouterIcon, Route, Search, Shield, Timer, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import type { NetInterface, RoutersInfo, SpeedInfo } from '../api/types'
import { useAppMenus } from '../lib/appMenus'
import { formatUptime } from '../lib/format'
import { tr } from '../lib/i18n'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { ConnectionsTab, FirewallTab, InfoTab, LookupTab, ToolTab } from './NetworkTools'
import { InternetCard, Routers } from './Routers'
import { SpeedTest } from './SpeedTest'

// Network: the internet and the home network in one window. An overview, the routers the server
// watches, the speed tests, and the tools (interfaces, ping, traceroute, lookup, connections,
// firewall). Routers and Speed Test were apps of their own; their old names open their sections.

export type NetworkSection = 'overview' | 'routers' | 'speed' | 'interfaces' | 'ping' | 'trace' | 'lookup' | 'connections' | 'firewall'

const GROUPS: { label?: string; items: { id: NetworkSection; label: string; icon: LucideIcon }[] }[] = [
  {
    items: [
      { id: 'overview', label: tr('Overview'), icon: LayoutDashboard },
      { id: 'routers', label: tr('Routers'), icon: RouterIcon },
      { id: 'speed', label: tr('Speed Test'), icon: Gauge },
    ],
  },
  {
    label: tr('Tools'),
    items: [
      { id: 'interfaces', label: tr('Interfaces'), icon: NetworkIcon },
      { id: 'ping', label: tr('Ping'), icon: Activity },
      { id: 'trace', label: tr('Traceroute'), icon: Route },
      { id: 'lookup', label: tr('Lookup'), icon: Search },
      { id: 'connections', label: tr('Connections'), icon: Cable },
      { id: 'firewall', label: tr('Firewall'), icon: Shield },
    ],
  },
]
const SECTIONS = GROUPS.flatMap(g => g.items)
const isSection = (s: string): s is NetworkSection => SECTIONS.some(x => x.id === s)

// The section in front, kept while the window is closed and opened again.
const session = { section: 'overview' as NetworkSection }

export function Network({ request }: { request?: { part: string; nonce: number } | null }) {
  const [section, setSectionState] = useState<NetworkSection>(session.section)
  const setSection = (s: NetworkSection) => {
    session.section = s
    setSectionState(s)
  }
  useEffect(() => {
    if (request && isSection(request.part)) setSection(request.part)
  }, [request])

  useAppMenus(() => [{ label: tr('View'), items: SECTIONS.map(s => ({ label: s.label, icon: s.icon, checked: section === s.id, onSelect: () => setSection(s.id) })) }])

  const tool = (title: string, body: ReactNode) => (
    <div className="pane nu">
      <WindowToolbar>
        <ToolbarTitle title={title} />
      </WindowToolbar>
      {body}
    </div>
  )
  const label = SECTIONS.find(s => s.id === section)?.label ?? ''

  return (
    <div className="split">
      <aside className="sidebar">
        {GROUPS.map((g, i) => (
          <div key={i} className="nw-group">
            {g.label && <div className="sidebar-group">{g.label}</div>}
            {g.items.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`sidebar-item ${section === id ? 'is-active' : ''}`} onClick={() => setSection(id)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <div className="nw-pane">
        {section === 'overview' && <Overview onSection={setSection} />}
        {section === 'routers' && <Routers />}
        {section === 'speed' && <SpeedTest />}
        {section === 'interfaces' && tool(label, <InfoTab />)}
        {section === 'ping' && tool(label, <ToolTab tool="ping" />)}
        {section === 'trace' && tool(label, <ToolTab tool="traceroute" />)}
        {section === 'lookup' && tool(label, <LookupTab />)}
        {section === 'connections' && tool(label, <ConnectionsTab />)}
        {section === 'firewall' && tool(label, <FirewallTab />)}
      </div>
    </div>
  )
}

const mbps = (v: number) => tr('{0} Mbps', v >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 }))
const ago = (iso: string) => {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000
  return sec < 60 ? tr('just now') : tr('{0} ago', formatUptime(sec))
}

/** What's worth a look first: the internet, its speed, the routers and this server's addresses. */
function Overview({ onSection }: { onSection: (s: NetworkSection) => void }) {
  const [routers, setRouters] = useState<RoutersInfo | null>(null)
  const [speed, setSpeed] = useState<SpeedInfo | null>(null)
  const [ifaces, setIfaces] = useState<NetInterface[] | null>(null)
  useEffect(() => {
    const load = () => {
      api.routers().then(setRouters, () => {})
      api.speedTest().then(setSpeed, () => {})
      api.interfaces().then(setIfaces, () => {})
    }
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [])

  const list = routers?.routers ?? []
  const down = list.filter(r => r.status === 'down')
  const last = speed?.last ?? null
  const plan = speed?.config.planDown ?? 0
  const lan = (ifaces ?? []).filter(n => !n.virtual && n.addresses.length && n.name !== 'lo')

  return (
    <div className="dv nw-overview">
      <WindowToolbar>
        <ToolbarTitle title={tr('Network')} subtitle={routers?.gateway ? tr('Gateway {0}', routers.gateway) : undefined} />
      </WindowToolbar>
      <div className="dv-body nw-body">
        {routers && list.length > 0 ? (
          <InternetCard info={routers} />
        ) : (
          <button className="rt-internet is-unknown nw-link" onClick={() => onSection('routers')}>
            <Globe size={20} />
            <span>
              <strong>{tr('Watch the internet')}</strong>
              <small>{tr('Add your modem and routers: the server checks them and the internet every 30 seconds.')}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        )}

        <div className="nw-cards">
          <button className="nw-card" onClick={() => onSection('speed')}>
            <span className="nw-card-head">
              <Gauge size={15} /> {tr('Speed Test')}
              <ChevronRight size={14} />
            </span>
            {last && !last.error ? (
              <>
                <span className="nw-speeds">
                  <span>
                    <ArrowDown size={13} /> <b>{mbps(last.down)}</b>
                  </span>
                  <span>
                    <ArrowUp size={13} /> <b>{mbps(last.up)}</b>
                  </span>
                  <span>
                    <Timer size={13} /> <b>{tr('{0} ms', Math.round(last.ping))}</b>
                  </span>
                </span>
                <small>
                  {ago(last.time)}
                  {plan > 0 ? ` · ${tr('{0}% of the plan', Math.round((last.down / plan) * 100))}` : ''}
                </small>
              </>
            ) : (
              <small>{last?.error ? tr('The last test failed') : tr('No test yet. Run one, or test on a schedule.')}</small>
            )}
          </button>

          <button className="nw-card" onClick={() => onSection('routers')}>
            <span className="nw-card-head">
              <RouterIcon size={15} /> {tr('Routers')}
              <ChevronRight size={14} />
            </span>
            {list.length ? (
              <>
                <span className="nw-routers">
                  {list.slice(0, 4).map(r => (
                    <span key={r.id}>
                      <i className={`nw-dot is-${r.status}`} /> {r.name}
                    </span>
                  ))}
                  {list.length > 4 && <span>{tr('and {0} more', list.length - 4)}</span>}
                </span>
                <small>{down.length ? tr('{0} down: {1}', down.length, down.map(r => r.name).join(', ')) : tr('{0} of {1} answering', list.filter(r => r.status === 'up').length, list.length)}</small>
              </>
            ) : (
              <small>{tr('None added yet.')}</small>
            )}
          </button>

          <button className="nw-card" onClick={() => onSection('interfaces')}>
            <span className="nw-card-head">
              <NetworkIcon size={15} /> {tr('This server')}
              <ChevronRight size={14} />
            </span>
            <span className="nw-addrs">
              {lan.slice(0, 3).map(n => (
                <span key={n.name}>
                  <small>{n.name === 'tailscale0' ? tr('Tailscale') : n.name}</small> {n.addresses.find(a => !a.includes(':'))?.split('/')[0] ?? n.addresses[0].split('/')[0]}
                </span>
              ))}
            </span>
            {!ifaces && <small>…</small>}
          </button>
        </div>
      </div>
    </div>
  )
}
