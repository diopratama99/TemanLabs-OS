import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  Cloud,
  ExternalLink,
  Combine,
  Database,
  DatabaseZap,
  Eraser,
  Folder,
  HardDrive,
  LoaderCircle,
  Plus,
  Power,
  RotateCw,
  Thermometer,
  Trash2,
  TriangleAlert,
  Usb,
  X,
} from 'lucide-react'
import { api } from '../api'
import type { BlockDevice, CloudInfo, CloudProvider, DiskUsage, FormatFS, Job, StorageInfo, ZfsInfo } from '../api/types'
import { Switch } from '../components/Switch'
import { usePresence } from '../hooks/usePresence'
import { useAppMenus } from '../lib/appMenus'
import { formatBytes } from '../lib/format'
import { displayName, joinPath, parentOf } from '../lib/paths'
import { ToolbarTitle, WindowToolbar } from '../lib/windowChrome'
import { tr } from '../lib/i18n'
import { poolKey, poolLevel, ZFS_IMPORT, ZfsImportPane, ZfsPoolPane } from './ZfsPanes'

type Tab = 'info' | 'usage'

/** A drive's SMART verdict: failing, wearing (bad sectors), or fine. */
function health(d: BlockDevice): { level: 'ok' | 'warn' | 'bad' | 'unknown'; text: string } {
  const s = d.smart
  if (!s || s.passed === undefined) return { level: 'unknown', text: s?.error ?? tr('No health data') }
  if (!s.passed) return { level: 'bad', text: tr('Failing: back up and replace this drive') }
  if ((s.reallocated ?? 0) > 0 || (s.pending ?? 0) > 0)
    return { level: 'warn', text: tr('Wearing: {0} reallocated, {1} pending sectors. Keep backups.', s.reallocated ?? 0, s.pending ?? 0) }
  if ((s.wearPercent ?? 0) >= 80) return { level: 'warn', text: tr('{0}% of its rated writes used', s.wearPercent) }
  return { level: 'ok', text: tr('Healthy') }
}

// A ZFS pool's drives are shown as the pool, under ZFS Pools.
const isVolume = (d: BlockDevice) => !!d.fstype && d.fstype !== 'LVM2_member' && d.fstype !== 'swap' && d.fstype !== 'zfs_member'
/** The ZFS pool a drive (or one of its partitions) belongs to. */
const zfsPoolOf = (d: BlockDevice): string | undefined =>
  d.fstype === 'zfs_member' ? d.label || '?' : (d.children ?? []).map(zfsPoolOf).find(Boolean)
const SYSTEM_MOUNTS = ['/', '/boot', '/boot/efi', '[SWAP]']
const MERGED = 'storage:merged'
const CLOUD = 'storage:cloud'

/** Why a drive or partition can't be erased (mounted, holds the system, LVM…), or null. */
function eraseBlocker(d: BlockDevice): string | null {
  const walk = (x: BlockDevice): string | null => {
    const m = x.mountpoints?.find(Boolean)
    if (m) return SYSTEM_MOUNTS.includes(m) ? `${x.name} holds the system` : `${x.name} is mounted at ${m}; unmount it first`
    if (x.fstype === 'LVM2_member') return `${x.name} is part of an LVM volume group`
    if (x.fstype === 'linux_raid_member') return `${x.name} is part of a RAID array`
    if (x.fstype === 'zfs_member') return tr('{0} is part of the ZFS pool {1}: formatting it would destroy the pool’s files', x.name, x.label || '?')
    if (x.fstype === 'crypto_LUKS') return `${x.name} is an encrypted volume`
    for (const c of x.children ?? []) {
      const why = walk(c)
      if (why) return why
    }
    return null
  }
  return walk(d)
}
// Kubernetes bind-mounts pod volumes from the root disk; its real mount point is "/".
const mainMount = (v: BlockDevice) => (v.mountpoints?.includes('/') ? '/' : v.mountpoints?.find(m => !m.startsWith('/var/lib/kubelet/')) ?? v.mountpoints?.[0])
const volumeName = (v: BlockDevice) => v.label || mainMount(v) || v.name

