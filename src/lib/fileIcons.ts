import { extensionsOf, languageFor } from './fileTypes'

// The Material Icon Theme's mapping (public/file-icons/map.json, from scripts/file-icons.mjs),
// matched the way VS Code matches an icon theme: the whole file name, then its extensions from the
// longest, then its language; folders by name. Light backgrounds get the theme's light variants.

type Group = Record<string, string>
interface Groups {
  ext: Group
  names: Group
  folders: Group
  langs: Group
}
export interface IconMap extends Groups {
  file: string
  folder: string
  light: Groups
}
type RawGroups = Record<keyof Groups, Record<string, string[]>>
export type RawIconMap = RawGroups & { file: string; folder: string; light: RawGroups }

// map.json lists names per icon; look-ups want icons per name.
const invert = (byIcon: Record<string, string[]> = {}): Group => {
  const out: Group = {}
  for (const [icon, names] of Object.entries(byIcon)) for (const n of names) out[n.toLowerCase()] = icon
  return out
}
const groups = (raw: Partial<RawGroups>): Groups => ({ ext: invert(raw.ext), names: invert(raw.names), folders: invert(raw.folders), langs: invert(raw.langs) })

export const readIconMap = (raw: RawIconMap): IconMap => ({ file: raw.file, folder: raw.folder, ...groups(raw), light: groups(raw.light ?? {}) })

// Monaco's language ids where VS Code's differ.
const VSCODE_LANGUAGE: Record<string, string> = { shell: 'shellscript' }

/** The theme's icon for a file or folder. */
export function iconFor(map: IconMap, name: string, folder: boolean, open: boolean, light: boolean): string {
  const lower = name.toLowerCase()
  const find = (key: keyof Groups, value: string) => (light ? map.light[key][value] : undefined) ?? map[key][value]
  if (folder) {
    const icon = (lower && find('folders', lower)) || map.folder
    return open ? `${icon}-open` : icon
  }
  const byName = find('names', lower)
  if (byName) return byName
  for (const ext of extensionsOf(name)) {
    const icon = find('ext', ext)
    if (icon) return icon
  }
  const language = languageFor(name)?.id
  const byLanguage = language && find('langs', VSCODE_LANGUAGE[language] ?? language)
  return byLanguage || map.file
}
