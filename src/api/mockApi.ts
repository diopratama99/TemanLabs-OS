// In-memory stand-in for the server, used only by `npm run dev:mock` (VITE_MOCK=1) to work on
// the UI without a backend. Production builds talk to the real server through httpApi.
import { fileKind, isTextFile } from '../lib/fileTypes'
import { ApiError, type Api, type UploadOptions } from './httpApi'
import { catalog, contents, files, initialInstalled, nextStats } from './mock'
import { mockK8s, mockSystem } from './mockSystem'
import type {
  AppStatus,
  CustomAppSpec,
  FileEntry,
  BrowseList,
  CookieSite,
  DownloadItem,
  DownloadMode,
  Downloads,
  MediaTools,
  RecChannel,
  Recorder,
  Recording,
  BackupApp,
  BackupDestination,
  BackupFile,
  BackupPlan,
  BackupPlanSettings,
  BackupVersion,
  BackupsInfo,
  ShareLink,
  TagColor,
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

let mockLinks: ShareLink[] = []
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const mockMedia: { tools: boolean; galleryDev: boolean; items: DownloadItem[]; channels: RecChannel[]; recordings: Recording[] } = {
  tools: false,
  galleryDev: false,
  items: [
    { id: 'd1', url: 'https://www.youtube.com/watch?v=abc', mode: 'video', quality: '1080', playlist: false, folder: '/DATA/Downloads', status: 'done', title: 'Building a home server in 2026', site: 'Youtube', uploader: 'Tech Lab', percent: 100, size: '412.6MiB', files: ['/DATA/Downloads/Building a home server in 2026 [abc].mp4'], added: ago(3600e3), finished: ago(3500e3) },
    { id: 'd2', url: 'https://www.instagram.com/p/xyz/', mode: 'video', quality: 'best', playlist: false, folder: '/DATA/Downloads', status: 'done', title: 'xyz_1.jpg', site: 'instagram.com', percent: 100, count: 4, files: ['/DATA/Downloads/xyz_1.jpg', '/DATA/Downloads/xyz_2.jpg', '/DATA/Downloads/xyz_3.jpg', '/DATA/Downloads/xyz_4.jpg'], added: ago(1800e3), finished: ago(1790e3) },
    { id: 'd3', url: 'https://x.com/someone/status/1', mode: 'video', quality: 'best', playlist: false, folder: '/DATA/Downloads', status: 'failed', site: 'x.com', percent: 0, files: [], error: 'This post is from a suspended account', added: ago(600e3) },
  ],
  channels: [
    { id: 'c1', url: 'https://www.twitch.tv/teman_live', name: 'teman_live', platform: 'twitch', quality: '1080', auto: true, keepDays: 30, added: ago(9 * 86400e3), live: true, title: 'Building the homelab rack, part 3', checked: ago(40e3), recording: 'r1' },
    { id: 'c2', url: 'https://www.youtube.com/@LofiGirl/live', name: 'LofiGirl', platform: 'youtube', quality: '720', auto: false, keepDays: 0, added: ago(4 * 86400e3), live: true, title: 'lofi hip hop radio 📚 beats to relax/study to', checked: ago(70e3) },
    { id: 'c3', url: 'https://kick.com/someone', name: 'someone', platform: 'kick', quality: 'best', auto: true, keepDays: 7, added: ago(2 * 86400e3), live: false, checked: ago(30e3) },
    { id: 'c4', url: 'https://www.tiktok.com/@creator/live', name: 'creator', platform: 'tiktok', quality: 'best', auto: true, keepDays: 30, added: ago(86400e3), live: false, checked: ago(90e3) },
  ],
  recordings: [
    { id: 'r0', channel: 'c3', title: 'Late night chat', file: '/DATA/Media/Recordings/someone/2026-10-24 22.10 Late night chat.mp4', status: 'done', started: ago(20 * 3600e3), ended: ago(17.5 * 3600e3), bytes: 3.9e9 },
    { id: 'r1', channel: 'c1', title: 'Building the homelab rack, part 3', file: '/DATA/Media/Recordings/teman_live/2026-10-25 01.05 Building the homelab rack, part 3.ts', status: 'recording', started: ago(47 * 60e3), bytes: 1.31e9 },
  ],
}
// Made-up pictures for the mock profile and channel lists.
const mockThumb = (i: number, wide: boolean) => {
  const [w, h] = wide ? [320, 180] : [300, 300]
  const a = (i * 47) % 360
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${a},70%,68%)'/><stop offset='1' stop-color='hsl(${(a + 70) % 360},65%,38%)'/></linearGradient></defs><rect width='${w}' height='${h}' fill='url(#g)'/><circle cx='${60 + ((i * 37) % (w - 120))}' cy='${50 + ((i * 53) % (h - 100))}' r='${24 + ((i * 11) % 36)}' fill='rgba(255,255,255,.35)'/><path d='M0 ${h} L${w * 0.35} ${h * 0.55} L${w * 0.6} ${h * 0.8} L${w * 0.8} ${h * 0.6} L${w} ${h} Z' fill='rgba(0,0,0,.25)'/></svg>`,
  )}`
}
const IMAGE_FILE = /\.(jpe?g|png|webp|gif|heic)$/i
const VIDEO_FILE = /\.(mp4|mov|mkv|webm)$/i
const pathSeed = (path: string) => [...path].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 0)
const mockLists: Record<string, BrowseList> = {}
let mockCookies: CookieSite[] = [
  { site: 'instagram.com', count: 10, signedIn: true },
  { site: 'pinterest.com', count: 4, signedIn: false },
]

const mockBackup: { installed: boolean; plans: BackupPlan[]; versions: BackupVersion[] } = {
  installed: false,
  plans: [],
  versions: [
    { id: 'a1b2c3d4', time: new Date(Date.now() - 86400e3).toISOString(), paths: ['/DATA/AppData'], host: 'teman-server', mine: true },
    { id: 'e5f6a7b8', time: new Date(Date.now() - 2 * 86400e3).toISOString(), paths: ['/DATA/AppData'], host: 'teman-server', mine: true },
  ],
}
let mockLinkBase = ''
let mockTrash: { id: string; entry: FileEntry; from: string; deleted: string }[] = []
const mockTags: Record<string, TagColor[]> = {}
let mockRecents: string[] = []
const placedMock = (p: string): FileEntry | null => {
  const { dir, name } = splitPath(p)
  const entry = (files[dir] ?? []).find(e => e.name === name)
  return entry ? { ...entry, path: p } : null
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
  async lock() {},
  async unlock(password: string) {
    await delay(300)
    if (!password) throw new Error('Incorrect password.')
  },
  async signedInBrowsers() {
    const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
    return [
      { id: 'a1b2c3d4e5f60718', current: true, created: ago(60 * 26), seen: ago(0), addr: '100.105.105.26', agent: navigator.userAgent },
      { id: 'b2c3d4e5f6071829', current: false, created: ago(60 * 24 * 5), seen: ago(42), addr: '192.168.1.11', agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' },
      { id: 'c3d4e5f607182930', current: false, created: ago(60 * 24 * 12), seen: ago(60 * 30), addr: '100.88.12.4', agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1' },
    ]
  },
  async signOutBrowser() {},
  async signOutOtherBrowsers() {},

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
    const plan = kind.startsWith('backup-') ? mockBackup.plans.find(p => `backup-${p.id}` === kind) : undefined
    if (plan) return { kind, running: plan.running, exit: 0, log: plan.running ? ['40% · 220 MB of 560 MB'] : ['Done.'] }
    if (kind.startsWith('restore-')) return { kind, running: false, exit: 0, log: ['Restoring 1 item(s) to where they came from…', 'Restored.'] }
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
  async restartSmb() {
    await delay(1500)
  },
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

  async backups(): Promise<BackupsInfo> {
    return { installed: mockBackup.installed, installing: false, plans: mockBackup.plans.map(p => ({ ...p })) }
  },
  async installBackups() {
    mockBackup.installed = true
    return { job: 'apt' }
  },
  async recoveryKey() {
    return 'q8Jm2Xr4Lw7Tn0Vb5Yc1Hs9Kd3Fg6Pz'
  },
  async setRecoveryKey() {},
  async backupDestinations(): Promise<BackupDestination[]> {
    return [
      { label: 'HDD_DATA', dest: '/mnt/HDD_DATA/Backups', free: 434e9 },
      { label: 'GoogleDrive', dest: 'rclone:GoogleDrive:Backups', cloud: true },
    ]
  },
  async backupApps(): Promise<BackupApp[]> {
    return [
      { id: 'jellyfin', name: 'Jellyfin', paths: ['/DATA/AppData/jellyfin'] },
      { id: 'nextcloud', name: 'Nextcloud', paths: ['/DATA/AppData/nextcloud'] },
      { id: 'supabase', name: 'Supabase', paths: ['/home/teman/supabase/docker'] },
    ]
  },
  async createBackup(plan: BackupPlanSettings) {
    const p: BackupPlan = { ...plan, id: Math.random().toString(16).slice(2, 14), created: new Date().toISOString(), lastOk: false, running: false, destFree: 434e9 }
    mockBackup.plans.push(p)
    return p
  },
  async updateBackup(id: string, plan: BackupPlanSettings) {
    const i = mockBackup.plans.findIndex(p => p.id === id)
    mockBackup.plans[i] = { ...mockBackup.plans[i], ...plan }
    return mockBackup.plans[i]
  },
  async deleteBackup(id: string) {
    mockBackup.plans = mockBackup.plans.filter(p => p.id !== id)
  },
  async runBackup(id: string) {
    const p = mockBackup.plans.find(x => x.id === id)!
    p.running = true
    setTimeout(() => {
      p.running = false
      p.lastRun = new Date().toISOString()
      p.lastOk = true
      p.lastAdded = 18e6
      p.lastTotal = 560e6
      p.lastFiles = 12840
      mockBackup.versions.unshift({ id: Math.random().toString(16).slice(2, 10).padEnd(8, '0'), time: new Date().toISOString(), paths: ['/DATA/AppData'], host: 'teman-server', mine: true })
    }, 3000)
    return { job: `backup-${id}` }
  },
  async stopBackup(id: string) {
    const p = mockBackup.plans.find(x => x.id === id)
    if (p) p.running = false
  },
  async backupVersions() {
    return [...mockBackup.versions]
  },
  async backupFiles(_id: string, _version: string, path = ''): Promise<BackupFile[]> {
    if (!path) return [{ name: '/DATA/AppData', path: '/DATA/AppData', folder: true }]
    if (path === '/DATA/AppData')
      return ['jellyfin', 'nextcloud', 'n8n'].map(n => ({ name: n, path: `/DATA/AppData/${n}`, folder: true, modified: new Date().toISOString() }))
    return [
      { name: 'config', path: `${path}/config`, folder: true, modified: new Date().toISOString() },
      { name: 'data.db', path: `${path}/data.db`, folder: false, size: 48e6, modified: new Date().toISOString() },
    ]
  },
  async restoreBackup(id: string) {
    return { job: `restore-${id}` }
  },
  async mediaTools(): Promise<MediaTools> {
    return { installed: mockMedia.tools, working: false, galleryDev: mockMedia.galleryDev, versions: mockMedia.tools ? { 'yt-dlp': '2026.10.21', 'gallery-dl': mockMedia.galleryDev ? '1.33.0-dev' : '1.32.17', streamlink: '8.6.2', deno: '2.9.8' } : {} }
  },
  async installMediaTools(opts?: { galleryDev?: boolean }) {
    mockMedia.tools = true
    if (opts?.galleryDev !== undefined) mockMedia.galleryDev = opts.galleryDev
    return { job: 'media-tools' }
  },
  async downloads(): Promise<Downloads> {
    return { folder: '/DATA/Downloads', cookies: mockCookies.length > 0, cookieSites: mockCookies, cookiesAt: mockCookies.length ? ago(3600e3) : undefined, items: [...mockMedia.items].reverse() }
  },
  async addDownloads(body: { urls: string[]; mode: DownloadMode; quality: string; playlist: boolean; folder: string }) {
    const items: DownloadItem[] = body.urls.map(url => ({
      id: Math.random().toString(16).slice(2, 14), url, mode: body.mode, quality: body.quality, playlist: body.playlist, folder: body.folder || '/DATA/Downloads',
      status: 'running', percent: 0, files: [], added: new Date().toISOString(), site: new URL(url).hostname.replace('www.', ''), title: 'Fetching…',
    }))
    mockMedia.items.push(...items)
    for (const it of items) {
      const timer = setInterval(() => {
        it.percent = Math.min(100, it.percent + 17)
        it.title = 'A trip to the mountains'
        it.size = '84.2MiB'
        it.speed = '6.1MiB/s'
        it.eta = '00:09'
        if (it.percent >= 100) {
          clearInterval(timer)
          it.status = 'done'
          it.files = [`${it.folder}/A trip to the mountains [x1].mp4`]
          it.finished = new Date().toISOString()
        }
      }, 700)
    }
    return items
  },
  async downloadAction(id: string, action: 'cancel' | 'retry') {
    const it = mockMedia.items.find(x => x.id === id)
    if (it) it.status = action === 'cancel' ? 'canceled' : 'queued'
  },
  async removeDownload(id: string) {
    mockMedia.items = mockMedia.items.filter(x => x.id !== id)
  },
  async clearDownloads() {
    mockMedia.items = mockMedia.items.filter(x => x.status === 'queued' || x.status === 'running')
  },
  async browseDownloads(body: { url: string; tab?: string; list?: string }): Promise<BrowseList> {
    await new Promise(r => setTimeout(r, 600))
    const prev = body.list ? mockLists[body.list] : undefined
    // A profile the release can't read: the fix is offered.
    if (body.url.includes('raon_lee') && !mockMedia.galleryDev) throw new ApiError("Instagram changed how profiles load, and this version of gallery-dl hasn't caught up yet (Requested user could not be found). Its development version has the fix.", 502, 'galleryDev')
    const yt = /youtube|youtu\.be/.test(body.url)
    const tabs = yt ? ['videos', 'shorts', 'streams'] : ['posts', 'reels', 'stories', 'highlights', 'tagged']
    const tab = prev?.tab ?? (body.tab && tabs.includes(body.tab) ? body.tab : tabs[0])
    const shape: BrowseList['shape'] = ['reels', 'stories', 'shorts'].includes(tab) ? 'tall' : yt ? 'wide' : 'square'
    const wide = shape === 'wide'
    const l: BrowseList = prev ?? {
      id: Math.random().toString(16).slice(2, 10),
      url: body.url,
      title: yt ? 'Tech Lab' : 'Teman Travels',
      uploader: yt ? 'Tech Lab' : 'Teman Travels',
      site: new URL(body.url).hostname.replace('www.', ''),
      shape,
      entries: [],
      more: true,
      handle: yt ? '@TechLab' : '@temantravels',
      avatar: true,
      followers: yt ? 128000 : 8420,
      tabs,
      tab,
    }
    const start = l.entries.length
    for (let i = start; i < start + (tab === 'stories' ? 6 : 24); i++) {
      const video = yt || shape === 'tall' || i % 5 === 2
      l.entries.push({
        index: i,
        kind: video ? 'video' : 'image',
        title: wide ? ['Building a home server in 2026', 'Ten tips for quieter fans', 'Racking it all up', 'What I run at home'][i % 4] + (i > 3 ? ` #${i}` : '') : 'Morning at the lake 🌄',
        thumb: true,
        duration: video ? 30 + ((i * 97) % 900) : undefined,
        date: ago(i * 86400e3).slice(0, 10),
        group: wide || shape === 'tall' ? undefined : `P${Math.floor(i / 2)}`,
        page: yt,
      })
    }
    l.more = tab !== 'stories' && l.entries.length < 72
    mockLists[l.id] = l
    return { ...l, entries: [...l.entries] }
  },
  browseThumbUrl: (list: string, index: number | 'avatar') => mockThumb(index === 'avatar' ? 7 : index, index !== 'avatar' && mockLists[list]?.shape === 'wide'),
  async pickDownloads(list: string, body: { picks: number[]; mode: DownloadMode; quality: string; device: boolean }) {
    const l = mockLists[list]
    // -1: the profile picture.
    const videos = body.picks.filter(i => i >= 0 && l.entries[i].page)
    const files = body.picks.filter(i => i < 0 || !l.entries[i].page)
    const items: DownloadItem[] = [
      ...videos.map(i => ({ url: l.url, title: l.entries[i].title, mode: body.mode as DownloadItem['mode'] })),
      ...(files.length ? [{ url: l.url, title: l.title, mode: 'files' as const, count: files.length }] : []),
    ].map(x => ({ id: Math.random().toString(16).slice(2, 14), quality: body.quality, playlist: false, folder: '/DATA/Downloads', device: body.device, status: 'running', percent: 0, files: [], added: new Date().toISOString(), site: l.site, uploader: l.uploader, ...x }))
    mockMedia.items.push(...items)
    for (const it of items) {
      const timer = setInterval(() => {
        it.percent = Math.min(100, it.percent + 20)
        if (it.percent >= 100) {
          clearInterval(timer)
          it.status = 'done'
          it.files = it.mode === 'files' ? files.map(i => `${it.folder}/P${i}_1.jpg`) : [`${it.folder}/${it.title}.mp4`]
          it.finished = new Date().toISOString()
        }
      }, 600)
    }
    return items
  },
  downloadFileUrl: () => 'data:text/plain,mock',
  async setDownloadFolder() {},
  async setDownloadCookies(_text: string, sites?: string[]) {
    const add = sites ?? ['reddit.com']
    mockCookies = [...mockCookies.filter(c => !add.includes(c.site)), ...add.map(site => ({ site, count: 9, signedIn: site !== 'facebook.com' }))].sort((a, b) => a.site.localeCompare(b.site))
    return { sites: add }
  },
  async checkDownloadCookies() {
    await new Promise(r => setTimeout(r, 700))
    return { ok: true, user: 'temantravels' }
  },
  async removeDownloadCookies(sites?: string[]) {
    mockCookies = sites ? mockCookies.filter(c => !sites.includes(c.site)) : []
  },
  async recorder(): Promise<Recorder> {
    return { folder: '/DATA/Media/Recordings', channels: mockMedia.channels.map(c => ({ ...c })), recordings: [...mockMedia.recordings].reverse() }
  },
  async addChannel(body: { url: string; name: string; quality: string; auto: boolean; keepDays: number }) {
    const c: RecChannel = { id: Math.random().toString(16).slice(2, 14), ...body, name: body.name || new URL(body.url).pathname.split('/').filter(Boolean)[0]?.replace('@', '') || 'channel', platform: new URL(body.url).hostname.replace('www.', '').split('.')[0], added: new Date().toISOString(), live: false, checked: new Date().toISOString() }
    mockMedia.channels.push(c)
    return c
  },
  async updateChannel(id: string, body: { url: string; name: string; quality: string; auto: boolean; keepDays: number }) {
    const c = mockMedia.channels.find(x => x.id === id)
    if (c) Object.assign(c, body)
  },
  async deleteChannel(id: string) {
    mockMedia.channels = mockMedia.channels.filter(c => c.id !== id)
  },
  async channelAction(id: string, action: 'record' | 'stop' | 'check') {
    const c = mockMedia.channels.find(x => x.id === id)
    if (!c) return
    if (action === 'record') {
      if (!c.live) throw new Error(`${c.name} isn't live right now`)
      const rec: Recording = { id: Math.random().toString(16).slice(2, 14), channel: c.id, title: c.title ?? '', file: `/DATA/Media/Recordings/${c.name}/now.ts`, status: 'recording', started: new Date().toISOString(), bytes: 0 }
      mockMedia.recordings.push(rec)
      c.recording = rec.id
    }
    if (action === 'stop' && c.recording) {
      const rec = mockMedia.recordings.find(r => r.id === c.recording)
      if (rec) Object.assign(rec, { status: 'done', ended: new Date().toISOString(), bytes: 412e6, file: rec.file.replace('.ts', '.mp4') })
      c.recording = undefined
    }
  },
  async deleteRecording(id: string) {
    mockMedia.recordings = mockMedia.recordings.filter(r => r.id !== id)
  },
  async setRecorderFolder() {},
  async shareLinks() {
    return { baseUrl: mockLinkBase, links: [...mockLinks] }
  },
  async createShareLink(body: { path: string; upload: boolean; hours: number; password: string }) {
    const { name } = splitPath(body.path)
    const link: ShareLink = {
      id: Math.random().toString(36).slice(2, 14),
      path: body.path,
      name,
      folder: !!files[body.path],
      upload: body.upload,
      created: new Date().toISOString(),
      expires: body.hours ? new Date(Date.now() + body.hours * 3600_000).toISOString() : undefined,
      expired: false,
      hasPassword: !!body.password,
      downloads: 0,
      uploads: 0,
    }
    mockLinks = [link, ...mockLinks]
    return link
  },
  async deleteShareLink(id: string) {
    mockLinks = mockLinks.filter(l => l.id !== id)
  },
  async setShareLinkBase(baseUrl: string) {
    mockLinkBase = baseUrl
  },
  async trash() {
    return mockTrash.map(t => ({ id: t.id, name: t.entry.name, from: t.from, deleted: t.deleted, kind: t.entry.kind, size: t.entry.size }))
  },
  async moveToTrash(paths: string[]) {
    for (const p of paths) {
      const { dir, name } = splitPath(p)
      const entry = (files[dir] ?? []).find(e => e.name === name)
      if (!entry) continue
      files[dir] = (files[dir] ?? []).filter(e => e !== entry)
      mockTrash.unshift({ id: Math.random().toString(16).slice(2, 18), entry, from: dir, deleted: new Date().toISOString() })
    }
  },
  async putBack(ids: string[]) {
    const back: string[] = []
    for (const id of ids) {
      const t = mockTrash.find(x => x.id === id)
      if (!t) continue
      mockTrash = mockTrash.filter(x => x !== t)
      files[t.from] = [...(files[t.from] ?? []), t.entry]
      back.push(`${t.from}/${t.entry.name}`)
    }
    return back
  },
  async deleteFromTrash(id: string) {
    mockTrash = mockTrash.filter(x => x.id !== id)
  },
  async emptyTrash() {
    mockTrash = []
  },
  async fileTags() {
    return { ...mockTags }
  },
  async setFileTags(paths: string[], tags: TagColor[]) {
    for (const p of paths) {
      if (tags.length) mockTags[p] = tags
      else delete mockTags[p]
    }
  },
  async taggedFiles(tag: TagColor) {
    return Object.entries(mockTags)
      .filter(([, t]) => t.includes(tag))
      .map(([p]) => placedMock(p))
      .filter(e => !!e)
  },
  async recentFiles() {
    return mockRecents.map(placedMock).filter(e => !!e)
  },
  async addRecentFile(path: string) {
    mockRecents = [path, ...mockRecents.filter(p => p !== path)].slice(0, 60)
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

  // Mock mode has no file bytes: photos are drawn (so Files and Preview have something to show),
  // other media viewers show their "can't load" state.
  rawFileUrl: (path: string) => (IMAGE_FILE.test(path) ? mockThumb(pathSeed(path), true) : `about:blank#${encodeURIComponent(path)}`),

  thumbUrl: (path: string) => (IMAGE_FILE.test(path) || VIDEO_FILE.test(path) ? mockThumb(pathSeed(path), VIDEO_FILE.test(path)) : null),

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
