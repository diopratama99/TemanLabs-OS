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
  Job,
  SearchMatch,
  SmbShare,
  SmbShareSpec,
  SmbUser,
  StoreApp,
  StoreEntry,
  StoreSource,
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
  nativeApp('caddy', 'Caddy', 80, 'caddy.service'),
  nativeApp('pm2-teman', 'BensinKu', 3001, 'pm2-teman.service'),
  nativeApp('porto', 'My Portofolio', 3000, 'porto-diopratama.service'),
]

let mockSources: StoreSource[] = [
  { id: 'casaos', name: 'CasaOS', url: 'https://casaos.app/store/main.zip', apps: 180, updated: new Date().toISOString() },
  { id: 'big-bear-casaos', name: 'big-bear-casaos', url: 'https://github.com/bigbeartechworld/big-bear-casaos/archive/refs/heads/master.zip', apps: 491, updated: new Date().toISOString() },
]

const MOCK_STORE_EXTRA: StoreEntry[] = [
  ['Memos', 'Productivity', 'A lightweight, self-hosted memo hub.'],
  ['Grafana', 'Developer', 'Dashboards for all your metrics.'],
  ['AdGuard Home', 'Networking', 'Network-wide ads and trackers blocking.'],
  ['Ollama', 'AI', 'Run large language models locally.'],
  ['Open WebUI', 'AI', 'A friendly web interface for LLMs.'],
  ['Actual Budget', 'Finance', 'A local-first personal finance tool.'],
  ['Mastodon', 'Social', 'Your own corner of the fediverse.'],
  ['Syncthing', 'Cloud', 'Continuous file synchronisation.'],
  ['Calibre-web', 'Media', 'Browse and read your ebook library.'],
  ['Wiki.js', 'Others', 'A modern and powerful wiki app.'],
].map(([name, category, tagline]) => ({
  id: `big-bear-casaos.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  category,
  tagline,
  iconUrl: '',
  source: 'big-bear-casaos',
  port: 8000,
}))

// App Settings: edited compose files, pretend update checks, and the jobs they start.
const mockCompose: Record<string, string> = {}
const mockUpdates: Record<string, true> = { jellyfin: true, nextcloud: true }
const mockJobs: Record<string, Job> = {}

function runMockJob(kind: string, title: string, lines: string[], ms: number) {
  mockJobs[kind] = { kind, title, running: true, started: new Date().toISOString(), exit: 0, log: [`$ docker compose up -d`] }
  void delay(ms).then(() => {
    mockJobs[kind] = { ...mockJobs[kind], running: false, exit: 0, log: [...mockJobs[kind].log, ...lines] }
  })
  return kind
}

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

/** A made-up app screenshot for the store pages (an SVG data URL). */
function mockScreenshot(scheme: number) {
  const hue = [222, 280, 168][scheme]
  const posters = Array.from({ length: 12 }, (_, k) => {
    const x = 300 + (k % 6) * 160
    const y = 400 + Math.floor(k / 6) * 200
    const h = (hue + k * 23) % 360
    return `<defs><linearGradient id='p${k}' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h},70%,62%)'/><stop offset='1' stop-color='hsl(${(h + 40) % 360},65%,38%)'/></linearGradient></defs><rect x='${x}' y='${y}' width='136' height='180' rx='12' fill='url(#p${k})'/>`
  }).join('')
  const nav = [0, 1, 2, 3, 4].map(k => `<rect x='32' y='${120 + k * 48}' width='${k ? 150 : 190}' height='14' rx='7' fill='hsl(${hue},25%,${k ? 40 : 70}%)'/>`).join('')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='800'><rect width='1280' height='800' fill='hsl(${hue},30%,10%)'/><rect width='260' height='800' fill='hsl(${hue},28%,14%)'/><circle cx='52' cy='56' r='18' fill='hsl(${hue},80%,60%)'/><rect x='82' y='48' width='120' height='16' rx='8' fill='hsl(${hue},20%,75%)'/>${nav}<defs><linearGradient id='hero' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='hsl(${hue},75%,45%)'/><stop offset='1' stop-color='hsl(${(hue + 60) % 360},70%,35%)'/></linearGradient></defs><rect x='300' y='40' width='940' height='320' rx='20' fill='url(#hero)'/><rect x='340' y='230' width='360' height='30' rx='15' fill='rgba(255,255,255,0.9)'/><rect x='340' y='280' width='240' height='16' rx='8' fill='rgba(255,255,255,0.6)'/><rect x='340' y='312' width='120' height='30' rx='15' fill='hsl(${hue},90%,70%)'/>${posters}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

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

  async appStore() {
    const fromStores: StoreEntry[] = [
      ...catalog.map(c => ({ id: `casaos.${c.id}`, name: c.name, tagline: c.description, category: c.category === 'Smart Home' ? 'Home' : c.category, iconUrl: '', source: 'CasaOS', port: c.port })),
      ...MOCK_STORE_EXTRA,
    ]
    const apps = fromStores.map(a => {
      const plain = a.id.split('.').slice(1).join('.')
      return installed.some(i => i.id === plain) ? { ...a, installedAs: plain } : a
    })
    return {
      syncing: false,
      sources: mockSources,
      apps: apps.sort((a, b) => a.name.localeCompare(b.name)),
    }
  },

  async storeApp(id: string) {
    const entry = (await this.appStore()).apps.find(a => a.id === id)
    if (!entry) throw new Error('app not in any store')
    const appId = id.split('.').slice(1).join('.')
    const port = entry.port ?? 8080
    return {
      ...entry,
      description: `${entry.tagline} This is the long description from the store, with what the app does and how to use it.`,
      // Stand-in screenshots: a media library (sidebar, banner, rows of posters) in three colour schemes.
      screenshots: [0, 1, 2].map(mockScreenshot),
      author: 'BigBearTechWorld',
      architectures: ['amd64', 'arm64'],
      tips: entry.name === 'Jellyfin' ? 'Put your media in /DATA/Media first; Jellyfin finds it on its first scan.' : undefined,
      yaml: `services:\n  ${appId}:\n    image: ${appId}/${appId}:latest\n    container_name: ${appId}\n    ports:\n      - target: 80\n        published: "${port}"\n        protocol: tcp\n    volumes:\n      - type: bind\n        source: /DATA/AppData/${appId}/config\n        target: /config\n    environment:\n      PUID: "1000"\n      TZ: Asia/Jakarta\nx-casaos:\n  main: ${appId}\n  port_map: "${port}"\n`,
      service: appId,
      services: [appId],
      appId,
      spec: {
        image: `${appId}/${appId}`,
        tag: 'latest',
        title: entry.name,
        iconUrl: entry.iconUrl,
        webUi: { scheme: 'http' as const, port, path: '/' },
        network: '',
        ports: [{ host: port, container: 80, protocol: 'tcp' as const }],
        volumes: [{ host: `/DATA/AppData/${appId}/config`, container: '/config', readOnly: false }],
        env: [
          { key: 'PUID', value: '1000' },
          { key: 'TZ', value: 'Asia/Jakarta' },
        ],
        devices: [],
        command: '',
        restart: 'unless-stopped' as const,
        privileged: false,
        memoryMb: 0,
        cpuShares: 0,
        capAdd: [],
        hostname: '',
      },
    }
  },

  async installStoreApp(id: string, body: { appId: string; spec?: CustomAppSpec }) {
    await delay(400)
    const entry = (await this.appStore()).apps.find(a => a.id === id)!
    const appId = body.appId
    installed = [
      ...installed,
      {
        id: appId,
        name: body.spec?.title || entry.name,
        icon: 'boxes',
        iconUrl: entry.iconUrl || undefined,
        color: ['#64d2ff', '#2f6bff'],
        category: entry.category,
        description: entry.tagline,
        port: body.spec?.webUi.port || entry.port || null,
        path: '/',
        scheme: 'http',
        status: 'installing',
        source: 'temanlabs',
        containers: 1,
        canUninstall: true,
      },
    ]
    void delay(3000).then(() => setStatus(appId, 'running'))
    return appId
  },

  async refreshStores() {},

  async setStoreSources(urls: string[]) {
    mockSources = urls.map(url => mockSources.find(s => s.url === url) ?? { id: url, name: new URL(url).host, url, apps: 0, error: 'not downloaded in mock mode' })
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

  async appConfig(id: string) {
    const app = installed.find(a => a.id === id)
    if (!app) throw new Error('app not found')
    if (app.source === 'native') {
      return { source: app.source, editable: false, reason: 'This app runs outside Docker, so it has no container settings.', canUpdate: false, containers: [], dataDirs: [] }
    }
    const port = app.port ?? 8080
    const yaml = mockCompose[id] ?? `services:\n  ${id}:\n    image: ${id}/${id}:latest\n    container_name: ${id}\n    restart: unless-stopped\n    ports:\n      - "${port}:80"\n    volumes:\n      - /DATA/AppData/${id}/config:/config\n    environment:\n      TZ: Asia/Jakarta\n`
    return {
      source: app.source,
      editable: true,
      canUpdate: true,
      file: `/var/lib/temanlabsos/apps/${id}/docker-compose.yml`,
      yaml,
      service: id,
      services: [id],
      spec: {
        image: `${id}/${id}`,
        tag: 'latest',
        title: app.name,
        iconUrl: app.iconUrl ?? '',
        webUi: { scheme: 'http' as const, port, path: app.path },
        network: 'bridge',
        ports: [{ host: port, container: 80, protocol: 'tcp' as const }],
        volumes: [{ host: `/DATA/AppData/${id}/config`, container: '/config', readOnly: false }],
        env: [{ key: 'TZ', value: 'Asia/Jakarta' }],
        devices: [],
        command: '',
        restart: 'unless-stopped' as const,
        privileged: false,
        memoryMb: 0,
        cpuShares: 0,
        capAdd: [],
        hostname: '',
      },
      containers: [{ id: `${id}0123456789ab`, name: id, service: id, state: app.status === 'running' ? 'running' : 'exited', image: `${id}/${id}:latest` }],
      dataDirs: [`/DATA/AppData/${id}`],
    }
  },

  async saveAppConfig(id: string, body: { yaml?: string; spec?: CustomAppSpec }) {
    await delay(300)
    if (body.yaml !== undefined) mockCompose[id] = body.yaml
    if (body.spec) {
      const spec = body.spec
      installed = installed.map(a => (a.id === id ? { ...a, name: spec.title || a.name, port: spec.webUi.port || a.port } : a))
    }
    return { job: runMockJob(`app-${id}`, 'Applying settings', [' Container recreated', ' Container started'], 1500) }
  },

  async updateApp(id: string) {
    delete mockUpdates[id]
    return { job: runMockJob(`app-${id}`, 'Updating', ['latest: Pulling from library', 'Status: Downloaded newer image', ' Container recreated'], 2500) }
  },

  async appUpdates() {
    const apps: Record<string, { available: boolean; images: { image: string; available: boolean; checked: string }[] }> = {}
    for (const a of installed) {
      if (a.source === 'native') continue
      const available = !!mockUpdates[a.id]
      apps[a.id] = { available, images: [{ image: `${a.id}/${a.id}:latest`, available, checked: new Date().toISOString() }] }
    }
    return { checking: false, checked: new Date().toISOString(), apps }
  },

  async job(kind: string) {
    return mockJobs[kind] ?? mockSystem.job(kind)
  },

  appTerminalUrl: () => null,

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

  async appSignIn() {},
  async appSignOut() {},
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
      { unit: 'caddy.service', description: 'Caddy web server', load: 'loaded', active: 'active', sub: 'running', enabled: 'enabled', mainPid: 1108, memory: 49e6, cpu: Math.random() * 2, since: now - 86400 * 13 },
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
