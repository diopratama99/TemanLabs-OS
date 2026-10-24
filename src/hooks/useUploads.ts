import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

/** One thing to put on the server: a file (inside rel, for folders), or an empty folder. */
export interface UploadItem {
  file: File | null
  /** Folder path relative to the drop target, e.g. "Photos/2026"; "" for loose files. */
  rel: string
}

export interface UploadJob {
  id: number
  name: string
  dir: string
  size: number
  loaded: number
  status: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
}

const PARALLEL = 3
const HIDE_AFTER_MS = 4000

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Files chosen with <input type=file> (webkitdirectory gives each a relative path). */
export function itemsFromInput(list: FileList | null): UploadItem[] {
  return [...(list ?? [])].map(file => ({ file, rel: dirname(file.webkitRelativePath) }))
}

/**
 * Everything dropped from the computer, folders included. Entries must be taken during the drop
 * event itself; reading them can happen afterwards.
 */
export function entriesFromDrop(dt: DataTransfer): FileSystemEntry[] {
  return [...dt.items].map(item => item.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
}

export async function itemsFromEntries(entries: FileSystemEntry[]): Promise<UploadItem[]> {
  const out: UploadItem[] = []
  const walk = async (entry: FileSystemEntry, rel: string) => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      out.push({ file, rel })
      return
    }
    const dir = rel ? `${rel}/${entry.name}` : entry.name
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    let any = false
    // readEntries returns at most ~100 entries per call.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) break
      any = true
      for (const child of batch) await walk(child, dir)
    }
    if (!any) out.push({ file: null, rel: dir })
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

/** Upload queue for Files: a few at a time, with progress; onChange fires as files land. */
export function useUploads(onChange: () => void) {
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const queue = useRef<{ job: UploadJob; item: UploadItem }[]>([])
  const running = useRef(0)
  const nextId = useRef(1)
  const controllers = useRef(new Map<number, AbortController>())
  const changed = useRef(onChange)
  changed.current = onChange

  const patch = (id: number, p: Partial<UploadJob>) => setJobs(js => js.map(j => (j.id === id ? { ...j, ...p } : j)))

  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length > 0) {
      const { job, item } = queue.current.shift()!
      running.current++
      const controller = new AbortController()
      controllers.current.set(job.id, controller)
      patch(job.id, { status: 'uploading' })
      const task = item.file
        ? api.uploadFile(job.dir, item.file, {
            rel: item.rel,
            signal: controller.signal,
            onProgress: loaded => patch(job.id, { loaded }),
          })
        : api.makeFolders(job.dir, item.rel)
      task
        .then(() => patch(job.id, { status: 'done', loaded: job.size }))
        .catch((err: Error) => patch(job.id, { status: 'error', error: err.name === 'AbortError' ? 'Cancelled' : err.message }))
        .finally(() => {
          running.current--
          controllers.current.delete(job.id)
          changed.current()
          pump()
        })
    }
  }, [])

  const upload = useCallback(
    (dir: string, items: UploadItem[]) => {
      const added = items.map(item => {
        const job: UploadJob = {
          id: nextId.current++,
          name: item.file ? (item.rel ? `${item.rel}/${item.file.name}` : item.file.name) : `${item.rel}/`,
          dir,
          size: item.file?.size ?? 0,
          loaded: 0,
          status: 'queued',
        }
        queue.current.push({ job, item })
        return job
      })
      setJobs(js => [...js.filter(j => j.status !== 'done'), ...added])
      pump()
    },
    [pump],
  )

  const cancelAll = useCallback(() => {
    for (const { job } of queue.current) patch(job.id, { status: 'error', error: 'Cancelled' })
    queue.current = []
    controllers.current.forEach(c => c.abort())
  }, [])

  const clear = useCallback(() => setJobs(js => js.filter(j => j.status === 'queued' || j.status === 'uploading')), [])

  // The panel goes away a moment after everything has finished.
  const busy = jobs.some(j => j.status === 'queued' || j.status === 'uploading')
  const failed = jobs.some(j => j.status === 'error')
  useEffect(() => {
    if (busy || failed || jobs.length === 0) return
    const timer = setTimeout(() => setJobs([]), HIDE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [busy, failed, jobs.length])

  return { jobs, busy, upload, cancelAll, clear }
}