/** Disk Manager: drives, partitions, health, mounting, and what takes up space. */
export function DiskManager({ onShowInFiles }: { onShowInFiles: (path: string) => void }) {
  const [disks, setDisks] = useState<BlockDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [formatting, setFormatting] = useState<BlockDevice | null>(null)
  const [zfs, setZfs] = useState<ZfsInfo | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, info, pools] = await Promise.all([api.disks(), api.storage().catch(() => null), api.zfs().catch(() => null)])
      setDisks(list)
      setStorage(info)
      setZfs(pools)
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
  const mount = item ? mainMount(item) : undefined
  const pool = zfs?.pools.find(p => poolKey(p.name) === selected) ?? null
  const showZfs = !!zfs?.pools.length || !!zfs?.importable.length || (disks ?? []).some(d => zfsPoolOf(d))
  const memberOf = disk ? zfsPoolOf(disk) : undefined

  const toggleMount = async () => {
    if (!item) return
    setBusy(true)
    setNote(null)
    try {
      const res = await api.mountDisk(item.path, !mount)
      setNote(res.message || (mount ? tr('Unmounted.') : tr('Mounted.')))
      await refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setNote(null)
    try {
      await task()
      setNote(done)
      await refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const removable = !!disk && (disk.tran === 'usb' || disk.rm)

  useAppMenus(() => [
    {
      label: tr('View'),
      items: [
        { label: tr('Info'), checked: tab === 'info', onSelect: () => setTab('info') },
        { label: tr('Space Usage'), checked: tab === 'usage', onSelect: () => setTab('usage') },
        'separator',
        { label: tr('Refresh'), icon: RotateCw, onSelect: () => void refresh() },
      ],
    },
  ])

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-group">{tr('Drives')}</div>
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
        <div className="sidebar-group">{tr('Storage')}</div>
        <button className={`sidebar-item ${selected === MERGED ? 'is-active' : ''}`} onClick={() => setSelected(MERGED)}>
          <Combine size={15} /> {tr('Merged Storage')}
          {storage?.merged.length ? <span className="sidebar-badge">{storage.merged.length}</span> : null}
        </button>
        <button className={`sidebar-item ${selected === CLOUD ? 'is-active' : ''}`} onClick={() => setSelected(CLOUD)}>
          <Cloud size={15} /> {tr('Cloud Drives')}
        </button>
        {showZfs && (
          <>
            <div className="sidebar-group">{tr('ZFS Pools')}</div>
            {(zfs?.pools ?? []).map(p => (
              <button key={p.name} className={`sidebar-item ${selected === poolKey(p.name) ? 'is-active' : ''}`} onClick={() => setSelected(poolKey(p.name))}>
                <Database size={15} /> <span className="du-side-name">{p.name}</span>
                {poolLevel(p.state) !== 'ok' && <TriangleAlert size={12} className={`du-warn is-${poolLevel(p.state)}`} />}
              </button>
            ))}
            <button className={`sidebar-item ${selected === ZFS_IMPORT ? 'is-active' : ''}`} onClick={() => setSelected(ZFS_IMPORT)}>
              <DatabaseZap size={15} /> {tr('Import Pools')}
              {zfs?.importable.length ? <span className="sidebar-badge">{zfs.importable.length}</span> : null}
            </button>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </aside>

      <div className="pane du">
        <WindowToolbar>
          <ToolbarTitle
            title={pool ? pool.name : selected === ZFS_IMPORT ? tr('Import Pools') : item ? (item === disk ? disk.model || disk.name : volumeName(item)) : tr('Disk Manager')}
            subtitle={
              pool
                ? tr('ZFS pool · {0}', formatBytes(pool.used + pool.free))
                : item
                  ? `${formatBytes(item.size)} ${item.fstype ? item.fstype.toUpperCase() : item.tran?.toUpperCase() ?? ''}`
                  : undefined
            }
          />
          <span className="tb-spacer" />
          {item && (
            <div className="tb-segmented">
              <button className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')}>
                {tr('Info')}
              </button>
              <button className={tab === 'usage' ? 'is-active' : ''} onClick={() => setTab('usage')} disabled={!mount && !disk}>
                {tr('Space Usage')}
              </button>
            </div>
          )}
          <div className="tb-group">
            <button className="tb-btn" onClick={() => void refresh()} aria-label={tr('Refresh')} title={tr('Refresh')}>
              <RotateCw size={14} />
            </button>
          </div>
        </WindowToolbar>

        {selected === ZFS_IMPORT ? (
          <ZfsImportPane info={zfs} onChanged={() => void refresh()} />
        ) : pool ? (
          <ZfsPoolPane pool={pool} onChanged={() => void refresh()} onShowInFiles={onShowInFiles} />
        ) : selected === CLOUD ? (
          <CloudPane />
        ) : selected === MERGED ? (
          <MergedPane disks={disks ?? []} storage={storage} onChanged={refresh} />
        ) : !item ? (
          <p className="am-empty">{disks ? tr('Select a drive.') : tr('Reading drives…')}</p>
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
                    <i className="is-used" /> {tr('Used')} <strong>{formatBytes(item.fsused ?? 0)}</strong>
                  </span>
                  <span>
                    <i /> {tr('Free')} <strong>{formatBytes(item.fsavail ?? 0)}</strong>
                  </span>
                  <span>
                    {tr('Capacity')} <strong>{formatBytes(item.size)}</strong>
                  </span>
                </div>
              </div>
            )}

            <div className="group du-info">
              {item === disk ? (
                <>
                  <Row label={tr('Model')} value={disk.model} />
                  <Row label={tr('Serial number')} value={disk.serial} />
                  <Row label={tr('Connection')} value={disk.tran?.toUpperCase()} />
                  <Row label={tr('Type')} value={disk.rota ? tr('Hard disk (spinning)') : tr('Solid-state')} />
                  <Row label={tr('Device')} value={disk.path} />
                  <Row label={tr('ZFS pool')} value={memberOf} />
                </>
              ) : (
                <>
                  <Row label={tr('Mounted at')} value={mount ?? tr('Not mounted')} />
                  <Row label={tr('File system')} value={item.fstype?.toUpperCase()} />
                  <Row label={tr('Label')} value={item.label} />
                  <Row label="UUID" value={item.uuid} />
                  <Row label={tr('Device')} value={item.path} />
                </>
              )}
            </div>

            {disk?.smart && (
              <>
                <h4 className="du-heading">{tr('Health (S.M.A.R.T.)')}</h4>
                <div className={`group du-health is-${health(disk).level}`}>
                  <div className="du-verdict">
                    {health(disk).level === 'ok' ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
                    <strong>{health(disk).text}</strong>
                  </div>
                  {disk.smart.temperature ? (
                    <Row label={tr('Temperature')} value={`${disk.smart.temperature} °C`} icon={<Thermometer size={13} />} />
                  ) : null}
                  {disk.smart.powerOnHours !== undefined && (
                    <Row label={tr('Powered on')} value={`${disk.smart.powerOnHours.toLocaleString()} hours (${Math.round(disk.smart.powerOnHours / 24 / 365 * 10) / 10} years)`} />
                  )}
                  {disk.smart.powerCycles !== undefined && <Row label={tr('Power cycles')} value={disk.smart.powerCycles.toLocaleString()} />}
                  {disk.smart.wearPercent !== undefined && <Row label={tr('Wear')} value={`${disk.smart.wearPercent}% of rated life used`} />}
                  {disk.smart.reallocated !== undefined && <Row label={tr('Reallocated sectors')} value={String(disk.smart.reallocated)} />}
                  {disk.smart.pending !== undefined && <Row label={tr('Pending sectors')} value={String(disk.smart.pending)} />}
                </div>
              </>
            )}

            {item !== disk && item.fstype && !SYSTEM_MOUNTS.includes(mount ?? '') && (
              <div className="group du-startup">
                <span>
                  {tr('Mount at startup')}
                  <small>
                    {item.startup
                      ? tr('Mounted at {0} every time the server starts (in /etc/fstab).', item.startup)
                      : tr('Mount this partition automatically when the server starts, even without TemanLabsOS.')}
                  </small>
                </span>
                <Switch
                  checked={!!item.startup}
                  onChange={on => void run(() => api.setAutomount(item.path, on, item.startup ?? mount), on ? 'Mounts at startup.' : 'No longer mounted at startup.')}
                  label={tr('Mount at startup')}
                />
              </div>
            )}

            <div className="du-actions">
              {note && <span className="form-hint">{note}</span>}
              {memberOf && (
                <button className="btn" onClick={() => setSelected(zfs?.pools.some(p => p.name === memberOf) ? poolKey(memberOf) : ZFS_IMPORT)}>
                  <Database size={13} /> {zfs?.pools.some(p => p.name === memberOf) ? tr('Show Pool') : tr('Import Pool…')}
                </button>
              )}
              {removable && item === disk && (
                <button className="btn" onClick={() => void run(() => api.ejectDisk(disk.path), 'Ejected: you can unplug it now.')} disabled={busy}>
                  <Power size={13} /> {tr('Eject')}
                </button>
              )}
              {item !== disk && item.fstype && (
                <button className="btn" onClick={() => void toggleMount()} disabled={busy || SYSTEM_MOUNTS.includes(mount ?? '')}>
                  {busy ? <LoaderCircle size={13} className="spin" /> : null} {mount ? tr('Unmount') : tr('Mount')}
                </button>
              )}
              <button className="btn" onClick={() => setFormatting(item)} disabled={busy || !!eraseBlocker(item)} title={eraseBlocker(item) ?? tr('Erase and create new storage')}>
                <Eraser size={13} /> {item === disk ? tr('Format Drive…') : tr('Format…')}
              </button>
            </div>
          </>
        )}
      </div>
      <FormatSheet
        device={formatting}
        filesystems={storage?.filesystems ?? ['ext4']}
        onClose={() => setFormatting(null)}
        onDone={() => void refresh()}
      />
    </div>
  )
}

/** Format: erase a drive (or partition) into new storage, mounted under /DATA at every startup. */
function FormatSheet({ device, filesystems, onClose, onDone }: { device: BlockDevice | null; filesystems: string[]; onClose: () => void; onDone: () => void }) {
  const { mounted, closing } = usePresence(!!device, 220)
  const [last, setLast] = useState(device)
  if (device && device !== last) setLast(device)
  if (!mounted || !last) return null
  return <FormatForm key={last.path} device={last} filesystems={filesystems} closing={closing} onClose={onClose} onDone={onDone} />
}

function FormatForm({ device, filesystems, closing, onClose, onDone }: { device: BlockDevice; filesystems: string[]; closing: boolean; onClose: () => void; onDone: () => void }) {
  const [fstype, setFstype] = useState<FormatFS>('ext4')
  const [label, setLabel] = useState((device.label || device.model || 'Storage').replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 16) || 'Storage')
  const [mount, setMount] = useState(true)
  const [confirm, setConfirm] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const running = !!job?.running
  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      const next = await api.job('disk-format').catch(() => null)
      if (!next) return
      setJob(next)
      if (!next.running) onDone()
    }, 1200)
    return () => clearInterval(timer)
  }, [running, onDone])
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log.length])

  const start = async () => {
    setError(null)
    try {
      await api.formatDisk({ device: device.path, fstype, label, confirm, mount })
      setJob(await api.job('disk-format'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const finished = job && !job.running
  return (
    <div className={`sheet-backdrop ${closing ? 'is-closing' : ''}`} onPointerDown={e => e.target === e.currentTarget && !running && onClose()}>
      <div className="sheet ci fmt-sheet" role="dialog" aria-label={tr('Format')}>
        <header className="ci-head">
          <strong>{tr('Format')} {device.model || device.label || device.name}</strong>
          <span className="tb-spacer" />
          <button className="icon-btn" onClick={onClose} disabled={running} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="ci-body">
          <div className="fmt-warning">
            <TriangleAlert size={18} />
            <span>
              <strong>{tr('Everything on')} {device.path} ({formatBytes(device.size)}{tr(') will be erased.')}</strong>
              <small>{device.children?.length ? tr('Its {0} partition(s) and all their files are removed.', device.children.length) : tr('All files on it are removed.')} {tr('This can’t be undone.')}</small>
            </span>
          </div>
          <div className="ci-grid">
            <label className="ci-field">
              <span className="ci-label">{tr('Name')}</span>
              <input value={label} onChange={e => setLabel(e.target.value.replace(/[^A-Za-z0-9_.-]/g, ''))} maxLength={fstype === 'xfs' ? 12 : fstype === 'exfat' ? 15 : 16} disabled={!!job} />
            </label>
            <label className="ci-field">
              <span className="ci-label">{tr('File system')}</span>
              <select value={fstype} onChange={e => setFstype(e.target.value as FormatFS)} disabled={!!job}>
                {filesystems.map(f => (
                  <option key={f} value={f}>
                    {f === 'ext4' ? tr('ext4 (Linux, recommended)') : f === 'exfat' ? tr('exFAT (USB sticks, Windows/Mac too)') : f === 'ntfs' ? tr('NTFS (Windows)') : f}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="fmt-check">
            <input type="checkbox" checked={mount} onChange={e => setMount(e.target.checked)} disabled={!!job} /> {tr('Mount at /DATA/')}{label || '…'} {tr('now and at every startup')}
          </label>
          <label className="ci-field">
            <span className="ci-label">
              {tr('Type the name to confirm:')} <b>{device.name}</b>
            </span>
            <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={device.name} spellCheck={false} autoComplete="off" disabled={!!job} />
          </label>
          {job && (
            <div className="su-job">
              <div className="su-job-head">
                {job.running ? <LoaderCircle size={14} className="spin" /> : job.exit === 0 ? <CircleCheck size={14} className="is-ok" /> : <TriangleAlert size={14} className="is-bad" />}
                <strong>{job.title}</strong>
              </div>
              <pre ref={logRef} className="su-log">
                {job.log.join('\n') || '…'}
              </pre>
            </div>
          )}
        </div>
        <footer className="ci-foot">
          {error ? <p className="form-error">{error}</p> : <p className="form-hint">{finished ? (job.exit === 0 ? tr('Done.') : tr('Formatting failed; see the log.')) : ''}</p>}
          <button className="btn" onClick={onClose} disabled={running}>
            {finished ? tr('Close') : tr('Cancel')}
          </button>
          {!finished && (
            <button className="btn btn-danger" onClick={() => void start()} disabled={running || confirm !== device.name || !label}>
              {running ? <LoaderCircle size={13} className="spin" /> : <Eraser size={13} />} {tr('Erase and Format')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

/** Cloud drives (rclone) mounted under /DATA/Cloud, like CasaOS's "Add cloud drive". */
function CloudPane() {
  const [info, setInfo] = useState<CloudInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<CloudProvider | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setInfo(await api.cloud())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const act = async (name: string, task: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    try {
      await task()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  if (adding) return <CloudConnect provider={adding} onCancel={() => setAdding(null)} onDone={() => { setAdding(null); void load() }} />
  return (
    <>
      <p className="pane-note">
        {tr('Connect cloud storage and use it like a folder: it appears at /DATA/Cloud/<name> and in Files, and reconnects whenever the server starts. Files are read and written through rclone; recent changes are cached on the server for a few seconds.')}
      </p>
      {error && <p className="form-error">{error}</p>}
      {info && !info.rclone && <p className="ci-note">{tr('rclone isn’t installed on the server. Install it with System Updates or')} <code>sudo apt install rclone</code>.</p>}
      {info?.remotes.map(r => (
        <div key={r.name} className="group mg-row">
          <Cloud size={18} />
          <span>
            <strong>{r.name}</strong>
            <small>
              {info.providers.find(p => p.type === r.type)?.name ?? r.type} · {r.mount} ·{' '}
              {r.mounted ? 'connected' : r.service === 'failed' ? `failed: ${r.error ?? 'see Log Viewer'}` : tr('not connected')}
            </small>
          </span>
          <button className="btn" onClick={() => void act(r.name, () => api.cloudAction(r.name, r.mounted ? 'unmount' : 'mount'))} disabled={busy === r.name}>
            {busy === r.name ? <LoaderCircle size={13} className="spin" /> : null} {r.mounted ? tr('Disconnect') : tr('Connect')}
          </button>
          <button
            className={`btn ${confirming === r.name ? 'btn-danger' : ''}`}
            onClick={() => (confirming === r.name ? void act(r.name, () => api.removeCloud(r.name)) : setConfirming(r.name))}
            onBlur={() => setConfirming(null)}
            disabled={busy === r.name}
          >
            <Trash2 size={13} /> {confirming === r.name ? tr('Click Again (files stay in the cloud)') : tr('Remove')}
          </button>
        </div>
      ))}
      <h4 className="du-heading">{tr('Connect a cloud drive')}</h4>
      <div className="cl-providers">
        {(info?.providers ?? []).map(p => (
          <button key={p.type} className="group cl-provider" onClick={() => setAdding(p)} disabled={!info?.rclone}>
            <Cloud size={18} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function CloudConnect({ provider, onCancel, onDone }: { provider: CloudProvider; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState(provider.name.split(' ')[0].replace(/[^A-Za-z0-9]/g, '') + (provider.type === 'drive' ? 'Drive' : ''))
  const [params, setParams] = useState<Record<string, string>>({})
  const [session, setSession] = useState<{ session: string; url: string } | null>(null)
  const [redirect, setRedirect] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const s = await api.cloudSignIn(provider.type)
      setSession(s)
      window.open(s.url, '_blank', 'noopener')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.addCloud(provider.oauth ? { name, type: provider.type, session: session?.session, redirect } : { name, type: provider.type, params })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const missing = provider.oauth ? !session || !redirect.trim() : (provider.fields ?? []).some(f => !f.optional && !params[f.key]?.trim())
  return (
    <>
      <button className="pill-btn cl-back" onClick={onCancel}>
        <ArrowLeft size={12} /> {tr('Cloud Drives')}
      </button>
      <h3 className="cl-title">{tr('Connect')} {provider.name}</h3>
      <div className="group cl-form ci">
        <label className="ci-field">
          <span className="ci-label">{tr('Name')}</span>
          <input value={name} onChange={e => setName(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} placeholder={tr('GoogleDrive')} />
          <small>{tr('Mounted at /DATA/Cloud/')}{name || '…'}</small>
        </label>
        {provider.oauth ? (
          <ol className="cl-steps">
            <li>
              <span>{tr('Sign in to')} {provider.name} {tr('and allow access.')}</span>
              <button className="btn" onClick={() => void signIn()} disabled={busy}>
                <ExternalLink size={13} /> {session ? tr('Open Sign-in Again') : tr('Sign in to {0}', provider.name)}
              </button>
              {session && (
                <small>
                  {tr('The sign-in page opened in a new tab. If it didn’t,')} <a href={session.url} target="_blank" rel="noreferrer">{tr('open it here')}</a>.
                </small>
              )}
            </li>
            <li>
              <span>
                {tr('After you allow access, the browser goes to a page that')} <b>{tr('can’t be reached')}</b> {tr('(127.0.0.1:53682 or localhost:53682). That’s expected: copy that page’s full address and paste it here.')}
              </span>
              <input value={redirect} onChange={e => setRedirect(e.target.value)} placeholder="http://127.0.0.1:53682/?state=…&code=…" spellCheck={false} disabled={!session} />
            </li>
          </ol>
        ) : (
          (provider.fields ?? []).map(f => (
            <label key={f.key} className="ci-field">
              <span className="ci-label">
                {f.label}
                {f.optional ? '' : ' *'}
              </span>
              <input
                type={f.secret ? 'password' : 'text'}
                value={params[f.key] ?? ''}
                onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          ))
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="cl-actions">
          <button className="btn" onClick={onCancel}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void connect()} disabled={busy || missing || !name}>
            {busy ? <LoaderCircle size={13} className="spin" /> : <Cloud size={13} />} {tr('Connect')}
          </button>
        </div>
      </div>
    </>
  )
}

/** Merged storage: several drives shown as one folder (mergerfs), like CasaOS's Merge Storage. */
function MergedPane({ disks, storage, onChanged }: { disks: BlockDevice[]; storage: StorageInfo | null; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('Storage')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  // Data volumes: mounted, not the system's, not already a merged folder.
  const merged = storage?.merged ?? []
  const volumes = disks
    .flatMap(d => [d, ...(d.children ?? []).flatMap(c => [c, ...(c.children ?? [])])])
    .filter(v => isVolume(v) && mainMount(v) && !SYSTEM_MOUNTS.includes(mainMount(v)!) && !merged.some(m => m.target === mainMount(v)!))

  const act = async (task: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      await onChanged()
      setPicked(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <>
      <p className="pane-note">
        {tr('Merge drives into one folder: new files go to the drive with the most free space, and the folder shows everything on all of them. Files stay on their own drives, so unmerging never deletes anything.')}
      </p>
      {storage && !storage.mergerfs && (
        <div className="group du-startup">
          <span>
            {tr('mergerfs isn’t installed')}
            <small>{tr('It’s the small tool that merges the drives.')}</small>
          </span>
          <button className="btn btn-primary" onClick={() => void act(() => api.installMergerfs())} disabled={busy}>
            {tr('Install mergerfs')}
          </button>
        </div>
      )}
      {merged.map(m => (
        <div key={m.target} className="group mg-row">
          <Combine size={18} />
          <span>
            <strong>{m.target}</strong>
            <small>
              {m.branches.join(' + ')}
              {m.mounted ? tr(' · {0} free of {1}', formatBytes(m.free), formatBytes(m.size)) : tr(' · not mounted')}
            </small>
          </span>
          <button className={`btn ${confirming === m.name ? 'btn-danger' : ''}`} onClick={() => (confirming === m.name ? void act(() => api.unmergeStorage(m.name)) : setConfirming(m.name))} onBlur={() => setConfirming(null)} disabled={busy}>
            <Trash2 size={13} /> {confirming === m.name ? tr('Click Again: files stay on the drives') : tr('Unmerge')}
          </button>
        </div>
      ))}
      <h4 className="du-heading">{tr('New merged storage')}</h4>
      <div className="group mg-new">
        {volumes.length < 2 && <p className="sh-empty">{tr('Mount at least two data drives to merge them.')}</p>}
        {volumes.map(v => (
          <label key={v.path} className="mg-pick">
            <input
              type="checkbox"
              checked={picked.has(mainMount(v)!)}
              onChange={e =>
                setPicked(p => {
                  const next = new Set(p)
                  if (e.target.checked) next.add(mainMount(v)!)
                  else next.delete(mainMount(v)!)
                  return next
                })
              }
            />
            <span>
              <strong>{mainMount(v)!}</strong>
              <small>
                {v.label || v.name} · {formatBytes(v.fsavail ?? 0)} {tr('free of')} {formatBytes(v.size)}
              </small>
            </span>
          </label>
        ))}
        <div className="mg-create">
          <span>/DATA/</span>
          <input value={name} onChange={e => setName(e.target.value.replace(/[^A-Za-z0-9_.-]/g, ''))} aria-label={tr('Merged folder name')} />
          <button className="btn btn-primary" onClick={() => void act(() => api.mergeStorage(name, [...picked]))} disabled={busy || picked.size < 2 || !name || !storage?.mergerfs}>
            {busy ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />} {tr('Merge')} {picked.size || ''} {tr('Drives')}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
      {storage && (
        <div className="group du-startup">
          <span>
            {tr('Mount USB drives automatically')}
            <small>{tr('Plugged-in USB drives appear under /media (and in Files) within a few seconds.')}</small>
          </span>
          <Switch checked={storage.usbAutomount} onChange={on => void act(() => api.setUsbAutomount(on))} label={tr('Mount USB drives automatically')} />
        </div>
      )}
    </>
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
        <button className="icon-btn" onClick={() => setPath(parentOf(path))} disabled={path === '/' || path === start} aria-label={tr('Up')}>
          <ArrowLeft size={14} />
        </button>
        <strong>{displayName(path) || path}</strong>
        <small>{path}</small>
        <span className="media-spacer" />
        {usage && <span className="du-total">{formatBytes(usage.total)}</span>}
        <button className="icon-btn" onClick={() => void load(path, true)} aria-label={tr('Rescan')} title={tr('Rescan')}>
          <RotateCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading && !usage && (
        <p className="am-empty">
          <LoaderCircle size={14} className="spin" /> {tr('Measuring folders… big disks take a little while.')}
        </p>
      )}
      {usage?.partial && <p className="form-hint">{tr('Still counting when time ran out; sizes are at least this much.')}</p>}
      <div className={`du-usage-list ${loading ? 'is-loading' : ''}`}>
        {usage?.entries.map(e => (
          <button
            key={e.name}
            className="du-usage-row"
            disabled={!e.isDir}
            onClick={() => e.isDir && setPath(joinPath(path, e.name))}
            title={e.isDir ? tr('Open {0}', e.name) : undefined}
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
