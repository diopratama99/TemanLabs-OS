import { FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder, type LucideIcon } from 'lucide-react'
import type { FileKind } from '../api/types'

/** The icon and colour each kind of file is drawn with (Files, Get Info). */
export const KIND_ICON: Record<FileKind, LucideIcon> = {
  folder: Folder,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
  code: FileCode,
}

export const KIND_COLOR: Record<FileKind, string> = {
  folder: '#3d9cf5',
  image: '#ff9f0a',
  video: '#bf5af2',
  audio: '#ff375f',
  document: '#8e8e93',
  archive: '#a2845e',
  code: '#30b0c7',
}
