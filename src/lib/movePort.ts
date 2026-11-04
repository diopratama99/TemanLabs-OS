// Moving to the server's new port (Settings › Network › Port). A browser keeps settings per address,
// port included, so the page leaves them with the server, goes to the new port and picks them up
// there. It runs before the desktop loads, and imports nothing that reads settings.

const CARRY = 'carry'
const MOCK = import.meta.env.VITE_MOCK === '1'

/** At the new port: puts the settings brought from the old one back, before anything reads them. */
export async function pickUpSettings() {
  const url = new URL(location.href)
  const token = url.searchParams.get(CARRY)
  if (!token) return
  url.searchParams.delete(CARRY)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  try {
    const res = await fetch(`/api/server/handoff/${encodeURIComponent(token)}`)
    if (!res.ok) return
    const data = (await res.json()) as Record<string, string>
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v)
  } catch {
    // Nothing brought: this browser starts with the settings it has here.
  }
}

/** Opened at an old port, directly (not through a proxy or tunnel): goes on to the new one. */
export async function moveIfOldPort() {
  if (MOCK || location.protocol !== 'http:') return
  try {
    const res = await fetch('/api/server/port')
    if (!res.ok) return
    const p = (await res.json()) as { port: number; here: number; direct: boolean }
    const pagePort = Number(location.port) || 80
    if (p.direct && p.here === pagePort && p.port && p.port !== p.here) await moveToPort(p.port)
  } catch {
    // An older server, or none: stay.
  }
}

/** Goes to port at the same address, taking this browser's settings along. */
export async function moveToPort(port: number) {
  const data: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      const v = k && localStorage.getItem(k)
      if (k && v != null) data[k] = v
    }
  } catch {
    // Storage blocked: go without.
  }
  const url = new URL(location.href)
  url.port = port === 80 ? '' : String(port)
  try {
    const res = await fetch('/api/server/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (res.ok) url.searchParams.set(CARRY, ((await res.json()) as { token: string }).token)
  } catch {
    // Go anyway; settings here stay here.
  }
  location.replace(url.toString())
}
