import type { LauncherFolder, Settings } from './settings'

type FolderState = Pick<Settings, 'launchpadFolders' | 'launchpadLoose'>

/** A folder as shown: its own items plus, for the auto folder, unplaced native apps. */
export interface FolderView extends LauncherFolder {
  items: string[]
}

/** Which auto folder (if any) a Launcher key belongs in: native apps, or the utilities. */
export type AutoKind = (key: string) => LauncherFolder['auto'] | undefined

/**
 * Splits the Launcher into folders and top-level keys. `keys` are the visible entries in
 * display order; `autoOf` tells which auto folder an entry belongs to.
 */
export function layoutFolders(state: FolderState, keys: string[], autoOf: AutoKind) {
  const present = new Set(keys)
  const placed = new Set<string>()
  const folders: FolderView[] = state.launchpadFolders.map(f => {
    const items = f.items.filter(k => present.has(k) && !placed.has(k))
    items.forEach(k => placed.add(k))
    return { ...f, items }
  })
  for (const f of folders) {
    if (!f.auto) continue
    for (const k of keys) {
      if (autoOf(k) === f.auto && !placed.has(k) && !state.launchpadLoose.includes(k)) {
        f.items.push(k)
        placed.add(k)
      }
    }
  }
  return { folders: folders.filter(f => f.items.length > 0), loose: keys.filter(k => !placed.has(k)) }
}

const without = (items: string[], key: string) => items.filter(k => k !== key)

/** Removes empty folders the user made (the auto folder stays, hidden while empty). */
const prune = (folders: LauncherFolder[]) => folders.filter(f => f.auto || f.items.length > 0)

/**
 * Moves a key into a folder, or to the top level with null. Taking an auto-folder app (native,
 * utility) out of every folder marks it loose so its folder doesn't pull it back in.
 */
export function moveTo(state: FolderState, key: string, folderId: string | null, isAuto: boolean): FolderState {
  const folders = state.launchpadFolders.map(f =>
    f.id === folderId ? { ...f, items: [...without(f.items, key), key] } : { ...f, items: without(f.items, key) },
  )
  const target = folders.find(f => f.id === folderId)
  const loose = without(state.launchpadLoose, key)
  return {
    launchpadFolders: prune(folders),
    launchpadLoose: !target && isAuto ? [...loose, key] : loose,
  }
}

export function newFolder(state: FolderState, keys: string[], name: string): FolderState {
  const folder: LauncherFolder = { id: `f${Date.now().toString(36)}`, name, items: keys }
  const folders = state.launchpadFolders.map(f => ({ ...f, items: f.items.filter(k => !keys.includes(k)) }))
  return {
    launchpadFolders: prune([...folders, folder]),
    launchpadLoose: state.launchpadLoose.filter(k => !keys.includes(k)),
  }
}

export function renameFolder(state: FolderState, id: string, name: string): FolderState {
  return { ...state, launchpadFolders: state.launchpadFolders.map(f => (f.id === id ? { ...f, name } : f)) }
}

/** Puts a folder's apps back on the top level. The auto folder stays (empty) for new apps. */
export function ungroup(state: FolderState, folder: FolderView, autoOf: AutoKind): FolderState {
  const natives = folder.items.filter(k => !!autoOf(k))
  return {
    launchpadFolders: prune(state.launchpadFolders.map(f => (f.id === folder.id ? { ...f, items: [] } : f))),
    launchpadLoose: [...state.launchpadLoose.filter(k => !natives.includes(k)), ...natives],
  }
}
