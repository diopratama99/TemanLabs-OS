import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight, CircleCheck, Folder, HardDrive, LoaderCircle, RotateCw, Thermometer, TriangleAlert, Usb } from 'lucide-react'
import { api } from '../api'
import type { BlockDevice, DiskUsage } from '../api/types'
import { useAppMenus } from '../lib/appMenus'
import { formatBytes } from '../lib/format'
import { displayName, joinPath, parentOf } from '../lib/paths'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'

type Tab = 'info' | 'usage'

/** A drive's SMART verdict: failing, wearing (bad sectors), or fine. */
function health(d: BlockDevice): { level: 'ok' | 'warn' | 'bad' | 'unknown'; text: string } {
  const s = d.smart
  if (!s || s.passed === undefined) return { level: 'unknown', text: s?.error ?? 'No health data' }
  if (!s.passed) return { level: 'bad', text: 'Failing: back up and replace this drive' }
  if ((s.reallocated ?? 0) > 0 || (s.pending ?? 0) > 0)
    return { level: 'warn', text: `Wearing: ${s.reallocated ?? 0} reallocated, ${s.pending ?? 0} pending sectors. Keep backups.` }
  if ((s.wearPercent ?? 0) >= 80) return { level: 'warn', text: `${s.wearPercent}% of its rated writes used` }
  return { level: 'ok', text: 'Healthy' }
}

const isVolume = (d: BlockDevice) => !!d.fstype && d.fstype !== 'LVM2_member' && d.fstype !== 'swap'
const volumeName = (v: BlockDevice) => v.label || v.mountpoints?.[0] || v.name

