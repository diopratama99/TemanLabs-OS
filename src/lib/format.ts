import { tr } from './i18n'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number, digits = 1) {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${UNITS[unit]}`
}

export const formatSpeed = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/s`

/** Network speed in bits, the way ISPs and speed tests report it (Mbps). */
export function formatBitrate(bytesPerSecond: number) {
  const bits = bytesPerSecond * 8
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbps`
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbps`
  return `${(bits / 1e3).toFixed(0)} Kbps`
}

export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** Relative style: "Today at 11:21", "Yesterday at 09:02", "24 Oct 2026 at 11:21". */
export function formatFileDate(modified: string) {
  const d = new Date(modified)
  if (Number.isNaN(d.getTime())) return modified
  // Date-only values (mock data) have no meaningful time.
  const time = /T\d/.test(modified) ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const day = sameDay(d, now) ? tr('Today') : sameDay(d, yesterday) ? tr('Yesterday') : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return time ? tr('{0} at {1}', day, time) : day
}
