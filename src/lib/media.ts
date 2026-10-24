import { api } from '../api'
import type { FileKind } from '../api/types'
import { joinPath, nameOf, parentOf } from './paths'

export type MediaKind = Extract<FileKind, 'image' | 'video' | 'audio'>

/** Asks a media window to show a file; the nonce makes reopening the same file count. */
export interface MediaRequest {
  path: string
  nonce: number
}

/** The files of one kind in a folder, sorted like Files shows them (for next/previous). */
export async function siblingsOf(dir: string, kind: MediaKind): Promise<string[]> {
  const entries = await api.listFiles(dir)
  return entries
    .filter(e => e.kind === kind)
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(name => joinPath(dir, name))
}

export const folderOf = parentOf

/** "01 - Song Title.mp3" → "Song Title". */
export function trackTitle(path: string) {
  return nameOf(path)
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{1,3}\s*[-._)]\s*/, '')
    .trim()
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
