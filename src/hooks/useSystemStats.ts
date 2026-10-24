import { useEffect, useState } from 'react'
import { api } from '../api'
import type { SystemStats } from '../api/types'

export const HISTORY_LENGTH = 30

export interface StatsHistory {
  cpu: number[]
  rx: number[]
  tx: number[]
  /** Watts (empty when nothing measures power). */
  power: number[]
}

export function useSystemStats(intervalMs = 2000) {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [history, setHistory] = useState<StatsHistory>({ cpu: [], rx: [], tx: [], power: [] })

  useEffect(() => {
    let alive = true
    const tick = async () => {
      let next: SystemStats
      try {
        next = await api.getSystemStats()
      } catch {
        return // keep the last reading; the next tick retries
      }
      if (!alive) return
      setStats(next)
      setHistory(h => ({
        cpu: [...h.cpu, next.cpu.usage].slice(-HISTORY_LENGTH),
        rx: [...h.rx, next.network.rx].slice(-HISTORY_LENGTH),
        tx: [...h.tx, next.network.tx].slice(-HISTORY_LENGTH),
        power: next.power ? [...h.power, next.power.watts].slice(-HISTORY_LENGTH) : h.power,
      }))
    }
    void tick()
    const timer = setInterval(tick, intervalMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [intervalMs])

  return { stats, history }
}
