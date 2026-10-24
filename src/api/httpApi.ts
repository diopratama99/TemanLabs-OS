// Client for the TemanLabsOS server (server/ in this repo). Paths are same-origin: in production
// the Go binary serves this app, and in development Vite proxies /api and /ws to it.
import type {
  CommandBook,
  FileDetails,
  CommandsInfo,
  ConvertInfo,
  ConvertRequest,
  ConvertTask,
  MediaProbe,
  ReleaseStatus,
  CloudInfo,
  FormatFS,
  StorageInfo,
  StoreAppDetails,
  StoreListing,
  AppConfig,
  AppUpdates,
  K8sActionRequest,
  K8sResources,
  K8sStatus,
  AptUpdate,
  BlockDevice,
  Crontab,
  DiskUsage,
  FirewallRule,
  Job,
  LogEntry,
  LogView,
  NetConnection,
  NetInterface,
  SystemAccount,
  SystemGroup,
  SystemTimer,
  TimeInfo,
  UpdatesInfo,
  AppFrame,
  ContainerInfo,
  CustomAppSpec,
  FileEntry,
  InstalledApp,
  ListenPort,
  ProcessInfo,
  ServiceAction,
  ServiceInfo,
  SearchMatch,
  SmbInfo,
  SmbSession,
  SmbShareSpec,
  Session,
  StoreApp,
  SystemStats,
  WallpaperImage,
  Device,
  DeviceInput,
  DeviceStatus,
  FoundDevice,
  RemoteEngine,
} from './types'

/** Fired when any request comes back 401, so the app can show the login screen. */
export const UNAUTHORIZED_EVENT = 'temanlabs:unauthorized'

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface RequestOptions {
  json?: unknown
  body?: BodyInit
  headers?: Record<string, string>
  /** Read the response as text instead of JSON. */
  text?: boolean
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers }
  let body = options.body
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  const res = await fetch(path, { method, headers, body, credentials: 'same-origin' })
  if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // Not JSON; keep the status text.
    }
    throw new ApiError(message, res.status)
  }
  if (res.status === 204 || res.status === 202) return undefined as T
  return (options.text ? res.text() : res.json()) as Promise<T>
}

const query = (params: Record<string, string>) => `?${new URLSearchParams(params)}`

