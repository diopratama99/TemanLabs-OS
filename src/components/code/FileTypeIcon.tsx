import { FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder, FolderOpen } from 'lucide-react'
import { fileKind, languageFor } from '../../lib/fileTypes'

// Roughly the colors VS Code's default icon theme uses per language.
const LANGUAGE_COLOR: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#e8b500',
  json: '#cbab2f',
  html: '#e44d26',
  css: '#42a5f5',
  scss: '#cd6799',
  less: '#2a4d80',
  markdown: '#519aba',
  yaml: '#cb171e',
  shell: '#4eaa25',
  python: '#3572a5',
  go: '#00add8',
  rust: '#dea584',
  dockerfile: '#2496ed',
  ini: '#8e8e93',
}

const KIND_ICON = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  code: FileCode,
  document: FileText,
  folder: Folder,
}

interface Props {
  name: string
  folder?: boolean
  open?: boolean
  size?: number
}

export function FileTypeIcon({ name, folder, open, size = 15 }: Props) {
  if (folder) {
    const Icon = open ? FolderOpen : Folder
    return <Icon size={size} className="ce-ficon" color="#6b9eff" />
  }
  const kind = fileKind(name)
  const Icon = KIND_ICON[kind]
  const color = LANGUAGE_COLOR[languageFor(name)?.id ?? ''] ?? '#8e8e93'
  return <Icon size={size} className="ce-ficon" color={color} />
}
