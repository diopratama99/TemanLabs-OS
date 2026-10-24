// Absolute POSIX paths on the server. "/" needs care: its children are "/etc", not "//etc".

export const joinPath = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`)

export function parentOf(path: string) {
  const slash = path.lastIndexOf('/')
  return slash <= 0 ? '/' : path.slice(0, slash)
}

export const nameOf = (path: string) => (path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1))

/** Folder name for titles; the filesystem root reads "Root", like CasaOS's file manager. */
export const displayName = (path: string) => (path === '/' ? 'Root' : nameOf(path))

/** Path relative to `root` (for showing paths inside a workspace). */
export function relativeTo(root: string, path: string) {
  if (path === root) return ''
  if (root === '/') return path.slice(1)
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** Each ancestor from "/" down to `path`, for breadcrumbs. */
export function ancestors(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  return [{ name: 'Root', path: '/' }, ...parts.map((part, i) => ({ name: part, path: `/${parts.slice(0, i + 1).join('/')}` }))]
}
