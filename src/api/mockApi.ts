// In-memory stand-in for the server, used only by `npm run dev:mock` (VITE_MOCK=1) to work on
// the UI without a backend. Production builds talk to the real server through httpApi.
import { fileKind, isTextFile } from '../lib/fileTypes'
import type { Api, UploadOptions } from './httpApi'
import { catalog, contents, files, initialInstalled, nextStats } from './mock'
import { mockK8s, mockSystem } from './mockSystem'
import type {
  AppStatus,
  CustomAppSpec,
  FileEntry,
  InstalledApp,
  SearchMatch,
  SmbShare,
  SmbShareSpec,
  SmbUser,
  StoreApp,
  WallpaperImage,
} from './types'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const toInstalled = (app: StoreApp, status: AppStatus): InstalledApp => ({
  id: app.id,
  name: app.name,
  icon: app.icon,
  color: app.color,
  category: app.category,
  description: app.description,
  port: app.port,
  path: '/',
  scheme: 'http',
  status,
  source: 'temanlabs',
  containers: 1,
  canUninstall: true,
})

let installed: InstalledApp[] = catalog
  .filter(app => app.id in initialInstalled)
  .map(app => toInstalled(app, initialInstalled[app.id]))

// Web apps running outside Docker, as the server's port scan finds them.
const nativeApp = (id: string, name: string, port: number, unit?: string): InstalledApp => ({
  id: `native-${id}`,
  name,
  icon: 'boxes',
  color: ['#64d2ff', '#2f6bff'],
  category: 'Native',
  description: unit ? `systemd service ${unit}` : 'Process node',
  port,
  path: '/',
  scheme: 'http',
  status: 'running',
  source: 'native',
  containers: 0,
  canUninstall: false,
  unit,
})
installed = [
  ...installed,
  nativeApp('casaos-gateway', 'CasaOS', 80, 'casaos-gateway.service'),
  nativeApp('pm2-teman', 'BensinKu', 3001, 'pm2-teman.service'),
  nativeApp('porto', 'My Portofolio', 3000, 'porto-diopratama.service'),
]

function setStatus(id: string, status: AppStatus) {
  installed = installed.map(app => (app.id === id ? { ...app, status } : app))
}

let wallpaperImages: WallpaperImage[] = []
let smbShares: SmbShare[] = [
  { name: 'DATA', path: '/DATA', comment: 'CasaOS share DATA', readOnly: false, guest: true, browseable: true, source: 'casaos' },
  { name: 'Media', path: '/DATA/Media', comment: 'CasaOS share Media', readOnly: false, guest: true, browseable: true, source: 'casaos' },
  { name: 'Projects', path: '/DATA/Projects', readOnly: false, guest: false, users: ['teman'], browseable: true, source: 'temanlabs' },
]
let smbUsers: SmbUser[] = [{ name: 'teman', fullName: 'Teman Labs', disabled: false }]

const today = () => new Date().toISOString().slice(0, 10)

/** Re-keys a path and everything below it, after a rename (to) or a delete (no `to`). */
function moveTree(from: string, to?: string) {
  for (const store of [files, contents] as Record<string, unknown>[]) {
    for (const key of Object.keys(store)) {
      if (key !== from && !key.startsWith(`${from}/`)) continue
      if (to) store[to + key.slice(from.length)] = store[key]
      delete store[key]
    }
  }
}

const splitPath = (path: string) => {
  const slash = path.lastIndexOf('/')
  return { dir: path.slice(0, slash), name: path.slice(slash + 1) }
}

const SEARCH_LIMIT = 200

const byKindThenName = (a: FileEntry, b: FileEntry) =>
  Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name)

