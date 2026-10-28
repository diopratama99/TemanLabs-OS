import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Cable, CircleCheck, ExternalLink, Globe, LoaderCircle, Network, Pencil, Plug, Plus, Radar, RotateCw, Router as RouterIcon, Trash2, TriangleAlert, Wifi, X, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import type { AppIncident, FoundPlug, FoundRouter, Router, RouterInput, RouterKind, RouterMethod, RouterSearch, RoutersInfo } from '../api/types'
import { Switch } from '../components/Switch'
import { formatFileDate, formatUptime } from '../lib/format'
import { tr } from '../lib/i18n'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

// Routers: the modems, routers and access points the server watches. It checks each every 30
// seconds (and the internet through them), keeps their outages, and restarts one by hand or by
// itself (see server/routers.go). When restarting can't help, it says what to check by hand.

const KINDS: RouterKind[] = ['modem', 'router', 'ap', 'other']
const KIND_ICON: Record<RouterKind, LucideIcon> = { modem: Cable, router: RouterIcon, ap: Wifi, other: Network }
const KIND_LABEL: Record<RouterKind, string> = { modem: tr('Modem'), router: tr('Router'), ap: tr('Access Point'), other: tr('Other') }

const METHODS: { id: RouterMethod; label: string; hint: string }[] = [
  { id: '', label: tr('None'), hint: tr('Only watch it. You restart it yourself.') },
  { id: 'mikrotik', label: 'MikroTik', hint: tr('Signs in over SSH (on by default on MikroTik) and runs /system reboot.') },
  { id: 'ssh', label: tr('SSH (OpenWrt, Linux)'), hint: tr('For OpenWrt, Ubiquiti and other Linux-based routers: signs in over SSH and runs a command.') },
  { id: 'tasmota', label: tr('Tasmota plug'), hint: tr('Works for any router, the ISP’s modem too: its smart plug switches it off, and switches itself back on 10 seconds later.') },
  { id: 'shelly', label: tr('Shelly plug'), hint: tr('Works for any router, the ISP’s modem too: its smart plug switches it off, and switches itself back on 10 seconds later.') },
]

const pct = (n: number) => `${(Math.floor(n * 1000) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
const since = (iso?: string) => (iso ? formatUptime(Math.max(60, (Date.now() - new Date(iso).getTime()) / 1000)) : '')
const adminUrl = (r: Router) => r.adminUrl || `http://${r.host}`

/** Routers in their chains: each one followed by those that connect through it. */
function inOrder(list: Router[]): { router: Router; depth: number }[] {
  const ids = new Set(list.map(r => r.id))
  const out: { router: Router; depth: number }[] = []
  const walk = (parent: string, depth: number) => {
    for (const r of list) {
      if ((r.parent && ids.has(r.parent) ? r.parent : '') === parent && !out.some(o => o.router.id === r.id)) {
        out.push({ router: r, depth })
        walk(r.id, depth + 1)
      }
    }
  }
  walk('', 0)
  return out
}