export interface UploadOptions {
  /** Subfolder of dir to put the file in, created as needed ("Photos/2026"). */
  rel?: string
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

export const httpApi = {
  me: () => request<Session>('GET', '/api/me'),
  login: (password: string) => request<Session>('POST', '/api/login', { json: { password } }),
  logout: () => request<void>('POST', '/api/logout'),
  changePassword: (current: string, next: string) => request<void>('POST', '/api/password', { json: { current, next } }),

  getSystemStats: () => request<SystemStats>('GET', '/api/system'),

  getCatalog: () => request<StoreApp[]>('GET', '/api/store'),
  /** Every app in the stores (and the built-in picks), and the stores themselves. */
  appStore: () => request<StoreListing>('GET', '/api/appstore'),
  storeApp: (id: string) => request<StoreAppDetails>('GET', `/api/appstore/apps/${encodeURIComponent(id)}`),
  /** Installs a store app with the reviewed settings; returns the installed app's ID. */
  installStoreApp: async (id: string, body: { appId: string; yaml?: string; service?: string; spec?: CustomAppSpec }) =>
    (await request<{ id: string }>('POST', `/api/appstore/apps/${encodeURIComponent(id)}/install`, { json: body })).id,
  refreshStores: () => request<void>('POST', '/api/appstore/refresh'),
  setStoreSources: (urls: string[]) => request<void>('PUT', '/api/appstore/sources', { json: { urls } }),
  listApps: () => request<InstalledApp[]>('GET', '/api/apps'),
  /** Returns once the install has started; the app shows as "installing" until it finishes. */
  installApp: (id: string) => request<void>('POST', `/api/apps/${encodeURIComponent(id)}/install`),
  /** Removes the app's containers; with deleteData also its volumes and /DATA/AppData folders. */
  uninstallApp: (id: string, deleteData = false) =>
    request<void>('DELETE', `/api/apps/${encodeURIComponent(id)}${deleteData ? '?data=1' : ''}`),
  appConfig: (id: string, service?: string) =>
    request<AppConfig>('GET', `/api/apps/${encodeURIComponent(id)}/config${service ? query({ service }) : ''}`),
  /** Saves the form (spec) or the whole compose file (yaml); the returned job recreates the containers. */
  saveAppConfig: (id: string, body: { yaml?: string; service?: string; spec?: CustomAppSpec }) =>
    request<{ job: string }>('PUT', `/api/apps/${encodeURIComponent(id)}/config`, { json: body }),
  /** Pulls newer images and recreates the app's containers, as a job. */
  updateApp: (id: string) => request<{ job: string }>('POST', `/api/apps/${encodeURIComponent(id)}/update`),
  /** Which apps have newer images; refresh asks the registries again now. */
  appUpdates: (refresh = false) => request<AppUpdates>('GET', `/api/apps/updates${refresh ? '?refresh=1' : ''}`),
  setAppRunning: (id: string, running: boolean) =>
    request<void>('POST', `/api/apps/${encodeURIComponent(id)}/${running ? 'start' : 'stop'}`),
  /** Starts a Manual Install; the new app shows as "installing" under the returned ID. */
  installCustomApp: async (spec: CustomAppSpec) =>
    (await request<{ id: string }>('POST', '/api/apps/custom', { json: spec })).id,
  listNetworks: () => request<string[]>('GET', '/api/networks'),
  /** How to show an app in a window: directly, or through the server's proxy (proxy: always). */
  /** Checks a Basic login with the app and keeps it on the server; the proxy sends it from then on. */
  appSignIn: (id: string, username: string, password: string) =>
    request<void>('PUT', `/api/apps/${encodeURIComponent(id)}/signin`, { json: { username, password } }),
  appSignOut: (id: string) => request<void>('DELETE', `/api/apps/${encodeURIComponent(id)}/signin`),
  appFrame: (id: string, proxy = false) => request<AppFrame>('GET', `/api/apps/${encodeURIComponent(id)}/frame${proxy ? '?proxy=1' : ''}`),

  listContainers: () => request<ContainerInfo[]>('GET', '/api/containers'),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart') =>
    request<void>('POST', `/api/containers/${encodeURIComponent(id)}/${action}`),
  containerLogs: (id: string, tail = 300) =>
    request<string>('GET', `/api/containers/${encodeURIComponent(id)}/logs${query({ tail: String(tail) })}`, { text: true }),

  listPorts: () => request<ListenPort[]>('GET', '/api/ports'),
  listServices: () => request<ServiceInfo[]>('GET', '/api/services'),
  serviceAction: (unit: string, action: ServiceAction) =>
    request<void>('POST', `/api/services/${encodeURIComponent(unit)}/${action}`),
  serviceLogs: (unit: string, lines = 300) =>
    request<string>('GET', `/api/services/${encodeURIComponent(unit)}/logs${query({ lines: String(lines) })}`, { text: true }),
  listProcesses: () => request<ProcessInfo[]>('GET', '/api/processes'),

  k8s: () => request<K8sStatus>('GET', '/api/k8s'),
  installK8s: () => request<void>('POST', '/api/k8s/install'),
  uninstallK8s: () => request<void>('POST', '/api/k8s/uninstall'),
  k8sResources: (namespace: string) => request<K8sResources>('GET', `/api/k8s/resources${query({ namespace })}`),
  /** Runs a change; resolves to kubectl's output and the equivalent command. */
  k8sAction: (a: K8sActionRequest) => request<{ output: string; command: string }>('POST', '/api/k8s/action', { json: a }),
  k8sText: (view: 'logs' | 'describe' | 'yaml', kind: string, name: string, namespace: string) =>
    request<{ text: string; command: string }>('GET', `/api/k8s/text/${view}${query({ kind, name, namespace })}`),

  job: (kind: string) => request<Job>('GET', `/api/jobs/${encodeURIComponent(kind)}`),
  updates: () => request<UpdatesInfo>('GET', '/api/updates'),
  checkUpdates: () => request<void>('POST', '/api/updates/check'),
  /** Upgrades everything, or just the named packages. */
  installUpdates: (packages: AptUpdate['name'][] = []) => request<void>('POST', '/api/updates/install', { json: { packages } }),
  power: (action: 'restart' | 'shutdown') => request<void>('POST', `/api/power/${action}`),
  timeInfo: () => request<TimeInfo>('GET', '/api/time'),
  setTime: (change: { timezone?: string; ntp?: boolean; hostname?: string }) => request<void>('POST', '/api/time', { json: change }),

  logs: (params: { view?: LogView; unit?: string; since?: string; q?: string; lines?: number; after?: string }) => {
    const p: Record<string, string> = {}
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== 'all') p[k] = String(v)
    return request<{ entries: LogEntry[]; cursor: string }>('GET', `/api/logs${query(p)}`)
  },

