import type { FileKind } from '../api/types'

export interface Language {
  /** Monaco language id. */
  id: string
  name: string
}

const lang = (id: string, name: string): Language => ({ id, name })

const BY_EXTENSION: Record<string, Language> = {
  ts: lang('typescript', 'TypeScript'),
  tsx: lang('typescript', 'TypeScript JSX'),
  js: lang('javascript', 'JavaScript'),
  mjs: lang('javascript', 'JavaScript'),
  cjs: lang('javascript', 'JavaScript'),
  jsx: lang('javascript', 'JavaScript JSX'),
  json: lang('json', 'JSON'),
  html: lang('html', 'HTML'),
  htm: lang('html', 'HTML'),
  css: lang('css', 'CSS'),
  scss: lang('scss', 'SCSS'),
  less: lang('less', 'Less'),
  md: lang('markdown', 'Markdown'),
  yml: lang('yaml', 'YAML'),
  yaml: lang('yaml', 'YAML'),
  sh: lang('shell', 'Shell Script'),
  bash: lang('shell', 'Shell Script'),
  zsh: lang('shell', 'Shell Script'),
  py: lang('python', 'Python'),
  go: lang('go', 'Go'),
  rs: lang('rust', 'Rust'),
  java: lang('java', 'Java'),
  c: lang('c', 'C'),
  h: lang('c', 'C'),
  cpp: lang('cpp', 'C++'),
  php: lang('php', 'PHP'),
  rb: lang('ruby', 'Ruby'),
  lua: lang('lua', 'Lua'),
  sql: lang('sql', 'SQL'),
  xml: lang('xml', 'XML'),
  ini: lang('ini', 'Ini'),
  conf: lang('ini', 'Config'),
  cfg: lang('ini', 'Config'),
  toml: lang('ini', 'TOML'),
  env: lang('ini', 'Environment'),
  txt: lang('plaintext', 'Plain Text'),
  log: lang('plaintext', 'Log'),
}

const BY_NAME: Record<string, Language> = {
  dockerfile: lang('dockerfile', 'Dockerfile'),
  makefile: lang('plaintext', 'Makefile'),
  '.env': lang('ini', 'Environment'),
  '.gitignore': lang('plaintext', 'Ignore'),
}

const MEDIA: Record<string, FileKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  svg: 'image',
  mp4: 'video',
  mkv: 'video',
  mov: 'video',
  avi: 'video',
  webm: 'video',
  m2ts: 'video',
  mts: 'video',
  mp3: 'audio',
  flac: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  iso: 'archive',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The editor language for a file, or null when it isn't a text file the editor can open. */
export function languageFor(name: string): Language | null {
  return BY_NAME[name.toLowerCase()] ?? BY_EXTENSION[extensionOf(name)] ?? null
}

export const isTextFile = (name: string) => languageFor(name) !== null

export function fileKind(name: string): FileKind {
  const media = MEDIA[extensionOf(name)]
  if (media) return media
  const language = languageFor(name)
  return language && language.id !== 'markdown' && language.id !== 'plaintext' ? 'code' : 'document'
}