export function Routers() {
  const [info, setInfo] = useState<RoutersInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ router?: Router; draft: RouterInput } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  // The last search's smart plugs, to pick from when setting up restarting.
  const [plugs, setPlugs] = useState<FoundPlug[] | null>(null)

  const load = useCallback(() => {
    api.routers().then(
      i => {
        setInfo(i)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [load])

  const routers = info?.routers ?? []
  const blank = (): RouterInput => ({
    name: routers.length ? '' : tr('Main Router'),
    host: routers.length ? '' : (info?.gateway ?? ''),
    kind: 'router',
    parent: '',
    adminUrl: '',
    restart: { method: '' },
    autoRestart: false,
  })
  const answering = routers.filter(r => r.status === 'up').length

  return (
    <div className="dv rt">
      <WindowToolbar>
        <ToolbarTitle title={tr('Routers')} subtitle={routers.length > 0 ? tr('{0} of {1} answering', answering, routers.length) : undefined} />
        <span className="tb-spacer" />
        <button className="pill-btn" onClick={() => setFinding(true)}>
          <Radar size={13} /> {tr('Find on Network')}
        </button>
        <button className="pill-btn" onClick={() => setEditing({ draft: blank() })}>
          <Plus size={13} /> {tr('Add Router')}
        </button>
      </WindowToolbar>
      <div className="dv-body">
        {error && (
          <p className="form-error dv-error">
            <TriangleAlert size={13} /> {error}
          </p>
        )}
        {info === null && !error && (
          <div className="dv-empty">
            <LoaderCircle size={20} className="spin" />
          </div>
        )}
        {info && routers.length === 0 && (
          <div className="dv-empty">
            <span className="dv-empty-icon">
              <RouterIcon size={30} />
            </span>
            <h2>{tr('Your routers')}</h2>
            <p>{tr('Add the modem, the router and the access points: the server checks them every 30 seconds, shows when one goes down or the internet drops, and can restart them.')}</p>
            <div className="dv-empty-actions">
              <button className="btn" onClick={() => setEditing({ draft: blank() })}>
                <Plus size={13} /> {tr('Add by Hand')}
              </button>
              <button className="btn btn-primary" onClick={() => setFinding(true)}>
                <Radar size={13} /> {tr('Find on Network')}
              </button>
            </div>
          </div>
        )}
        {info && routers.length > 0 && <InternetCard info={info} />}
        <div className="rt-list">
          {inOrder(routers).map(({ router, depth }) => (
            <RouterCard
              key={router.id}
              router={router}
              depth={depth}
              parent={routers.find(p => p.id === router.parent)}
              internetDown={info?.internet.up === false}
              open={open === router.id}
              onToggle={() => setOpen(o => (o === router.id ? null : router.id))}
              onEdit={() => setEditing({ router, draft: toInput(router) })}
              onChanged={load}
            />
          ))}
        </div>
      </div>
      {editing && (
        <RouterSheet
          router={editing.router}
          initial={editing.draft}
          others={routers.filter(r => r.id !== editing.router?.id)}
          plugs={plugs}
          onPlugs={setPlugs}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
      {finding && (
        <FindSheet
          known={routers}
          onFound={r => setPlugs(r.plugs)}
          onAdded={() => {
            setFinding(false)
            load()
          }}
          onClose={() => setFinding(false)}
        />
      )}
    </div>
  )
}

/** Routers found on the network, to add (with how they connect) in one go. */
function FindSheet({ known, onFound, onAdded, onClose }: { known: Router[]; onFound: (r: RouterSearch) => void; onAdded: () => void; onClose: () => void }) {
  const [found, setFound] = useState<RouterSearch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const run = useRef(0)
  const isKnown = (f: FoundRouter) => known.some(r => r.host === f.host)
  // The list refreshes every 10 seconds; a search runs once (and again on Search Again), so it
  // reads the latest list and callback through refs.
  const latest = useRef({ known, onFound })
  latest.current = { known, onFound }
  const scan = useCallback(() => {
    const id = ++run.current
    setFound(null)
    setError(null)
    api.findRouters().then(
      r => {
        if (id !== run.current) return
        setFound(r)
        latest.current.onFound(r)
        setPicked(new Set(r.routers.filter(f => !latest.current.known.some(k => k.host === f.host)).map(f => f.host)))
      },
      e => id === run.current && setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])
  useEffect(scan, [scan])

  // Nearest the internet first (the server sends them in that order), so each router's parent
  // exists by the time it's added.
  const add = async () => {
    if (!found) return
    setAdding(true)
    setError(null)
    const ids = new Map(known.map(r => [r.host, r.id]))
    try {
      for (const f of found.routers) {
        if (!picked.has(f.host) || ids.has(f.host)) continue
        const { id } = await api.saveRouter({
          name: f.name,
          host: f.host,
          kind: f.kind,
          parent: (f.parent && ids.get(f.parent)) || '',
          adminUrl: '',
          restart: { method: '' },
          autoRestart: false,
        })
        ids.set(f.host, id)
      }
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setAdding(false)
    }
  }

  const toggle = (host: string) =>
    setPicked(p => {
      const next = new Set(p)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  const byHost = new Map(found?.routers.map(f => [f.host, f]))
  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && !adding && onClose()}>
      <div className="sheet ci dv-sheet" role="dialog" aria-label={tr('Find on Network')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{tr('Find on Network')}</strong>
          <span className="tb-spacer" />
          <button className="pill-btn" onClick={scan} disabled={(found === null && !error) || adding}>
            {tr('Search Again')}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body dv-found">
          {found === null && !error && (
            <div className="dv-scanning">
              <Radar size={26} className="dv-radar" />
              <span>{tr('Looking for routers, access points and smart plugs…')}</span>
              <small>{tr('This takes a few seconds.')}</small>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          {found?.routers.length === 0 && <p className="dv-muted">{tr('No routers found. Add yours by hand with its IP address.')}</p>}
          {found?.routers.map(f => {
            const Icon = KIND_ICON[f.kind]
            const added = isKnown(f)
            const via = f.parent ? byHost.get(f.parent)?.name ?? f.parent : ''
            return (
              <label key={f.host} className={`dv-found-row rt-found ${added ? 'is-added' : ''}`}>
                <input type="checkbox" checked={added || picked.has(f.host)} disabled={added || adding} onChange={() => toggle(f.host)} />
                <span className="dv-kind">
                  <Icon size={16} />
                </span>
                <span className="dv-found-name">
                  <strong>
                    {f.name}
                    {f.gateway && <span className="rt-badge">{tr('Gateway')}</span>}
                  </strong>
                  <small>
                    {[KIND_LABEL[f.kind], f.host, via ? tr('through {0}', via) : null].filter(Boolean).join(' · ')}
                  </small>
                  <small className="rt-why">
                    {f.why.map(w => (w.endsWith(' admin page') && f.brand ? tr('{0} admin page', f.brand) : tr(w))).join(' · ')}
                    {f.method ? ` · ${tr('Can restart over SSH: set it up in Edit after adding.')}` : ''}
                  </small>
                </span>
                {added && <small className="dv-muted">{tr('Added')}</small>}
              </label>
            )
          })}
          {!!found?.plugs.length && (
            <>
              <h4 className="dv-subhead">{tr('Smart plugs')}</h4>
              {found.plugs.map(p => (
                <div key={p.host} className="dv-found-row">
                  <span className="dv-kind">
                    <Plug size={16} />
                  </span>
                  <span className="dv-found-name">
                    <strong>{p.name || (p.type === 'tasmota' ? 'Tasmota' : 'Shelly')}</strong>
                    <small>{p.host}</small>
                  </span>
                </div>
              ))}
              <small className="dv-muted">{tr('Pick one when setting up how a router restarts.')}</small>
            </>
          )}
        </div>
        <footer className="ci-foot">
          <p>{tr('Routers that are off don’t show up, nor ones that hide their admin page.')}</p>
          <button className="btn btn-primary" onClick={() => void add()} disabled={!found || adding || ![...picked].some(h => !known.some(r => r.host === h))}>
            {adding ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />} {tr('Add {0}', [...picked].filter(h => !known.some(r => r.host === h)).length)}
          </button>
        </footer>
      </div>
    </div>
  )
}

const toInput = (r: Router): RouterInput => ({
  name: r.name,
  host: r.host,
  kind: r.kind,
  parent: r.parent ?? '',
  adminUrl: r.adminUrl ?? '',
  restart: { ...r.restart, password: '' },
  autoRestart: r.autoRestart,
})

export function InternetCard({ info }: { info: RoutersInfo }) {
  const net = info.internet
  const state = net.up === null ? 'unknown' : net.up ? 'up' : 'down'
  return (
    <div className={`rt-internet is-${state}`}>
      <Globe size={20} />
      <span>
        <strong>{state === 'unknown' ? tr('Checking the internet…') : net.up ? tr('The internet is up') : tr('The internet is down')}</strong>
        <small>
          {[
            net.up && net.latency ? tr('{0} ms', net.latency) : '',
            net.since && state !== 'unknown' ? (net.up ? tr('up for {0}', since(net.since)) : tr('down for {0}', since(net.since))) : '',
            info.gateway ? tr('through {0}', info.gateway) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      <span className="rt-uptime">
        <b>{pct(net.uptime24h)}</b>
        <small>{tr('last 24 hours')}</small>
      </span>
    </div>
  )
}

function RouterCard({
  router: r,
  depth,
  parent,
  internetDown,
  open,
  onToggle,
  onEdit,
  onChanged,
}: {
  router: Router
  depth: number
  parent?: Router
  internetDown: boolean
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onChanged: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const Icon = KIND_ICON[r.kind]
  const noInternet = r.gateway && internetDown && r.status === 'up'
  const trouble = r.status === 'down' || r.status === 'affected' || r.gaveUp || noInternet
  const label =
    r.status === 'unknown'
      ? tr('Checking…')
      : r.status === 'down'
        ? tr('Not answering · {0}', since(r.since))
        : r.status === 'affected'
          ? tr('Unreachable: {0} is down', parent?.name ?? tr('the router before it'))
          : noInternet
            ? tr('Answers, but no internet')
            : r.latency
              ? tr('Up · {0} ms', r.latency)
              : tr('Up')

  const restart = async () => {
    if (!confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    setBusy(true)
    setNote(null)
    try {
      await api.restartRouter(r.id)
      setNote({ text: tr('Restarting. It usually takes 1–3 minutes to come back.') })
      onChanged()
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rt-card is-${noInternet ? 'nonet' : r.status}`} style={{ '--depth': Math.min(depth, 3) } as CSSProperties}>
      <div className="rt-top" onClick={onToggle}>
        <span className="dv-kind">
          <Icon size={20} />
          <i className={`dv-dot is-${r.status === 'up' ? (noInternet ? 'waking' : 'online') : r.status === 'unknown' ? 'checking' : 'offline'}`} />
        </span>
        <span className="dv-card-name">
          <strong>
            {r.name}
            {r.gateway && <span className="rt-badge">{tr('Gateway')}</span>}
          </strong>
          <small>
            {KIND_LABEL[r.kind]} · {r.host}
          </small>
        </span>
        <span className="rt-state">
          {r.restarting ? <LoaderCircle size={12} className="spin" /> : trouble ? <TriangleAlert size={12} /> : null}
          <span>{r.restarting ? tr('Restarting…') : label}</span>
        </span>
        <span className="rt-uptime" title={tr('Up {0} of the last 7 days', pct(r.uptime7d))}>
          <b>{pct(r.uptime24h)}</b>
          <small>{tr('24 h')}</small>
        </span>
        <span className="rt-buttons" onClick={e => e.stopPropagation()}>
          <a className="icon-btn" href={adminUrl(r)} target="_blank" rel="noreferrer" title={tr('Open its admin page')} aria-label={tr('Open its admin page')}>
            <ExternalLink size={14} />
          </a>
          {r.restart.method && (
            <button
              className={`btn ${confirm ? 'btn-danger' : ''}`}
              onClick={() => void restart()}
              onBlur={() => setConfirm(false)}
              disabled={busy || r.restarting}
              title={r.gateway ? tr('This server reaches the internet through it: the internet is gone for a minute or two.') : undefined}
            >
              {busy ? <LoaderCircle size={13} className="spin" /> : <RotateCw size={13} />} {confirm ? tr('Click Again to Restart') : tr('Restart')}
            </button>
          )}
          <button className="icon-btn" onClick={onEdit} title={tr('Edit…')} aria-label={tr('Edit…')}>
            <Pencil size={14} />
          </button>
        </span>
      </div>
      {note && <p className={note.bad ? 'form-error rt-note' : 'form-hint rt-note'}>{note.text}</p>}
      {(open || trouble) && (
        <div className="rt-details">
          {trouble && <CheckByHand router={r} parent={parent} noInternet={noInternet} />}
          {open && <Details router={r} />}
        </div>
      )}
    </div>
  )
}

/** What to look at when restarting can't help (or isn't set up). */
function CheckByHand({ router: r, parent, noInternet }: { router: Router; parent?: Router; noInternet: boolean }) {
  if (r.status === 'affected') {
    return <p className="rt-advice">{tr('It can’t be reached while {0} is down. Start there.', parent?.name ?? tr('the router before it'))}</p>
  }
  const steps = noInternet
    ? [
        tr('Look at the modem’s lights. On a fibre modem a red LOS light (or no PON light) means the line itself is down: only the ISP can fix that.'),
        tr('Restart the modem, then this router, and give them 3 minutes.'),
        tr('Check whether the ISP has an outage in your area (their app, or their customer service).'),
      ]
    : [
        tr('Check it has power: are its lights on?'),
        parent ? tr('Check the cable between it and {0}.', parent.name) : tr('Check the cable from the wall (or the modem) into it.'),
        tr('Switch it off at the wall, wait 10 seconds, switch it on, and give it 2–3 minutes.'),
        tr('Still not back? Its admin page, or the shop or ISP that gave it to you, can tell more.'),
      ]
  return (
    <div className="rt-advice">
      <strong>
        <TriangleAlert size={13} />{' '}
        {r.gaveUp
          ? tr('Restarting didn’t help. Check it by hand:')
          : !r.restart.method || (r.status === 'down' && r.restart.method !== 'tasmota' && r.restart.method !== 'shelly')
            ? tr('Check it by hand:')
            : r.autoRestart
              ? tr('It’s restarted by itself after 3 minutes. If that doesn’t help:')
              : tr('Restart it, or check it by hand:')}
      </strong>
      <ol>
        {steps.map(s => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  )
}

const outageLength = (i: AppIncident) => formatUptime(Math.max(60, ((i.end ? new Date(i.end).getTime() : Date.now()) - new Date(i.start).getTime()) / 1000))

function Details({ router: r }: { router: Router }) {
  const how =
    r.restart.method === 'tasmota' || r.restart.method === 'shelly'
      ? tr('Restarts with its smart plug at {0}.', r.restart.plug ?? '')
      : r.restart.method
        ? tr('Restarts over SSH as {0}.', r.restart.username ?? '')
        : tr('No way to restart it is set up.')
  return (
    <>
      <p className="rt-how">
        {how} {r.restart.method ? (r.autoRestart ? tr('Restarts by itself when it’s down (or the internet is) for 3 minutes, at most twice in a row.') : tr('Restarting by itself is off.')) : ''}
      </p>
      <div className="rt-lists">
        <div>
          <h5>{tr('Outages')}</h5>
          {r.incidents.length === 0 ? (
            <p className="dv-muted">{tr('None in the last 30 days.')}</p>
          ) : (
            r.incidents.slice(0, 6).map(i => (
              <p key={i.start} className="rt-line">
                <span>{formatFileDate(i.start)}</span>
                <small>{i.end ? tr('{0} down', outageLength(i)) : tr('down for {0}', outageLength(i))}</small>
              </p>
            ))
          )}
        </div>
        <div>
          <h5>{tr('Activity')}</h5>
          {r.events.length === 0 ? (
            <p className="dv-muted">{tr('Nothing yet.')}</p>
          ) : (
            r.events.slice(0, 6).map(e => (
              <p key={e.time + e.text} className={`rt-line ${e.bad ? 'is-bad' : ''}`}>
                <span>{tr(e.text)}</span>
                <small>{formatFileDate(e.time)}</small>
              </p>
            ))
          )}
        </div>
      </div>
    </>
  )
}

// ---------- Add / edit ----------

function RouterSheet({
  router,
  initial,
  others,
  plugs,
  onPlugs,
  onClose,
  onSaved,
}: {
  router?: Router
  initial: RouterInput
  others: Router[]
  plugs: FoundPlug[] | null
  onPlugs: (plugs: FoundPlug[]) => void
  onClose: () => void
  onSaved: () => void
}) {
  const [lookingForPlugs, setLookingForPlugs] = useState(false)
  const [d, setD] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ text: string; bad?: boolean } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<RouterInput>) => setD(x => ({ ...x, ...patch }))
  const setRestart = (patch: Partial<RouterInput['restart']>) => setD(x => ({ ...x, restart: { ...x.restart, ...patch } }))
  const method = d.restart.method
  const ssh = method === 'mikrotik' || method === 'ssh'
  const plug = method === 'tasmota' || method === 'shelly'
  const ok = d.name.trim() && d.host.trim()

  const submit = async () => {
    if (!ok) return
    setSaving(true)
    setResult(null)
    try {
      await api.saveRouter(d, router?.id)
      onSaved()
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), bad: true })
      setSaving(false)
    }
  }
  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult({ text: tr((await api.testRouter(router?.id ?? 'new', d)).message) })
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally {
      setTesting(false)
    }
  }
  const remove = async () => {
    if (!router) return
    await api.deleteRouter(router.id)
    onSaved()
  }

  return (
    <div className="sheet-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet ci dv-sheet" role="dialog" aria-label={router ? tr('Edit Router') : tr('Add Router')} onKeyDown={e => e.key === 'Escape' && onClose()}>
        <header className="ci-head">
          <strong>{router ? tr('Edit Router') : tr('Add Router')}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <form
          className="ci-body cm-form dv-form"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="segmented dv-kinds" role="radiogroup" aria-label={tr('Kind')}>
            {KINDS.map(k => {
              const Icon = KIND_ICON[k]
              return (
                <button key={k} type="button" role="radio" aria-checked={d.kind === k} className={d.kind === k ? 'is-active' : ''} onClick={() => set({ kind: k })}>
                  <Icon size={13} /> {KIND_LABEL[k]}
                </button>
              )
            })}
          </div>
          <div className="dv-row">
            <label>
              <span>{tr('Name')}</span>
              <input autoFocus={!router} value={d.name} onChange={e => set({ name: e.target.value })} placeholder={tr('Main Router')} />
            </label>
            <label>
              <span>{tr('IP address')}</span>
              <input value={d.host} onChange={e => set({ host: e.target.value })} placeholder="192.168.1.1" spellCheck={false} />
            </label>
          </div>
          <div className="dv-row">
            <label>
              <span>{tr('Connects through')}</span>
              <select value={d.parent ?? ''} onChange={e => set({ parent: e.target.value })}>
                <option value="">{tr('Nothing: it faces the internet')}</option>
                {others.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.host})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{tr('Admin page (optional)')}</span>
              <input value={d.adminUrl ?? ''} onChange={e => set({ adminUrl: e.target.value })} placeholder={`http://${d.host.trim() || '192.168.1.1'}`} spellCheck={false} />
            </label>
          </div>

          <h4 className="dv-subhead">{tr('Restarting')}</h4>
          <div className="segmented rt-methods" role="radiogroup" aria-label={tr('How to restart it')}>
            {METHODS.map(m => (
              <button
                key={m.id || 'none'}
                type="button"
                role="radio"
                aria-checked={method === m.id}
                className={method === m.id ? 'is-active' : ''}
                onClick={() => {
                  setRestart({ method: m.id, port: m.id === 'mikrotik' || m.id === 'ssh' ? d.restart.port || 22 : undefined, username: m.id === 'mikrotik' ? d.restart.username || 'admin' : m.id === 'ssh' ? d.restart.username || 'root' : d.restart.username })
                  setResult(null)
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <small>{METHODS.find(m => m.id === method)?.hint}</small>

          {ssh && (
            <div className="dv-row">
              <label>
                <span>{tr('User name')}</span>
                <input value={d.restart.username ?? ''} onChange={e => setRestart({ username: e.target.value })} spellCheck={false} autoComplete="off" />
              </label>
              <label>
                <span>{tr('Password')}</span>
                <input
                  type="password"
                  value={d.restart.password ?? ''}
                  onChange={e => setRestart({ password: e.target.value })}
                  placeholder={router?.hasPassword && router.restart.method === method ? tr('Saved (type to change)') : ''}
                  autoComplete="new-password"
                />
              </label>
              <label className="dv-port">
                <span>{tr('Port')}</span>
                <input inputMode="numeric" value={d.restart.port || ''} onChange={e => setRestart({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
              </label>
            </div>
          )}
          {method === 'ssh' && (
            <label>
              <span>{tr('Restart command')}</span>
              <input value={d.restart.command ?? ''} onChange={e => setRestart({ command: e.target.value })} placeholder="reboot" spellCheck={false} />
            </label>
          )}
          {plug && (
            <div className="dv-row">
              <label>
                <span>{tr('Smart plug’s IP address')}</span>
                <input value={d.restart.plug ?? ''} onChange={e => setRestart({ plug: e.target.value })} placeholder="192.168.1.40" spellCheck={false} />
              </label>
              <label>
                <span>{tr('Plug password (if it has one)')}</span>
                <input
                  type="password"
                  value={d.restart.password ?? ''}
                  onChange={e => setRestart({ password: e.target.value })}
                  placeholder={router?.hasPassword && router.restart.method === method ? tr('Saved (type to change)') : ''}
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          {plug && (
            <div className="rt-plugs">
              {plugs?.filter(p => p.type === method).map(p => (
                <button key={p.host} type="button" className={`pill-btn ${d.restart.plug === p.host ? 'is-on' : ''}`} onClick={() => setRestart({ plug: p.host })}>
                  <Plug size={12} /> {p.name || p.host} · {p.host}
                </button>
              ))}
              {plugs !== null && !plugs.some(p => p.type === method) && <small className="dv-muted">{tr('No {0} plug found on the network.', method === 'tasmota' ? 'Tasmota' : 'Shelly')}</small>}
              {plugs === null && (
                <button
                  type="button"
                  className="pill-btn"
                  disabled={lookingForPlugs}
                  onClick={() => {
                    setLookingForPlugs(true)
                    api.findRouters().then(
                      r => onPlugs(r.plugs),
                      () => onPlugs([]),
                    ).finally(() => setLookingForPlugs(false))
                  }}
                >
                  {lookingForPlugs ? <LoaderCircle size={12} className="spin" /> : <Radar size={12} />} {tr('Find Plugs on the Network')}
                </button>
              )}
            </div>
          )}
          {plug && <small>{tr('Plug the router into it. Put the plug on a different Wi-Fi than this router’s if you can: then it can still be reached when the router hangs.')}</small>}
          {method && (
            <>
              <div className="rt-test">
                <button type="button" className="btn" onClick={() => void test()} disabled={testing || !d.host.trim()}>
                  {testing ? <LoaderCircle size={13} className="spin" /> : <CircleCheck size={13} />} {tr('Test Without Restarting')}
                </button>
                {result && <span className={result.bad ? 'form-error' : 'form-hint'}>{result.text}</span>}
              </div>
              <div className="group du-startup">
                <span>
                  {tr('Restart by itself')}
                  <small>{tr('When it stops answering, or the internet drops, for 3 minutes. At most twice in a row; if that doesn’t help, it’s left for you to check.')}</small>
                </span>
                <Switch checked={d.autoRestart} onChange={on => set({ autoRestart: on })} label={tr('Restart by itself')} />
              </div>
            </>
          )}
          {!method && result && <p className="form-error">{result.text}</p>}
          <small>{tr('Passwords stay on the server; this browser never gets them back.')}</small>
          <button type="submit" hidden />
        </form>
        <footer className="ci-foot">
          {router && (
            <button className={`btn ${confirmDelete ? 'btn-danger' : ''}`} onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)}>
              <Trash2 size={13} /> {confirmDelete ? tr('Click Again to Remove') : tr('Remove')}
            </button>
          )}
          <span className="tb-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={!ok || saving}>
            {saving ? <LoaderCircle size={13} className="spin" /> : null} {router ? tr('Save') : tr('Add')}
          </button>
        </footer>
      </div>
    </div>
  )
}