  disks: () => request<BlockDevice[]>('GET', '/api/disks'),
  mountDisk: (device: string, mount: boolean) => request<{ message: string }>('POST', '/api/disks/mount', { json: { device, mount } }),
  /** Mounts a partition now and at every startup (via /etc/fstab), or stops doing so. */
  setAutomount: (device: string, enable: boolean, target?: string) =>
    request<void>('POST', '/api/disks/automount', { json: { device, enable, target } }),
  /** Erases a drive or partition (confirm = its name), as job "disk-format". */
  formatDisk: (body: { device: string; fstype: FormatFS; label: string; confirm: string; mount: boolean }) =>
    request<{ job: string; target: string }>('POST', '/api/disks/format', { json: body }),
  ejectDisk: (device: string) => request<void>('POST', '/api/disks/eject', { json: { device } }),
  storage: () => request<StorageInfo>('GET', '/api/storage'),
  mergeStorage: (name: string, branches: string[]) => request<void>('POST', '/api/storage/merge', { json: { name, branches } }),
  unmergeStorage: (name: string) => request<void>('DELETE', `/api/storage/merge/${encodeURIComponent(name)}`),
  installMergerfs: () => request<{ job: string }>('POST', '/api/storage/mergerfs'),
  setUsbAutomount: (enable: boolean) => request<void>('PUT', '/api/storage/usb', { json: { enable } }),
  cloud: () => request<CloudInfo>('GET', '/api/cloud'),
  /** Remux: whether ffmpeg is there, what it can make, and the conversion queue. */
  convertInfo: () => request<ConvertInfo>('GET', '/api/convert'),
  probeMedia: (path: string) => request<MediaProbe>('GET', `/api/convert/probe${query({ path })}`),
  startConvert: (body: ConvertRequest) => request<ConvertTask>('POST', '/api/convert', { json: body }),
  /** Cancels a queued or running conversion, or removes a finished one from the list. */
  cancelConvert: (id: string) => request<void>('DELETE', `/api/convert/tasks/${encodeURIComponent(id)}`),
  clearConverts: () => request<void>('DELETE', '/api/convert/tasks'),
  /** apt-get install ffmpeg, as job "apt". */
  installFFmpeg: () => request<{ job: string }>('POST', '/api/convert/ffmpeg'),
  /** The command book: which of these programs exist, the apps, saved commands, shell history. */
  commandsInfo: (tools: string[]) => request<CommandsInfo>('GET', `/api/commands${query({ tools: tools.join(',') })}`),
  saveCommandBook: (book: CommandBook) => request<void>('PUT', '/api/commands/book', { json: book }),
  /** Where a video was left off (0 when it wasn't, or was watched to the end). */
  mediaPosition: (path: string) => request<{ position: number; duration: number }>('GET', `/api/media/position${query({ path })}`),
  /** Remembers where a video is; position 0 forgets it. */
  saveMediaPosition: (path: string, position: number, duration: number) =>
    request<void>('PUT', '/api/media/position', { json: { path, position, duration } }),
  /** Devices: the other computers, and the remote desktop engine that shows their screens. */
  devices: () => request<{ devices: Device[]; engine: RemoteEngine }>('GET', '/api/devices'),
  createDevice: (body: DeviceInput) => request<Device>('POST', '/api/devices', { json: body }),
  updateDevice: (id: string, body: DeviceInput) => request<Device>('PUT', `/api/devices/${encodeURIComponent(id)}`, { json: body }),
  deleteDevice: (id: string) => request<void>('DELETE', `/api/devices/${encodeURIComponent(id)}`),
  /** Which devices are on, and which have their screen sharing on (takes a second or so). */
  deviceStatus: () => request<Record<string, DeviceStatus>>('GET', '/api/devices/status'),
  wakeDevice: (id: string) => request<void>('POST', `/api/devices/${encodeURIComponent(id)}/wake`),
  /** Sweeps the local network for computers (about ten seconds). */
  discoverDevices: () => request<FoundDevice[]>('GET', '/api/devices/discover'),
  /** A switched-on device's MAC address, from its IP. */
  lookupMac: (host: string) => request<{ mac: string }>('GET', `/api/devices/mac${query({ host })}`),
  /** Downloads and starts the remote desktop engine in the background. */
  installRemoteEngine: () => request<void>('POST', '/api/devices/engine'),
  /** WebSocket URL for a device's screen (Guacamole protocol), or null without a server. */
  remoteUrl: (id: string): string | null => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${scheme}://${location.host}/ws/remote/${encodeURIComponent(id)}`
  },
  releaseStatus: (refresh = false) => request<ReleaseStatus>('GET', `/api/system/release${refresh ? '?refresh=1' : ''}`),
  /** Downloads the newest release, checks it and restarts the server into it (job "self-update"). */
  installRelease: () => request<{ job: string }>('POST', '/api/system/release/install'),
  /** Starts a browser sign-in; open url, then pass the page's address to addCloud as redirect. */
  cloudSignIn: (type: string) => request<{ session: string; url: string }>('POST', '/api/cloud/auth', { json: { type } }),
  addCloud: (body: { name: string; type: string; params?: Record<string, string>; session?: string; redirect?: string }) =>
    request<void>('POST', '/api/cloud', { json: body }),
  cloudAction: (name: string, action: 'mount' | 'unmount' | 'restart') =>
    request<void>('POST', `/api/cloud/${encodeURIComponent(name)}/${action}`),
  removeCloud: (name: string) => request<void>('DELETE', `/api/cloud/${encodeURIComponent(name)}`),
  diskUsage: (path: string, fresh = false) =>
    request<DiskUsage>('GET', `/api/disks/usage${query(fresh ? { path, fresh: '1' } : { path })}`),

  interfaces: () => request<NetInterface[]>('GET', '/api/network/interfaces'),
  netTool: (tool: 'ping' | 'traceroute', host: string, count = 4) =>
    request<{ output: string; ok: boolean }>('POST', '/api/network/tool', { json: { tool, host, count } }),
  dnsLookup: (name: string) =>
    request<{ name: string; records: Record<string, string[]>; resolvers: string[] }>('GET', `/api/network/dns${query({ name })}`),
  connections: () => request<NetConnection[]>('GET', '/api/network/connections'),
  firewall: () => request<{ enabled: boolean; rules: FirewallRule[] }>('GET', '/api/firewall'),
  changeFirewall: (change: { op: 'enable' | 'disable' | 'add' | 'delete'; action?: string; port?: string; protocol?: string; from?: string; number?: number }) =>
    request<void>('POST', '/api/firewall', { json: change }),

  cron: () => request<{ crontabs: Crontab[]; timers: SystemTimer[] }>('GET', '/api/cron'),
  saveCron: (tab: Crontab) => request<void>('PUT', `/api/cron/${encodeURIComponent(tab.user)}`, { json: tab }),
  runCron: (user: string, command: string) => request<{ output: string; exit: number }>('POST', '/api/cron/run', { json: { user, command } }),

  accounts: () => request<{ users: SystemAccount[]; groups: SystemGroup[] }>('GET', '/api/users'),
  createAccount: (account: { name: string; fullName: string; password: string; admin: boolean }) =>
    request<void>('POST', '/api/users', { json: account }),
  changeAccount: (name: string, change: { action: string; password?: string; admin?: boolean; group?: string; fullName?: string }) =>
    request<void>('POST', `/api/users/${encodeURIComponent(name)}`, { json: change }),
  deleteAccount: (name: string, removeHome: boolean) =>
    request<void>('DELETE', `/api/users/${encodeURIComponent(name)}${removeHome ? '?removeHome=1' : ''}`),

  smbInfo: () => request<SmbInfo>('GET', '/api/smb'),
  smbStatus: () => request<{ sessions: SmbSession[]; openFiles?: number }>('GET', '/api/smb/status'),
  restartSmb: () => request<void>('POST', '/api/smb/restart'),
  /** Creates a share, or updates the one called editing. */
  saveShare: (spec: SmbShareSpec, editing?: string) =>
    editing
      ? request<void>('PUT', `/api/smb/shares/${encodeURIComponent(editing)}`, { json: spec })
      : request<void>('POST', '/api/smb/shares', { json: spec }),
  deleteShare: (name: string) => request<void>('DELETE', `/api/smb/shares/${encodeURIComponent(name)}`),
  addSmbUser: (name: string, password: string) => request<void>('POST', '/api/smb/users', { json: { name, password } }),
  smbUserAction: (name: string, action: 'password' | 'enable' | 'disable' | 'remove', password?: string) =>
    request<void>('POST', `/api/smb/users/${encodeURIComponent(name)}/${action}`, password ? { json: { password } } : {}),
  /** SIGTERM, or SIGKILL with force. */
  killProcess: (pid: number, force = false) =>
    request<void>('POST', `/api/processes/${pid}/kill${force ? '?force=1' : ''}`),

  listWallpapers: () => request<WallpaperImage[]>('GET', '/api/wallpapers'),
  uploadWallpaper: (image: Blob) => {
    const form = new FormData()
    form.append('file', image, 'wallpaper')
    return request<WallpaperImage>('POST', '/api/wallpapers', { body: form })
  },
  /** Copies an image from the file manager into the wallpapers. */
  wallpaperFromFile: (path: string) => request<WallpaperImage>('POST', '/api/wallpapers/from-file', { json: { path } }),
  deleteWallpaper: (name: string) => request<void>('DELETE', `/api/wallpapers/${encodeURIComponent(name)}`),

  listFiles: (path: string) => request<FileEntry[]>('GET', `/api/files${query({ path })}`),
  createFolder: async (path: string) => (await request<{ name: string }>('POST', '/api/files/folders', { json: { path } })).name,
  createFile: async (path: string) => (await request<{ name: string }>('POST', '/api/files', { json: { path } })).name,
  renameEntry: (path: string, from: string, to: string) =>
    request<void>('POST', '/api/files/rename', { json: { path, from, to } }),
  /** Copies (or with move, moves) paths into the folder to; resolves to the names they got there. */
  copyEntries: async (paths: string[], to: string, move = false) =>
    (await request<{ names: string[] }>('POST', '/api/files/copy', { json: { paths, to, move } })).names,
  deleteEntry: (path: string, name: string) => request<void>('DELETE', `/api/files${query({ path, name })}`),
  readFile: (path: string) => request<string>('GET', `/api/files/content${query({ path })}`, { text: true }),
  writeFile: (path: string, text: string) =>
    request<void>('PUT', `/api/files/content${query({ path })}`, {
      body: text,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  /** URL that streams a file (with seeking), for images, video and audio; download forces a save. */
  rawFileUrl: (path: string, download = false) => `/api/files/raw${query(download ? { path, download: '1' } : { path })}`,
  /** A small JPEG preview of a photo or video, or null when there's no server. version changes with the file. */
  /** Get Info: size, dates, owner, permissions, the drive, and media details. */
  fileInfo: (path: string) => request<FileDetails>('GET', `/api/files/info${query({ path })}`),
  thumbUrl: (path: string, version: string): string | null => `/api/files/thumb${query({ path, v: version })}`,
  listTree: (path: string) => request<string[]>('GET', `/api/files/tree${query({ path })}`),
  searchFiles: (q: string, root = '/DATA') => request<SearchMatch[]>('GET', `/api/files/search${query({ q, path: root })}`),
  /** Uploads one file into dir (or dir/rel for folder uploads); resolves to its final name. */
  uploadFile: (dir: string, file: File, options: UploadOptions = {}) =>
    new Promise<string>((resolve, reject) => {
      // XHR rather than fetch: only XHR reports upload progress.
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/files/upload${query(options.rel ? { path: dir, rel: options.rel } : { path: dir })}`)
      xhr.upload.onprogress = e => options.onProgress?.(e.loaded, e.total)
      xhr.onload = () => {
        if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
        let data: { name?: string; error?: string } = {}
        try {
          data = JSON.parse(xhr.responseText)
        } catch {
          // Not JSON.
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.name ?? file.name)
        else reject(new ApiError(data.error ?? (xhr.statusText || `Upload failed (${xhr.status})`), xhr.status))
      }
      xhr.onerror = () => reject(new Error(`Couldn’t upload ${file.name}: the connection failed.`))
      xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
      options.signal?.addEventListener('abort', () => xhr.abort())
      const form = new FormData()
      form.append('file', file)
      xhr.send(form)
    }),
  /** Creates dir/rel (for empty folders in an uploaded folder). */
  makeFolders: (dir: string, rel: string) =>
    request<void>('POST', `/api/files/upload${query({ path: dir, rel, mkdir: '1' })}`),

  /** A shell inside one of an app's containers (docker exec). */
  appTerminalUrl: (id: string, container: string, cols: number, rows: number): string | null => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${scheme}://${location.host}/ws/apps/${encodeURIComponent(id)}/terminal${query({ container, cols: String(cols), rows: String(rows) })}`
  },
  /** WebSocket URL for a terminal session, or null when there is no server to connect to. */
  terminalUrl: (cols: number, rows: number): string | null => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${scheme}://${location.host}/ws/terminal${query({ cols: String(cols), rows: String(rows) })}`
  },
}

export type Api = typeof httpApi