export const mockApi: Api = {
  ...mockSystem,
  ...mockK8s,

  async me() {
    return { authenticated: true, hostname: 'teman-server' }
  },
  async login() {
    return { authenticated: true, hostname: 'teman-server' }
  },
  async logout() {},
  async changePassword() {},

  async getSystemStats() {
    return nextStats()
  },

  async getCatalog() {
    return catalog
  },

  async listApps() {
    return installed
  },

  async installApp(id: string) {
    const app = catalog.find(a => a.id === id)
    if (!app || installed.some(a => a.id === id)) return
    installed = [...installed, toInstalled(app, 'installing')]
    void delay(3000).then(() => setStatus(id, 'running'))
  },

  async uninstallApp(id: string) {
    await delay(600)
    installed = installed.filter(app => app.id !== id)
  },

  async setAppRunning(id: string, running: boolean) {
    await delay(800)
    setStatus(id, running ? 'running' : 'stopped')
  },

  async installCustomApp(spec: CustomAppSpec) {
    await delay(400)
    const title = spec.title || 'Custom App'
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'
    installed = [
      ...installed,
      {
        id,
        name: title,
        icon: 'boxes',
        iconUrl: spec.iconUrl || undefined,
        color: ['#64d2ff', '#2f6bff'],
        category: 'Apps',
        description: 'Custom app',
        port: spec.webUi.port || null,
        path: spec.webUi.path || '/',
        scheme: spec.webUi.scheme,
        status: 'installing',
        source: 'temanlabs',
        containers: 1,
        canUninstall: true,
      },
    ]
    void delay(3000).then(() => setStatus(id, 'running'))
    return id
  },

  async listNetworks() {
    return ['bridge', 'host', 'casaos']
  },

  async appFrame() {
    return { proxied: false }
  },

  async listContainers() {
    return installed.map(app => ({
      id: `${app.id}000000000000`,
      name: app.id,
      image: `${app.id}:latest`,
      state: app.status === 'running' ? 'running' : 'exited',
      status: app.status === 'running' ? 'Up 2 days' : 'Exited (0) 3 hours ago',
      appId: app.id,
      created: Math.floor(Date.now() / 1000) - 172800,
      ports: app.port ? [`0.0.0.0:${app.port}→${app.port}/tcp`] : [],
      stats:
        app.status === 'running'
          ? {
              cpu: Math.random() * 40,
              memUsed: (100 + Math.random() * 900) * 1024 ** 2,
              memLimit: 16 * 1024 ** 3,
              netRx: Math.random() * 2e5,
              netTx: Math.random() * 1e5,
              blockRead: 5e8,
              blockWrite: 2e8,
              pids: 12,
            }
          : null,
    }))
  },

  async containerAction(id: string, action: 'start' | 'stop' | 'restart') {
    const app = installed.find(a => `${a.id}000000000000` === id)
    if (app) setStatus(app.id, action === 'stop' ? 'stopped' : 'running')
  },

  async containerLogs(id: string) {
    return `${new Date().toISOString()} [mock] logs for ${id.slice(0, 12)}\n`
  },

  async listPorts() {
    return [
      { port: 22, protocol: 'tcp' as const, addresses: ['0.0.0.0', '::'], public: true, pid: 812, process: 'sshd', command: 'sshd: /usr/sbin/sshd -D', user: 'root' },
      { port: 53, protocol: 'udp' as const, addresses: ['127.0.0.53'], public: false, pid: 640, process: 'systemd-resolve', user: 'systemd-resolve' },
      { port: 7700, protocol: 'tcp' as const, addresses: ['::'], public: true, pid: 1500, process: 'temanlabsos', user: 'root' },
      ...installed
        .filter(a => a.port && a.status === 'running')
        .map(a => ({ port: a.port!, protocol: 'tcp' as const, addresses: ['0.0.0.0'], public: true, process: 'docker-proxy', container: a.id, appId: a.id, targetPort: 80, user: 'root' })),
    ]
  },
  async killProcess() {},

  async smbInfo() {
    return { installed: true, running: true, version: '4.19.5-Ubuntu', shares: smbShares, users: smbUsers, people: ['teman'] }
  },
  async smbStatus() {
    return { sessions: [{ user: 'teman', machine: '192.168.1.11', protocol: 'SMB3_11', shares: ['DATA'], since: new Date().toISOString() }], openFiles: 2 }
  },
  async restartSmb() {},
  async saveShare(spec: SmbShareSpec, editing?: string) {
    smbShares = [...smbShares.filter(s => s.name !== editing), { ...spec, source: 'temanlabs' as const }]
  },
  async deleteShare(name: string) {
    smbShares = smbShares.filter(s => s.name !== name)
  },
  async addSmbUser(name: string) {
    smbUsers = [...smbUsers, { name, disabled: false }]
  },
  async smbUserAction(name: string, action: 'password' | 'enable' | 'disable' | 'remove') {
    if (action === 'remove') smbUsers = smbUsers.filter(u => u.name !== name)
    else if (action !== 'password') smbUsers = smbUsers.map(u => (u.name === name ? { ...u, disabled: action === 'disable' } : u))
  },
  async listServices() {
    const now = Math.floor(Date.now() / 1000)
    return [
      { unit: 'casaos-gateway.service', description: 'CasaOS Gateway', load: 'loaded', active: 'active', sub: 'running', enabled: 'enabled', mainPid: 1108, memory: 49e6, cpu: Math.random() * 2, since: now - 86400 * 13 },
      { unit: 'docker.service', description: 'Docker Application Container Engine', load: 'loaded', active: 'active', sub: 'running', enabled: 'enabled', mainPid: 1432, memory: 635e6, cpu: 14, since: now - 86400 * 13, protected: true },
      { unit: 'ssh.service', description: 'OpenBSD Secure Shell server', load: 'loaded', active: 'active', sub: 'running', enabled: 'enabled', mainPid: 900, memory: 7e6, cpu: 0, since: now - 3600, protected: true },
      { unit: 'nginx.service', description: 'A high performance web server', load: 'loaded', active: 'failed', sub: 'failed', enabled: 'enabled', cpu: 0 },
      { unit: 'bluetooth.service', description: 'Bluetooth service', load: 'loaded', active: 'inactive', sub: 'dead', enabled: 'disabled', cpu: 0 },
    ]
  },
  async serviceAction() {},
  async serviceLogs(unit: string) {
    return `${new Date().toISOString()} teman-server systemd[1]: Started ${unit}.
`
  },
  async listProcesses() {
    const now = Math.floor(Date.now() / 1000)
    return [
      { pid: 1, ppid: 0, name: 'systemd', user: 'root', state: 'S', cpu: 0.1, memory: 12e6, threads: 1, started: now - 86400 * 13, command: '/sbin/init' },
      { pid: 1432, ppid: 1, name: 'dockerd', user: 'root', state: 'S', cpu: 12 + Math.random() * 10, memory: 146e6, threads: 40, started: now - 86400 * 13, command: '/usr/bin/dockerd -H fd://', unit: 'docker.service' },
      { pid: 2210, ppid: 1, name: 'node', user: 'teman', state: 'S', cpu: Math.random() * 5, memory: 80e6, threads: 11, started: now - 7200, command: 'node /home/teman/app/server.js', unit: 'pm2-teman.service' },
      { pid: 3000, ppid: 2999, name: 'jellyfin', user: 'root', state: 'S', cpu: 3, memory: 300e6, threads: 30, started: now - 86400, command: '/jellyfin/jellyfin', container: 'temanlabs-jellyfin' },
    ]
  },

  async listWallpapers() {
    return wallpaperImages
  },
  async uploadWallpaper(image: Blob) {
    const entry = { name: `${Date.now()}.jpg`, url: URL.createObjectURL(image) }
    wallpaperImages = [entry, ...wallpaperImages]
    return entry
  },
  async wallpaperFromFile() {
    throw new Error('Mock mode has no image files.')
  },
  async deleteWallpaper(name: string) {
    wallpaperImages = wallpaperImages.filter(w => w.name !== name)
  },

  async listFiles(path: string) {
    return [...(files[path] ?? [])].sort(byKindThenName)
  },

  async createFolder(path: string) {
    const list = files[path] ?? []
    let name = 'untitled folder'
    for (let n = 2; list.some(e => e.name === name); n++) name = `untitled folder ${n}`
    files[path] = [...list, { name, kind: 'folder', modified: today() }]
    files[`${path}/${name}`] = []
    return name
  },

  async createFile(path: string) {
    const list = files[path] ?? []
    let name = 'untitled.txt'
    for (let n = 2; list.some(e => e.name === name); n++) name = `untitled-${n}.txt`
    files[path] = [...list, { name, kind: 'document', size: 0, modified: today() }]
    contents[`${path}/${name}`] = ''
    return name
  },

  async renameEntry(path: string, from: string, to: string) {
    files[path] = (files[path] ?? []).map(e =>
      e.name === from ? { ...e, name: to, kind: e.kind === 'folder' ? 'folder' : fileKind(to), modified: today() } : e,
    )
    moveTree(`${path}/${from}`, `${path}/${to}`)
  },

  async copyEntries(paths: string[], to: string, move = false) {
    const names: string[] = []
    for (const p of paths) {
      const { dir, name } = splitPath(p)
      const entry = (files[dir] ?? []).find(e => e.name === name)
      if (!entry) continue
      const list = files[to] ?? []
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      let next = name
      for (let n = 1; list.some(e => e.name === next); n++) next = n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`
      files[to] = [...list, { ...entry, name: next }]
      if (move) files[dir] = (files[dir] ?? []).filter(e => e.name !== name)
      names.push(next)
    }
    return names
  },

  async deleteEntry(path: string, name: string) {
    files[path] = (files[path] ?? []).filter(e => e.name !== name)
    moveTree(`${path}/${name}`)
  },

  async readFile(path: string) {
    return contents[path] ?? ''
  },

  async writeFile(path: string, text: string) {
    await delay(150)
    contents[path] = text
    const { dir, name } = splitPath(path)
    files[dir] = (files[dir] ?? []).map(e => (e.name === name ? { ...e, size: text.length, modified: today() } : e))
  },

  // Mock mode has no file bytes; media viewers show their "can't load" state.
  rawFileUrl: (path: string) => `about:blank#${encodeURIComponent(path)}`,

  thumbUrl: () => null,

  async listTree(path: string) {
    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of files[dir] ?? []) {
        const child = `${dir}/${entry.name}`
        if (entry.kind === 'folder') walk(child)
        else found.push(child)
      }
    }
    walk(path)
    return found.sort()
  },

  async searchFiles(query: string, root = '/DATA') {
    const needle = query.toLowerCase()
    const matches: SearchMatch[] = []
    const inRoot = Object.entries(contents).filter(([path]) => path.startsWith(`${root}/`))
    for (const [path, text] of inRoot.sort(([a], [b]) => a.localeCompare(b))) {
      const lines = text.split('\n')
      for (let i = 0; i < lines.length && matches.length < SEARCH_LIMIT; i++) {
        const column = lines[i].toLowerCase().indexOf(needle)
        if (column >= 0) matches.push({ path, line: i + 1, column: column + 1, preview: lines[i] })
      }
    }
    return matches
  },

  async makeFolders(dir: string, rel: string) {
    let at = dir
    for (const name of rel.split('/').filter(Boolean)) {
      const list = files[at] ?? []
      if (!list.some(e => e.name === name)) files[at] = [...list, { name, kind: 'folder', modified: today() }]
      at = `${at}/${name}`
      files[at] ??= []
    }
  },

  async uploadFile(dir: string, file: File, options: UploadOptions = {}) {
    if (options.rel) {
      await mockApi.makeFolders(dir, options.rel)
      dir = `${dir}/${options.rel}`
    }
    for (let i = 1; i <= 4; i++) {
      await delay(120)
      options.onProgress?.((file.size * i) / 4, file.size)
    }
    // Read before touching the listing: parallel uploads must not overwrite each other's entry.
    const text = isTextFile(file.name) ? await file.text() : null
    const list = files[dir] ?? []
    const dot = file.name.lastIndexOf('.')
    const base = dot > 0 ? file.name.slice(0, dot) : file.name
    const ext = dot > 0 ? file.name.slice(dot) : ''
    let name = file.name
    for (let n = 1; list.some(e => e.name === name); n++) name = `${base} (${n})${ext}`
    if (text !== null) contents[`${dir}/${name}`] = text
    files[dir] = [...list, { name, kind: fileKind(name), size: file.size, modified: today() }]
    return name
  },

  terminalUrl: () => null,
}
