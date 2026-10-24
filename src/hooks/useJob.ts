import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Job } from '../api/types'

/** Follows a server job while it runs. */
export function useJob(kind: string | null, onDone?: (job: Job) => void) {
  const [job, setJob] = useState<Job | null>(null)
  useEffect(() => {
    if (!kind) return setJob(null)
    let alive = true
    let timer = 0
    const poll = async () => {
      const j = await api.job(kind).catch(() => undefined)
      if (!alive) return
      // A failed request is tried again; only the job ending stops the polling.
      if (j === undefined) {
        timer = window.setTimeout(poll, 3000)
        return
      }
      setJob(j)
      if (j.running) timer = window.setTimeout(poll, 1000)
      else onDone?.(j)
    }
    void poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [kind])
  return job
}