/** Disk Manager: drives, partitions, health, mounting, and what takes up space. */
export function DiskManager() {
  const [disks, setDisks] = useState<BlockDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await api.disks()
      setDisks(list)
      setError(null)
      setSelected(s => s ?? list[0]?.path ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const all = (disks ?? []).flatMap(d => [d, ...(d.children ?? []).flatMap(c => [c, ...(c.children ?? [])])])
  const item = all.find(d => d.path === selected) ?? null
  const disk = (disks ?? []).find(d => d.path === selected || (d.children ?? []).some(c => c.path === selected || (c.children ?? []).some(g => g.path === selected))) ?? null
  const mount = item?.mountpoints?.[0]

  const toggleMount = async () => {
    if (!item) return
    setBusy(true)
    setNote(null)
    try {
      const res = await api.mountDisk(item.path, !mount)
      setNote(res.message || (mount ? 'Unmounted.' : 'Mounted.'))
      await refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useAppMenus(() => [
    {
      label: 'View',
      items: [
        { label: 'Info', checked: tab === 'info', onSelect: () => setTab('info') },
        { label: 'Space Usage', checked: tab === 'usage', onSelect: () => setTab('usage') },
        'separator',
        { label: 'Refresh', icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
  ])

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-group">Drives</div>
        {(disks ?? []).map(d => {
          const h = health(d)
          const Icon = d.tran === 'usb' || d.rm ? Usb : HardDrive
          return (
            <div key={d.path}>
              <button className={`sidebar-item ${selected === d.path ? 'is-active' : ''}`} onClick={() => setSelected(d.path)}>
                <Icon size={15} /> <span className="du-side-name">{d.model || d.name}</span>
                {h.level !== 'ok' && h.level !== 'unknown' && <TriangleAlert size={12} className={`du-warn is-${h.level}`} />}
              </button>
              {(d.children ?? [])
                .flatMap(c => (isVolume(c) ? [c] : (c.children ?? []).filter(isVolume)))
                .map(v => (
                  <button key={v.path} className={`sidebar-item du-volume ${selected === v.path ? 'is-active' : ''}`} onClick={() => setSelected(v.path)}>
                    <Folder size={13} /> <span className="du-side-name">{volumeName(v)}</span>
                  </button>
                ))}
            </div>
          )
        })}
        {error && <p className="form-error">{error}</p>}
      </aside>

      <div className="pane du">
        <WindowToolbar>
          <ToolbarTitle
            title={item ? (item === disk ? disk.model || disk.name : volumeName(item)) : 'Disk Manager'}
            subtitle={item ? `${formatBytes(item.size)} ${item.fstype ? item.fstype.toUpperCase() : item.tran?.toUpperCase() ?? ''}` : undefined}
          />
          <span className="tb-spacer" />
          <div className="tb-segmented">
            <button className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')}>
              Info
            </button>
            <button className={tab === 'usage' ? 'is-active' : ''} onClick={() => setTab('usage')} disabled={!mount && !disk}>
              Space Usage
            </button>
          </div>
          <div className="tb-group">
            <button className="tb-btn" onClick={() => void refresh()} aria-label="Refresh" title="Refresh">
              <RotateCw size={14} />
            </button>
          </div>
        </WindowToolbar>

        {!item ? (
          <p className="am-empty">{disks ? 'Select a drive.' : 'Reading drives…'}</p>
        ) : tab === 'usage' ? (
          <UsageView start={mount ?? disk?.children?.flatMap(c => c.mountpoints ?? [])[0] ?? '/'} />
        ) : (
          <>
            {item.fstype && (
              <div className="du-capacity">
                <div className="du-bar">
                  <i style={{ width: `${item.size ? ((item.fsused ?? 0) / ((item.fsused ?? 0) + (item.fsavail ?? 0) || 1)) * 100 : 0}%` }} />
                </div>
                <div className="du-legend">
                  <span>
                    <i className="is-used" /> Used <strong>{formatBytes(item.fsused ?? 0)}</strong>
                  </span>
                  <span>
                    <i /> Free <strong>{formatBytes(item.fsavail ?? 0)}</strong>
                  </span>
                  <span>
                    Capacity <strong>{formatBytes(item.size)}</strong>
                  </span>
                </div>
              </div>
            )}

            <div className="group du-info">
              {item === disk ? (
                <>
                  <Row label="Model" value={disk.model} />
                  <Row label="Serial number" value={disk.serial} />
                  <Row label="Connection" value={disk.tran?.toUpperCase()} />
                  <Row label="Type" value={disk.rota ? 'Hard disk (spinning)' : 'Solid-state'} />
                  <Row label="Device" value={disk.path} />
                </>
              ) : (
                <>
                  <Row label="Mounted at" value={mount ?? 'Not mounted'} />
                  <Row label="File system" value={item.fstype?.toUpperCase()} />
                  <Row label="Label" value={item.label} />
                  <Row label="UUID" value={item.uuid} />
                  <Row label="Device" value={item.path} />
                </>
              )}
            </div>

            {disk?.smart && (
              <>
                <h4 className="du-heading">Health (S.M.A.R.T.)</h4>
                <div className={`group du-health is-${health(disk).level}`}>
                  <div className="du-verdict">
                    {health(disk).level === 'ok' ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
                    <strong>{health(disk).text}</strong>
                  </div>
                  {disk.smart.temperature ? (
                    <Row label="Temperature" value={`${disk.smart.temperature} °C`} icon={<Thermometer size={13} />} />
                  ) : null}
                  {disk.smart.powerOnHours !== undefined && (
                    <Row label="Powered on" value={`${disk.smart.powerOnHours.toLocaleString()} hours (${Math.round(disk.smart.powerOnHours / 24 / 365 * 10) / 10} years)`} />
                  )}
                  {disk.smart.powerCycles !== undefined && <Row label="Power cycles" value={disk.smart.powerCycles.toLocaleString()} />}
                  {disk.smart.wearPercent !== undefined && <Row label="Wear" value={`${disk.smart.wearPercent}% of rated life used`} />}
                  {disk.smart.reallocated !== undefined && <Row label="Reallocated sectors" value={String(disk.smart.reallocated)} />}
                  {disk.smart.pending !== undefined && <Row label="Pending sectors" value={String(disk.smart.pending)} />}
                </div>
              </>
            )}

            {item !== disk && item.fstype && (
              <div className="du-actions">
                {note && <span className="form-hint">{note}</span>}
                <button className="btn" onClick={() => void toggleMount()} disabled={busy || mount === '/' || mount === '/boot' || mount === '/boot/efi'}>
                  {busy ? <LoaderCircle size={13} className="spin" /> : null} {mount ? 'Unmount' : 'Mount'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, icon }: { label: string; value?: string | null; icon?: ReactNode }) {
  if (!value) return null
  return (
    <div className="row">
      <span>
        {icon} {label}
      </span>
      <span className="row-value">{value}</span>
    </div>
  )
}

/** What takes the space on a volume, folder by folder (like ncdu), largest first. */
function UsageView({ start }: { start: string }) {
  const [path, setPath] = useState(start)
  const [usage, setUsage] = useState<DiskUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (p: string, fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      setUsage(await api.diskUsage(p, fresh))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPath(start)
  }, [start])
  useEffect(() => {
    void load(path)
  }, [path, load])

  const max = usage?.entries[0]?.size || 1
  return (
    <div className="du-usage">
      <div className="du-usage-head">
        <button className="icon-btn" onClick={() => setPath(parentOf(path))} disabled={path === '/' || path === start} aria-label="Up">
          <ArrowLeft size={14} />
        </button>
        <strong>{displayName(path) || path}</strong>
        <small>{path}</small>
        <span className="media-spacer" />
        {usage && <span className="du-total">{formatBytes(usage.total)}</span>}
        <button className="icon-btn" onClick={() => void load(path, true)} aria-label="Rescan" title="Rescan">
          <RotateCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading && !usage && (
        <p className="am-empty">
          <LoaderCircle size={14} className="spin" /> Measuring folders… big disks take a little while.
        </p>
      )}
      {usage?.partial && <p className="form-hint">Still counting when time ran out; sizes are at least this much.</p>}
      <div className={`du-usage-list ${loading ? 'is-loading' : ''}`}>
        {usage?.entries.map(e => (
          <button
            key={e.name}
            className="du-usage-row"
            disabled={!e.isDir}
            onClick={() => e.isDir && setPath(joinPath(path, e.name))}
            title={e.isDir ? `Open ${e.name}` : undefined}
          >
            <span className="du-usage-name">
              <Folder size={14} /> {e.name}
            </span>
            <span className="du-usage-bar">
              <i style={{ width: `${Math.max(1, (e.size / max) * 100)}%` }} />
            </span>
            <span className="du-usage-size">{formatBytes(e.size)}</span>
            {e.isDir ? <ChevronRight size={13} /> : <span style={{ width: 13 }} />}
          </button>
        ))}
      </div>
    </div>
  )
}
