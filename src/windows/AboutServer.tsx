import { useEffect, useState } from 'react'
import { api } from '../api'
import type { HardwareInfo, SystemStats } from '../api/types'
import { DeviceArt, deviceTitle } from '../components/DeviceArt'
import { formatBytes } from '../lib/format'
import { tr } from '../lib/i18n'

/** The machine's name and model, read once per window. */
export function useHardware() {
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  useEffect(() => {
    api.hardware().then(setHw, () => setHw({ kind: 'unknown' }))
  }, [])
  return hw
}

/** CPU names carry trademarks and speeds nobody reads: "Intel(R) Core(TM) i5-7500T CPU @ 2.70GHz" → "Intel Core i5-7500T". */
export function shortCPU(model: string) {
  return model
    .replace(/\((R|TM|C)\)/gi, '')
    .replace(/\s+(CPU|Processor)\b/gi, '')
    .replace(/\s*@.*$/, '')
    .replace(/\s+\d+-Core$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** About This Server: a small window with the essentials; More Info opens Settings. */
export function AboutServer({ stats, onMoreInfo }: { stats: SystemStats | null; onMoreInfo: () => void }) {
  const hw = useHardware()
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    api.releaseStatus().then(r => setVersion(r.current), () => {})
  }, [])
  const { title, subtitle } = deviceTitle(hw, stats?.hostname)
  const rows: [string, string | null | undefined][] = [
    [tr('Name'), stats?.hostname],
    [tr('Processor'), stats && shortCPU(stats.cpu.model)],
    [tr('Memory'), stats && formatBytes(stats.memory.total, 0)],
    [tr('Serial number'), hw?.serial],
    [tr('System'), stats?.os],
    ['TemanLabsOS', version ?? undefined],
  ]
  return (
    <div className="about-server">
      <DeviceArt kind={hw?.kind} size={150} />
      <h2>{hw ? title : '…'}</h2>
      {subtitle && <p className="about-sub">{subtitle}</p>}
      <dl>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <button className="btn" onClick={onMoreInfo}>
        {tr('More Info…')}
      </button>
    </div>
  )
}
