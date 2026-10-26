// Mock data for the system utilities (npm run dev:mock), shaped like the real server's answers.
import type {
  CommandBook,
  HardwareInfo,
  AppHealth,
  MovePreview,
  MovedApp,
  HistoryData,
  HistoryPoint,
  HistoryRange,
  StartupApp,
  AdblockStatus,
  Device,
  DeviceInput,
  DeviceStatus,
  FoundDevice,
  RemoteEngine,
  FileDetails,
  CommandsInfo,
  ConvertInfo,
  ConvertRequest,
  ConvertTask,
  MediaProbe,
  K8sActionRequest,
  K8sPod,
  K8sResources,
  K8sService,
  K8sStatus,
  K8sWorkload,
  AptUpdate,
  BlockDevice,
  TrueNasApp,
  Router,
  RouterInput,
  RoutersInfo,
  RouterSearch,
  ZfsInfo,
  ZfsPool,
  ZfsSnapshot,
  Crontab,
  FirewallRule,
  Job,
  LogEntry,
  LogView,
  SystemAccount,
  SystemGroup,
} from './types'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const now = () => Date.now()

let aptJob: Job = { kind: 'apt', running: false, log: [] }
let updates: AptUpdate[] = [
  { name: 'openssl', current: '3.0.13-0ubuntu3.5', version: '3.0.13-0ubuntu3.6', origin: 'noble-security', security: true },
  { name: 'linux-image-generic', current: '6.8.0-79', version: '6.8.0-85', origin: 'noble-updates', security: false },
  { name: 'docker-ce', current: '27.3.1', version: '27.4.0', origin: 'noble', security: false },
  { name: 'tzdata', current: '2025a', version: '2025b', origin: 'noble-updates', security: false },
]

const sources = ['systemd', 'sshd', 'dockerd', 'caddy', 'kernel', 'sudo', 'cron']
const messages = [
  'Started Session 42 of User teman.',
  'Accepted publickey for teman from 192.168.1.11 port 52114',
  'Container temanlabs-jellyfin health check passed',
  'proxy: GET /v1/apps 200',
  'EXT4-fs (sda1): mounted filesystem with ordered data mode',
  'pam_unix(sudo:session): session opened for user root',
  '(teman) CMD (/usr/bin/python3 /home/teman/monitor_server.py)',
]
let logCounter = 0
const makeLog = (i: number): LogEntry => ({
  time: now() - (300 - i) * 4000,
  priority: i % 17 === 0 ? 3 : i % 11 === 0 ? 4 : 6,
  source: sources[i % sources.length],
  message: messages[i % messages.length],
})

let accounts: SystemAccount[] = [
  { name: 'root', uid: 0, home: '/root', shell: '/bin/bash', groups: ['root'], admin: true, locked: true, noLogin: false, protected: true },
  {
    name: 'teman',
    uid: 1000,
    fullName: 'Teman Labs',
    home: '/home/teman',
    shell: '/bin/bash',
    groups: ['teman', 'adm', 'sudo', 'docker'],
    admin: true,
    locked: false,
    noLogin: false,
    protected: true,
  },
]
const groups: SystemGroup[] = ['adm', 'docker', 'sudo', 'users', 'video', 'plugdev'].map((name, i) => ({ name, gid: 100 + i, members: [] }))

let crontabs: Crontab[] = [
  {
    user: 'teman',
    tasks: [
      { name: 'Server monitor', schedule: '*/30 * * * *', command: '/usr/bin/python3 /home/teman/monitor_server.py', enabled: true },
      { schedule: '0 3 * * *', command: '/home/teman/backup.sh >> /home/teman/backup.log 2>&1', enabled: false },
    ],
  },
  { user: 'root', tasks: [] },
]

let firewall = { enabled: false, rules: [] as FirewallRule[] }

const disks: BlockDevice[] = [
  {
    name: 'nvme0n1',
    path: '/dev/nvme0n1',
    size: 256e9,
    type: 'disk',
    model: 'ADATA SX6000LNP',
    tran: 'nvme',
    rota: false,
    rm: false,
    smart: { passed: true, temperature: 46, powerOnHours: 10323, powerCycles: 3613, wearPercent: 16 },
    children: [
      { name: 'nvme0n1p1', path: '/dev/nvme0n1p1', size: 1.1e9, type: 'part', fstype: 'vfat', mountpoints: ['/boot/efi'], rota: false, rm: false, fsused: 6e6, fsavail: 1.09e9 },
      { name: 'nvme0n1p2', path: '/dev/nvme0n1p2', size: 2e9, type: 'part', fstype: 'ext4', mountpoints: ['/'], rota: false, rm: false, fsused: 102e9, fsavail: 129e9 },
    ],
  },
  {
    name: 'sda',
    path: '/dev/sda',
    size: 500e9,
    type: 'disk',
    model: 'ST9500325AS',
    tran: 'sata',
    rota: true,
    rm: false,
    smart: { passed: true, temperature: 40, powerOnHours: 21189, powerCycles: 6621, reallocated: 95, pending: 1 },
    children: [
      { name: 'sda1', path: '/dev/sda1', size: 500e9, type: 'part', fstype: 'ext4', label: 'HDD_DATA', mountpoints: ['/mnt/HDD_DATA'], rota: true, rm: false, fsused: 1e9, fsavail: 456e9 },
    ],
  },
  // Two drives of a mirror pool brought over from TrueNAS.
  ...['sdb', 'sdc'].map(
    (name, i): BlockDevice => ({
      name,
      path: `/dev/${name}`,
      size: 4e12,
      type: 'disk',
      model: 'WDC WD40EFRX-68N32N0',
      serial: `WD-WCC7K${i}TXL4E${i}`,
      tran: 'sata',
      rota: true,
      rm: false,
      smart: { passed: true, temperature: 35 + i, powerOnHours: 30211 + i * 17, powerCycles: 88 },
      children: [{ name: `${name}1`, path: `/dev/${name}1`, size: 4e12, type: 'part', fstype: 'zfs_member', label: 'tank', rota: true, rm: false }],
    }),
  ),
]

// The pool on those drives: importable until it's imported.
const tankVdevs = (state: string) => [
  {
    name: 'tank',
    state,
    read: '0',
    write: '0',
    cksum: '0',
    children: [
      {
        name: 'mirror-0',
        state,
        read: '0',
        write: '0',
        cksum: '0',
        children: [
          { name: '/dev/sdb1', state: 'ONLINE', read: '0', write: '0', cksum: '0' },
          { name: '/dev/sdc1', state: 'ONLINE', read: '0', write: '0', cksum: '0' },
        ],
      },
    ],
  },
]
let mockTank: ZfsPool | null = null

// A home network: the ISP's fibre modem, the main router behind it, and two access points, one
// of which has stopped answering.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString()
const routerBase = { incidents: [], events: [], restarting: false, gaveUp: false, hasPassword: false, uptime24h: 1, uptime7d: 1, added: hoursAgo(24 * 20) }
let mockRouters: Router[] = [
  {
    ...routerBase,
    id: 'modem',
    name: 'Fibre Modem',
    host: '192.168.100.1',
    kind: 'modem',
    restart: { method: 'tasmota', plug: '192.168.1.40' },
    autoRestart: true,
    status: 'up',
    latency: 2,
    since: hoursAgo(70),
    gateway: false,
    uptime7d: 0.996,
    incidents: [{ start: hoursAgo(70.6), end: hoursAgo(70), reason: 'Not answering' }],
    events: [{ time: hoursAgo(70.1), text: 'Restarted by itself, because the internet was down.' }],
  },
  {
    ...routerBase,
    id: 'main',
    name: 'MikroTik hAP ax²',
    host: '192.168.1.1',
    kind: 'router',
    parent: 'modem',
    restart: { method: 'mikrotik', username: 'admin', port: 22 },
    hasPassword: true,
    autoRestart: true,
    status: 'up',
    latency: 1,
    since: hoursAgo(300),
    gateway: true,
  },
  {
    ...routerBase,
    id: 'ap1',
    name: 'Living Room AP',
    host: '192.168.1.2',
    kind: 'ap',
    parent: 'main',
    restart: { method: 'ssh', username: 'root', port: 22, command: 'reboot' },
    hasPassword: true,
    autoRestart: false,
    status: 'up',
    latency: 3,
    since: hoursAgo(48),
    gateway: false,
  },
  {
    ...routerBase,
    id: 'ap2',
    name: 'Upstairs AP',
    host: '192.168.1.3',
    kind: 'ap',
    parent: 'main',
    restart: { method: '' },
    autoRestart: false,
    status: 'down',
    since: hoursAgo(0.4),
    gateway: false,
    uptime24h: 0.983,
    uptime7d: 0.991,
    incidents: [{ start: hoursAgo(0.4), reason: 'Not answering' }],
  },
]
const mockSnaps: ZfsSnapshot[] = [
  { name: 'auto-2026-10-25_00-00', created: new Date(Date.now() - 2 * 86400e3).toISOString(), used: 1.2e9, datasets: 4, browse: '/tank/.zfs/snapshot/auto-2026-10-25_00-00' },
  { name: 'auto-2026-10-18_00-00', created: new Date(Date.now() - 9 * 86400e3).toISOString(), used: 3.4e9, datasets: 4, browse: '/tank/.zfs/snapshot/auto-2026-10-18_00-00' },
]
const mockTrueNasApps: TrueNasApp[] = [
  {
    name: 'jellyfin',
    title: 'Jellyfin',
    version: '1.1.12',
    kind: 'compose',
    port: 30013,
    scheme: 'http',
    path: '/',
    data: '/.ix-apps/app_mounts/jellyfin',
    missing: [],
    compose: 'services:\n  jellyfin:\n    image: jellyfin/jellyfin:10.10.3\n    ports:\n      - "30013:30013"\n    volumes:\n      - /mnt/.ix-apps/app_mounts/jellyfin/config:/config\n      - /mnt/tank/media:/media\n',
  },
  { name: 'nextcloud', title: 'Nextcloud', kind: 'kubernetes', data: '/tank/ix-applications/releases/nextcloud/volumes', missing: [] },
]

const mockConverts: ConvertTask[] = []
const mockPositions = new Map<string, { position: number; duration: number }>()
let mockBook: CommandBook = {
  custom: [{ id: 'c1', title: 'Back up AppData', command: 'sudo tar -czf /DATA/Backup/appdata-$(date +%F).tar.gz /DATA/AppData', note: 'Stop the apps first.' }],
  favorites: ['disk-free', 'c1'],
}

let mockDevices: Device[] = [
  { id: 'pc', name: 'Gaming PC', kind: 'windows', host: '192.168.1.11', mac: '9c:6b:00:68:7d:27', protocol: 'vnc', port: 5900, username: '', hasPassword: true },
  { id: 'mac', name: 'MacBook', kind: 'mac', host: '192.168.1.2', mac: '', protocol: 'vnc', port: 5900, username: 'dio', hasPassword: true },
]
const mockEngine: RemoteEngine = { docker: true, installed: false, running: false, installing: false }
// The PC starts off; waking it brings it up a few seconds later.
const mockOnline: Record<string, boolean> = { pc: false, mac: true }

let mockStartup: StartupApp[] = [
  { id: 'jellyfin', name: 'Jellyfin', icon: 'film', color: ['#a35cff', '#5b2bd6'], enabled: true },
  { id: 'nextcloud', name: 'Nextcloud', icon: 'cloud', color: ['#3aa0ff', '#0a63d6'], enabled: true },
  { id: 'portainer', name: 'Portainer', icon: 'boxes', color: ['#5ac8fa', '#0a84ff'], enabled: false },
  { id: 'ssh', name: 'OpenSSH', icon: 'terminal', color: ['#4a4a50', '#1c1c1f'], enabled: true, locked: true },
]
const mockAdblock: AdblockStatus = { docker: true, installed: false, running: false, installing: false, protection: false, rules: 0, allowed: [], lists: {} }
let mockPausedUntil = 0

export const mockSystem = {
  async adblock(): Promise<AdblockStatus> {
    const paused = Math.max(0, Math.round((mockPausedUntil - Date.now()) / 1000))
    // A pause that ran out turns blocking back on, as AdGuard Home does.
    if (mockAdblock.running && !paused && mockPausedUntil) {
      mockAdblock.protection = true
      mockPausedUntil = 0
    }
    return {
      ...mockAdblock,
      pausedFor: paused || undefined,
      stats: mockAdblock.running
        ? {
            queries: 48213,
            blocked: 9127,
            avgMs: 3.4,
            topBlocked: [
              { name: 'doubleclick.net', count: 1840 },
              { name: 'app-measurement.com', count: 1203 },
              { name: 'googleads.g.doubleclick.net', count: 977 },
              { name: 'graph.facebook.com', count: 640 },
              { name: 'ads.tiktok.com', count: 512 },
            ],
            topClients: [
              { name: '192.168.1.11', count: 21880, label: 'Gaming PC' },
              { name: '192.168.1.3', count: 9120, label: 'Dios-MacBook-Air' },
              { name: '192.168.1.8', count: 3310 },
            ],
          }
        : undefined,
    }
  },
  async installAdblock() {
    Object.assign(mockAdblock, { installing: true, step: 'Downloading' })
    setTimeout(() => Object.assign(mockAdblock, { step: 'Starting' }), 2000)
    setTimeout(() => Object.assign(mockAdblock, { installing: false, step: undefined, installed: true, running: true, protection: true, rules: 191497, version: 'v0.107.79' }), 3500)
  },
  async setAdblock(enabled: boolean, minutes = 0) {
    mockAdblock.protection = enabled
    mockPausedUntil = !enabled && minutes ? Date.now() + minutes * 60_000 : 0
  },
  async allowDomain(domain: string) {
    mockAdblock.allowed = [...mockAdblock.allowed.filter(d => d !== domain), domain]
  },
  async blockDomainAgain(domain: string) {
    mockAdblock.allowed = mockAdblock.allowed.filter(d => d !== domain)
  },
  async testAdblock() {
    await delay(500)
    return { answered: mockAdblock.running, blocked: mockAdblock.running && mockAdblock.protection }
  },
  async setAdblockList(id: string, enabled: boolean) {
    const rules: Record<string, number> = { strong: 160000, strongest: 210000, gambling: 210000, popups: 40000, phones: 900, indonesia: 9000, bypass: 3400 }
    if (enabled && (id === 'strong' || id === 'strongest')) mockAdblock.lists = Object.fromEntries(Object.entries(mockAdblock.lists).filter(([k]) => k !== 'strong' && k !== 'strongest'))
    if (enabled) mockAdblock.lists = { ...mockAdblock.lists, [id]: rules[id] ?? 0 }
    else mockAdblock.lists = Object.fromEntries(Object.entries(mockAdblock.lists).filter(([k]) => k !== id))
  },
  async removeAdblock() {
    Object.assign(mockAdblock, { installed: false, running: false, protection: false })
  },
  async devices() {
    return { devices: mockDevices, engine: { ...mockEngine } }
  },
  async createDevice(body: DeviceInput) {
    const { password, ...rest } = body
    const device: Device = { ...rest, id: `d${Date.now().toString(36)}`, hasPassword: !!password }
    mockDevices = [...mockDevices, device]
    mockOnline[device.id] = true
    return device
  },
  async updateDevice(id: string, body: DeviceInput) {
    const { password, ...rest } = body
    let saved: Device | undefined
    mockDevices = mockDevices.map(d => (d.id === id ? (saved = { ...d, ...rest, hasPassword: password === undefined ? d.hasPassword : !!password }) : d))
    if (!saved) throw new Error('no such device')
    return saved
  },
  async deleteDevice(id: string) {
    mockDevices = mockDevices.filter(d => d.id !== id)
  },
  async deviceStatus() {
    await delay(600)
    return Object.fromEntries(
      mockDevices.map(d => [d.id, { online: !!mockOnline[d.id], screen: !!mockOnline[d.id] && d.protocol !== '', latency: mockOnline[d.id] ? 3 : undefined } satisfies DeviceStatus]),
    )
  },
  async wakeDevice(id: string) {
    setTimeout(() => (mockOnline[id] = true), 6000)
  },
  async discoverDevices(): Promise<FoundDevice[]> {
    await delay(2500)
    return [
      { ip: '192.168.1.10', mac: '', name: 'serverdio', kind: 'linux', ports: [22], self: true },
      { ip: '192.168.1.1', mac: '28:6d:da:46:7d:b0', kind: 'other', ports: [80], router: true },
      { ip: '192.168.1.2', mac: '1e:f9:6b:b5:64:b2', name: 'MacBook', kind: 'mac', ports: [5000, 7000] },
      { ip: '192.168.1.7', mac: '66:64:4a:02:14:69', name: 'raspberrypi', kind: 'linux', ports: [22] },
      { ip: '192.168.1.11', mac: '9c:6b:00:68:7d:27', name: 'DESKTOP-4K2P', kind: 'windows', ports: [135, 445] },
    ]
  },
  async lookupMac(host: string) {
    await delay(500)
    if (host === '192.168.1.11') return { mac: '9c:6b:00:68:7d:27' }
    throw new Error('couldn’t find that device’s MAC address; it must be switched on and on this network')
  },
  async installRemoteEngine() {
    Object.assign(mockEngine, { installing: true, step: 'Downloading' })
    setTimeout(() => Object.assign(mockEngine, { step: 'Starting' }), 2500)
    setTimeout(() => Object.assign(mockEngine, { installing: false, step: undefined, installed: true, running: true }), 4000)
  },
  remoteUrl: (): string | null => null,
  async job(kind: string) {
    return kind === aptJob.kind ? aptJob : { kind, running: false, log: [] }
  },
  async updates() {
    return { updates, lastChecked: new Date(now() - 3600e3).toISOString(), rebootRequired: true, rebootFor: ['linux-image-6.8.0-147-generic'] }
  },
  async checkUpdates() {
    aptJob = { kind: 'apt', title: 'Checking for updates', running: true, log: ['Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease'] }
    void delay(1500).then(() => (aptJob = { ...aptJob, running: false, exit: 0, log: [...aptJob.log, 'Reading package lists... Done'] }))
  },
  async installUpdates(packages: string[] = []) {
    const names = packages.length ? packages : updates.map(u => u.name)
    aptJob = { kind: 'apt', title: 'Installing updates', running: true, log: names.map(n => `Unpacking ${n} …`) }
    void delay(2500).then(() => {
      aptJob = { ...aptJob, running: false, exit: 0, log: [...aptJob.log, 'Processing triggers … done'] }
      updates = updates.filter(u => !names.includes(u.name))
    })
  },
  async power() {},
  async timeInfo() {
    return { timezone: 'Asia/Jakarta', ntp: true, synced: true, now: new Date().toISOString(), zones: ['Asia/Jakarta', 'Asia/Makassar', 'Etc/UTC', 'Europe/London'], hostname: 'teman-server' }
  },
  async setTime() {},

  async logs(params: { view?: LogView; after?: string; q?: string }) {
    if (params.after) {
      logCounter++
      return { entries: logCounter % 3 ? [] : [{ ...makeLog(logCounter), time: now() }], cursor: `c${logCounter}` }
    }
    let entries = Array.from({ length: 300 }, (_, i) => makeLog(i))
    if (params.view === 'errors') entries = entries.filter(e => e.priority <= 3)
    if (params.view === 'warnings') entries = entries.filter(e => e.priority <= 4)
    if (params.view === 'kernel') entries = entries.filter(e => e.source === 'kernel')
    if (params.view === 'auth') entries = entries.filter(e => e.source === 'sshd' || e.source === 'sudo')
    if (params.q) entries = entries.filter(e => e.message.toLowerCase().includes(params.q!.toLowerCase()))
    return { entries, cursor: 'c0' }
  },

  async disks() {
    return disks
  },
  async zfs(): Promise<ZfsInfo> {
    return {
      installed: true,
      pools: mockTank ? [{ ...mockTank }] : [],
      importable: mockTank
        ? []
        : [
            {
              name: 'tank',
              id: '15378461712423906371',
              state: 'ONLINE',
              status: 'The pool was last accessed by another system.',
              action: "The pool can be imported using its name or numeric identifier and the '-f' flag.",
              vdevs: tankVdevs('ONLINE').map(({ name, state, children }) => ({ name, state, children })),
            },
          ],
    }
  },
  async installZfs() {
    return { job: 'zfs' }
  },
  async importPool(_id: string, name: string, readOnly: boolean) {
    mockTank = {
      name,
      state: 'ONLINE',
      scan: 'scrub repaired 0B in 05:12:44 with 0 errors on Sun Oct 12 05:36:45 2026',
      errors: 'No known data errors',
      scrubbing: false,
      used: 2.31e12,
      free: 1.25e12,
      mount: '/tank',
      readOnly,
      vdevs: tankVdevs('ONLINE'),
      locked: [],
      skipped: [],
      auto: { daily: false, keep: 14 },
      trueNasApps: true,
    }
    if (!readOnly) mockSnaps.unshift({ name: 'temanlabs-imported-20261026-2240', created: new Date().toISOString(), used: 0, datasets: 4, browse: '/tank/.zfs/snapshot/temanlabs-imported-20261026-2240' })
    aptJob = { kind: 'zfs', title: `Importing ${name}`, running: false, exit: 0, log: [`Importing ${name}…`, 'Mounted 4 datasets.', 'Done.'] }
    return { job: 'zfs' }
  },
  async poolReadWrite(pool: string) {
    return mockSystem.importPool('1', pool, false)
  },
  async scrubPool(_pool: string, stop = false) {
    if (mockTank) mockTank = { ...mockTank, scrubbing: !stop, scan: stop ? 'scrub canceled on Mon Oct 26 22:41:02 2026' : 'scrub in progress since Mon Oct 26 22:40:00 2026 — 312G / 2.31T scanned, 13.5% done, 04:32:10 to go' }
  },
  async unlockDataset() {
    return { log: [] }
  },
  async poolSnapshots() {
    return { snapshots: mockSnaps, total: mockSnaps.length }
  },
  async snapshotPool(pool: string) {
    const name = `temanlabs-manual-${Date.now()}`
    mockSnaps.unshift({ name, created: new Date().toISOString(), used: 0, datasets: 4, browse: `/tank/.zfs/snapshot/${name}` })
    return { snapshot: `${pool}@${name}` }
  },
  async setPoolAuto(_pool: string, auto: { daily: boolean; keep: number }) {
    if (mockTank) mockTank = { ...mockTank, auto }
  },
  async trueNasApps() {
    return mockTrueNasApps
  },
  async routers(): Promise<RoutersInfo> {
    return {
      routers: mockRouters.map(r => ({ ...r })),
      gateway: '192.168.1.1',
      internet: { up: true, since: hoursAgo(70), latency: 9, uptime24h: 1, incidents: [{ start: hoursAgo(70.6), end: hoursAgo(70), reason: 'No answer from the internet' }] },
    }
  },
  async saveRouter(r: RouterInput, id?: string) {
    const restart = { ...r.restart, password: undefined }
    if (id) {
      mockRouters = mockRouters.map(x => (x.id === id ? { ...x, ...r, restart, hasPassword: x.hasPassword || !!r.restart.password } : x))
      return { id }
    }
    const added: Router = { ...routerBase, ...r, restart, id: `r${Date.now()}`, hasPassword: !!r.restart.password, status: 'unknown', gateway: false, added: new Date().toISOString() }
    mockRouters = [...mockRouters, added]
    return { id: added.id }
  },
  async deleteRouter(id: string) {
    mockRouters = mockRouters.filter(r => r.id !== id).map(r => (r.parent === id ? { ...r, parent: '' } : r))
  },
  async findRouters(): Promise<RouterSearch> {
    await delay(2500)
    return {
      gateway: '192.168.1.1',
      routers: [
        { host: '192.168.100.1', name: 'ZTE F670L', kind: 'modem', brand: 'ZTE', gateway: false, why: ['On the way to the internet'] },
        { host: '192.168.1.1', name: 'MikroTik hAP ax²', kind: 'router', brand: 'MikroTik', method: 'mikrotik', parent: '192.168.100.1', gateway: true, why: ['This server’s gateway'] },
        { host: '192.168.1.2', name: 'Living Room AP', kind: 'ap', brand: 'OpenWrt', method: 'ssh', parent: '192.168.1.1', gateway: false, why: ['OpenWrt admin page'] },
        { host: '192.168.1.6', name: 'TP-Link Access Point', kind: 'ap', brand: 'TP-Link', parent: '192.168.1.1', gateway: false, why: ['TP-Link admin page'] },
      ],
      plugs: [
        { host: '192.168.1.40', type: 'tasmota', name: 'Tasmota' },
        { host: '192.168.1.41', type: 'shelly', name: 'Shelly Plus Plug S' },
      ],
    }
  },
  async testRouter(_id: string, form?: RouterInput) {
    await delay(700)
    const method = form?.restart.method
    return { message: method === 'tasmota' || method === 'shelly' ? 'The plug answers and is on. Restarting switches it off for 10 seconds; the plug switches itself back on.' : 'Signed in over SSH. The router can be restarted from here.' }
  },
  async restartRouter(id: string) {
    await delay(1200)
    mockRouters = mockRouters.map(r => (r.id === id ? { ...r, events: [{ time: new Date().toISOString(), text: 'Restarted by hand.' }, ...r.events] } : r))
  },
  async mountDisk() {
    return { message: 'Done' }
  },
  async setAutomount() {},
  async formatDisk(body: { label: string }) {
    aptJob = { kind: 'disk-format', title: 'Formatting', running: false, exit: 0, log: ['$ mkfs.ext4 -F -L ' + body.label, 'Done.'] }
    return { job: 'disk-format', target: '/DATA/' + body.label }
  },
  async ejectDisk() {},
  async storage() {
    return {
      fstab: [],
      merged: [{ name: 'Storage', target: '/DATA/Storage', branches: ['/mnt/HDD_DATA', '/DATA/Backup'], mounted: true, size: 1.2e12, free: 8e11 }],
      mergerfs: true,
      usbAutomount: true,
      filesystems: ['ext4', 'xfs', 'btrfs', 'exfat', 'ntfs'],
    }
  },
  async mergeStorage() {},
  async unmergeStorage() {},
  async installMergerfs() {
    return { job: 'apt' }
  },
  async setUsbAutomount() {},
  async commandsInfo(tools: string[]): Promise<CommandsInfo> {
    // A server with Docker, k3s and ffmpeg but without a few extras.
    const missing = ['ncdu', 'iotop', 'fdupes', 'tailscale', 'unrar', 'wakeonlan', 'pm2']
    return {
      tools: Object.fromEntries(tools.map(t => [t, !missing.includes(t)])),
      apps: [
        { id: 'jellyfin', name: 'Jellyfin', containers: ['jellyfin'], project: 'jellyfin', dir: '/DATA/AppData/jellyfin', files: ['/DATA/AppData/jellyfin/docker-compose.yml'] },
        { id: 'pihole', name: 'Pi-hole', containers: ['pihole'] },
        { id: 'native:filebrowser', name: 'File Browser', unit: 'filebrowser.service' },
      ],
      book: mockBook,
      history: ['docker compose -f /DATA/AppData/jellyfin/docker-compose.yml pull', 'sudo apt update && sudo apt upgrade -y', 'df -h', 'journalctl -u temanlabsos -f', 'htop'],
      user: 'dio',
      dockerGroup: true,
    }
  },
  async saveCommandBook(book: CommandBook) {
    mockBook = book
  },
  async fileInfo(path: string): Promise<FileDetails> {
    const name = path.slice(path.lastIndexOf('/') + 1) || '/'
    const folder = !name.includes('.')
    const kind = folder ? 'folder' : /.(mp4|mkv|mov)$/i.test(name) ? 'video' : /.(jpe?g|png|webp)$/i.test(name) ? 'image' : 'document'
    const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
    return {
      name, path, kind, folder, size: folder ? 4096 : 734003200,
      ...(folder ? { items: 12, total: 18.4e9, files: 1342 } : {}),
      modified: ago(2), accessed: ago(0), changed: ago(2), created: ago(40),
      mode: folder ? 'drwxrwxr-x' : '-rw-rw-r--', octal: folder ? '775' : '664', owner: 'dio', group: 'dio', uid: 1000, gid: 1000,
      mime: kind === 'video' ? 'video/mp4' : undefined,
      volume: { mount: '/mnt/HDD_DATA', fstype: 'ext4', size: 491e9, free: 470e9 },
      media: kind === 'video' ? { width: 1920, height: 1080, duration: 5420, video: 'H.264', audio: 'AAC', fps: 23.98, bitrate: 8.2e6, channels: 6 } : kind === 'image' ? { width: 4032, height: 3024 } : undefined,
    }
  },
  async mediaPosition(path: string) {
    return mockPositions.get(path) ?? { position: 0, duration: 0 }
  },
  async saveMediaPosition(path: string, position: number, duration: number) {
    if (position > 0) mockPositions.set(path, { position, duration })
    else mockPositions.delete(path)
  },
  async convertInfo(): Promise<ConvertInfo> {
    // A mock conversion takes about 8 seconds.
    const now = Date.now()
    let busy = false
    for (const t of mockConverts) {
      if (t.status === 'queued' && !busy) {
        t.status = 'running'
        t.started = new Date(now).toISOString()
      }
      if (t.status === 'running') {
        t.progress = Math.min(1, (now - Date.parse(t.started!)) / 8000)
        t.speed = 3.4
        if (t.progress >= 1) Object.assign(t, { status: 'done', speed: undefined, size: 2.1e9, ended: new Date(now).toISOString() })
        else busy = true
      }
    }
    return { ffmpeg: true, version: '6.1.1', encoders: ['aac', 'flac', 'h264', 'hevc', 'mp3', 'opus', 'pcm', 'vp9'], tasks: [...mockConverts].reverse() }
  },
  async probeMedia(path: string): Promise<MediaProbe> {
    const audioOnly = /\.(mp3|m4a|flac|wav|ogg|opus)$/i.test(path)
    const no = (why: { video: string }) => ({ mp4: why, mkv: why, webm: why, mov: why, ts: why })
    return {
      path,
      container: audioOnly ? 'mp3' : 'matroska,webm',
      duration: audioOnly ? 214 : 6130,
      size: audioOnly ? 8.4e6 : 4.6e9,
      bitrate: 6e6,
      streams: audioOnly
        ? [{ index: 0, type: 'audio', codec: 'mp3', channels: 2 }]
        : [
            { index: 0, type: 'video', codec: 'h264', width: 1920, height: 1080, fps: 23.98 },
            { index: 1, type: 'audio', codec: 'dts', channels: 6, language: 'eng' },
            { index: 2, type: 'audio', codec: 'aac', channels: 2, language: 'jpn', title: 'Commentary' },
            { index: 3, type: 'subtitle', codec: 'subrip', language: 'ind' },
            { index: 4, type: 'subtitle', codec: 'hdmv_pgs_subtitle', language: 'eng' },
          ],
      remux: audioOnly
        ? {
            ...no({ video: 'this file has no video' }),
            mp3: {},
            m4a: { audio: 'MP3 sound can’t go into M4A as it is' },
            flac: { audio: 'MP3 sound can’t go into FLAC as it is' },
            opus: { audio: 'MP3 sound can’t go into OPUS as it is' },
            wav: { audio: 'MP3 sound can’t go into WAV as it is' },
          }
        : {
            mp4: { audio: 'DTS sound can’t go into MP4 as it is' },
            mkv: {},
            webm: { video: 'H.264 video can’t go into WEBM as it is', audio: 'DTS sound can’t go into WEBM as it is' },
            mov: { audio: 'DTS sound can’t go into MOV as it is' },
            ts: {},
            mp3: { audio: 'DTS sound can’t go into MP3 as it is' },
            m4a: { audio: 'DTS sound can’t go into M4A as it is' },
            flac: { audio: 'DTS sound can’t go into FLAC as it is' },
            opus: { audio: 'DTS sound can’t go into OPUS as it is' },
            wav: { audio: 'DTS sound can’t go into WAV as it is' },
          },
    }
  },
  async startConvert(body: ConvertRequest): Promise<ConvertTask> {
    const dir = body.path.slice(0, body.path.lastIndexOf('/'))
    const base = body.path.slice(dir.length + 1).replace(/\.[^.]+$/, '')
    const task: ConvertTask = {
      id: String(Date.now()),
      input: body.path,
      output: `${dir}/${body.name || base + '.' + body.container}`,
      container: body.container,
      video: body.video,
      audio: body.audio,
      status: 'queued',
      progress: 0,
      duration: 6130,
      created: new Date().toISOString(),
    }
    mockConverts.push(task)
    return task
  },
  async cancelConvert(id: string) {
    const i = mockConverts.findIndex(t => t.id === id)
    if (i < 0) return
    const t = mockConverts[i]
    if (t.status === 'queued' || t.status === 'running') t.status = 'cancelled'
    else mockConverts.splice(i, 1)
  },
  async clearConverts() {
    for (let i = mockConverts.length - 1; i >= 0; i--) if (!['queued', 'running'].includes(mockConverts[i].status)) mockConverts.splice(i, 1)
  },
  async installFFmpeg() {
    return { job: 'apt' }
  },
  async startupApps(): Promise<StartupApp[]> {
    return mockStartup
  },
  async setStartupApp(id: string, enabled: boolean) {
    mockStartup = mockStartup.map(a => (a.id === id ? { ...a, enabled } : a))
  },
  async history(range: HistoryRange): Promise<HistoryData> {
    const span = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 }[range]
    const step = Math.max(60, Math.floor(span / 360))
    const end = Math.floor(Date.now() / 1000 / step) * step
    const points: (HistoryPoint | null)[] = []
    for (let t = end - span + step; t <= end; t += step) {
      const hour = new Date(t * 1000).getHours() + new Date(t * 1000).getMinutes() / 60
      // Busy evenings, a quiet night, and the server off for a while two days ago.
      if (t > end - 2 * 86400 - 3 * 3600 && t < end - 2 * 86400) {
        points.push(null)
        continue
      }
      const evening = Math.max(0, Math.sin(((hour - 14) / 12) * Math.PI))
      const noise = (Math.sin(t / 997) + Math.sin(t / 313)) * 0.5
      const cpu = Math.max(2, 8 + evening * 28 + noise * 6)
      points.push({
        t,
        cpu,
        cpuMax: Math.min(100, cpu * 1.8 + 5),
        mem: 38 + evening * 9 + noise * 2,
        temp: 41 + evening * 14 + noise * 3,
        rx: Math.max(0, (0.4 + evening * 3.5 + noise) * 1e6),
        tx: Math.max(0, (0.1 + evening * 0.9 + noise * 0.3) * 1e6),
        read: Math.max(0, (0.2 + evening * 2 + noise) * 1e6),
        write: Math.max(0, (0.5 + evening * 1.2 + noise * 0.4) * 1e6),
        load: cpu / 15,
        watts: 9 + evening * 9 + noise,
      })
    }
    return { step, since: end - 30 * 86400, points }
  },
  async appHealth(): Promise<AppHealth[]> {
    const day = 86400e3
    const at = (ms: number) => new Date(Date.now() - ms).toISOString()
    return [
      { id: 'jellyfin', status: 'up', autoRestart: true, uptime24h: 1, uptime7d: 0.9981, uptime30d: 0.9993, watching: at(40 * day), since: at(3 * day), incidents: [{ start: at(3 * day + 19 * 60e3), end: at(3 * day), reason: 'Its web page doesn’t answer', restarted: true }] },
      { id: 'nextcloud', status: 'down', autoRestart: true, uptime24h: 0.97, uptime7d: 0.995, uptime30d: 0.998, watching: at(40 * day), since: at(42 * 60e3), error: 'Its web page takes too long to answer', incidents: [{ start: at(42 * 60e3), reason: 'Its web page takes too long to answer', restarted: true }] },
      { id: 'portainer', status: 'stopped', autoRestart: true, uptime24h: 1, uptime7d: 1, uptime30d: 1, watching: at(40 * day), incidents: [] },
    ]
  },
  async setAutoRestart() {},
  async movePreview(id: string): Promise<MovePreview> {
    if (id !== 'native-pm2-teman') return { possible: false, reason: 'only Node.js apps run by pm2 can be moved for now' }
    return { possible: true, name: 'bensinku-web', project: 'bensinku-web', folder: '/home/teman/bensinku-web', node: '22.23.1', compose: 'services:\n  bensinku-web:\n    image: node:22-bookworm-slim\n' }
  },
  async moveToDocker(id: string) {
    return { job: `move-${id}` }
  },
  async movedApps(): Promise<MovedApp[]> {
    return []
  },
  async moveBack(project: string) {
    return { job: `move-${project}` }
  },
  async hardware(): Promise<HardwareInfo> {
    return { vendor: 'Lenovo', model: 'ThinkCentre M710q', modelNumber: '10MQS31W00', kind: 'mini', serial: 'MJ0ABCDE', year: '2017' }
  },
  async releaseStatus() {
    return { current: 'v0.9.0', latest: 'v1.0.0', available: true, notes: '### New\n- App Center with the CasaOS app stores\n- Cloud drives and merged storage\n\n### Fixed\n- The installer uses port 80, so the desktop opens at `http://<server-ip>`.\n\n**Full Changelog**: https://github.com/diopratama99/TemanLabs-OS/compare/v0.9.0...v1.0.0', arch: 'amd64', checked: new Date().toISOString() }
  },
  async installRelease() {
    return { job: 'self-update' }
  },
  async cloud() {
    return {
      rclone: true,
      providers: [
        { type: 'drive', name: 'Google Drive', oauth: true },
        { type: 'dropbox', name: 'Dropbox', oauth: true },
        { type: 'onedrive', name: 'OneDrive', oauth: true },
        {
          type: 'webdav',
          name: 'WebDAV (Nextcloud, ownCloud…)',
          fields: [
            { key: 'url', label: 'Address', placeholder: 'https://cloud.example.com/remote.php/dav/files/me' },
            { key: 'user', label: 'User' },
            { key: 'pass', label: 'Password', secret: true },
          ],
        },
      ],
      remotes: [{ name: 'GoogleDrive', type: 'drive', mount: '/DATA/Cloud/GoogleDrive', mounted: true, service: 'active' }],
    }
  },
  async cloudSignIn() {
    return { session: 'mock', url: 'https://accounts.google.com/o/oauth2/auth?mock=1' }
  },
  async addCloud() {},
  async cloudAction() {},
  async removeCloud() {},
  async diskUsage(path: string) {
    await delay(300)
    return {
      path,
      total: 9.7e9,
      entries: [
        { name: 'HDD_DATA', size: 8.9e9, isDir: true },
        { name: 'AppData', size: 7.7e8, isDir: true },
        { name: 'Media', size: 4e7, isDir: true },
        { name: 'Files in this folder', size: 2e6, isDir: false },
      ],
    }
  },

  async interfaces() {
    const t = now() / 1000
    return [
      { name: 'enp0s31f6', mac: '02:42:ac:11:00:02', state: 'up', mtu: 1500, addresses: ['192.168.1.20/24'], speedMbps: 1000, rxBytes: Math.round(t * 2e5), txBytes: Math.round(t * 6e4), virtual: false },
      { name: 'tailscale0', state: 'unknown', mtu: 1280, addresses: ['100.101.102.103/32'], rxBytes: Math.round(t * 1e4), txBytes: Math.round(t * 8e3), virtual: false },
      { name: 'docker0', mac: '02:42:ac:11:00:01', state: 'up', mtu: 1500, addresses: ['172.17.0.1/16'], rxBytes: 1e6, txBytes: 2e6, virtual: true },
    ]
  },
  async netTool(tool: 'ping' | 'traceroute', host: string) {
    await delay(800)
    return tool === 'ping'
      ? { ok: true, output: `PING ${host} 56(84) bytes of data.\n64 bytes from ${host}: icmp_seq=1 ttl=58 time=3.8 ms\n64 bytes from ${host}: icmp_seq=2 ttl=58 time=4.3 ms\n\n--- ${host} ping statistics ---\n2 packets transmitted, 2 received, 0% packet loss` }
      : { ok: true, output: ` 1:  192.168.1.1   0.5ms\n 2:  10.10.0.1     3.1ms\n 3:  ${host}       9.8ms reached` }
  },
  async dnsLookup(name: string) {
    return { name, records: { A: ['216.239.38.120'], AAAA: ['2001:4860:4802:32::78'] }, resolvers: ['192.168.1.1'] }
  },
  async connections() {
    return [
      { protocol: 'tcp', state: 'estab', local: '192.168.1.20:22', peer: '192.168.1.11:52114', process: 'sshd', pid: 812 },
      { protocol: 'tcp', state: 'estab', local: '192.168.1.20:7700', peer: '192.168.1.11:61012', process: 'temanlabsos', pid: 1500 },
    ]
  },
  async firewall() {
    return firewall
  },
  async changeFirewall(change: { op: string; action?: string; port?: string; protocol?: string; from?: string; number?: number }) {
    if (change.op === 'enable' || change.op === 'disable') firewall = { ...firewall, enabled: change.op === 'enable' }
    if (change.op === 'add')
      firewall.rules = [...firewall.rules, { number: firewall.rules.length + 1, to: `${change.port}${change.protocol ? `/${change.protocol}` : ''}`, action: (change.action ?? 'allow').toUpperCase(), from: change.from || 'Anywhere', v6: false }]
    if (change.op === 'delete') firewall.rules = firewall.rules.filter(r => r.number !== change.number).map((r, i) => ({ ...r, number: i + 1 }))
  },

  async cron() {
    return { crontabs, timers: [{ unit: 'apt-daily.timer', activates: 'apt-daily.service', next: now() + 4 * 3600e3, last: now() - 20 * 3600e3 }] }
  },
  async saveCron(tab: Crontab) {
    crontabs = crontabs.map(t => (t.user === tab.user ? tab : t))
  },
  async runCron(_user: string, command: string) {
    await delay(500)
    return { output: `$ ${command}\n(mock mode: nothing ran)`, exit: 0 }
  },

  async accounts() {
    return { users: accounts, groups }
  },
  async createAccount(a: { name: string; fullName: string; admin: boolean }) {
    accounts = [...accounts, { name: a.name, uid: 1000 + accounts.length, fullName: a.fullName, home: `/home/${a.name}`, shell: '/bin/bash', groups: [a.name, ...(a.admin ? ['sudo'] : [])], admin: a.admin, locked: false, noLogin: false, protected: false }]
  },
  async changeAccount(name: string, change: { action: string; admin?: boolean; group?: string; fullName?: string }) {
    accounts = accounts.map(u => {
      if (u.name !== name) return u
      switch (change.action) {
        case 'admin':
          return { ...u, admin: !!change.admin, groups: change.admin ? [...u.groups, 'sudo'] : u.groups.filter(g => g !== 'sudo') }
        case 'lock':
        case 'unlock':
          return { ...u, locked: change.action === 'lock' }
        case 'addGroup':
          return { ...u, groups: [...u.groups, change.group!] }
        case 'removeGroup':
          return { ...u, groups: u.groups.filter(g => g !== change.group) }
        case 'fullName':
          return { ...u, fullName: change.fullName }
      }
      return u
    })
  },
  async deleteAccount(name: string) {
    accounts = accounts.filter(u => u.name !== name)
  },
}

// ----- A pretend k3s cluster: scaling and self-healing behave roughly like the real thing -----
const rand = () => Math.random().toString(36).slice(2, 7)
const ago = (min: number) => new Date(now() - min * 60e3).toISOString()
let k8sWorkloads: K8sWorkload[] = []
let k8sPods: K8sPod[] = []
let k8sServices: K8sService[] = []

const podsFor = (w: K8sWorkload) => k8sPods.filter(p => p.owner?.endsWith(`/${w.name}`) || p.name.startsWith(`${w.name}-`))
function reconcile() {
  for (const w of k8sWorkloads) {
    const pods = podsFor(w)
    for (let i = pods.length; i < w.desired; i++)
      k8sPods.push({ name: `${w.name}-${rand()}`, namespace: w.namespace, phase: 'Running', status: 'Running', ready: '1/1', restarts: 0, node: 'teman-server', ip: `10.42.0.${10 + k8sPods.length}`, owner: `ReplicaSet/${w.name}`, created: new Date().toISOString(), cpu: '3m', memory: '12Mi', containers: [w.name] })
    for (const extra of pods.slice(w.desired)) k8sPods = k8sPods.filter(p => p !== extra)
    w.ready = Math.min(w.desired, podsFor(w).length)
    w.updated = w.ready
  }
}

function addLab() {
  const mk = (kind: K8sWorkload['kind'], name: string, image: string, desired: number): K8sWorkload => ({ kind, name, namespace: 'lab', desired, ready: 0, updated: 0, images: [image], created: ago(5) })
  k8sWorkloads = [mk('Deployment', 'web', 'nginx:1.27-alpine', 3), mk('StatefulSet', 'db', 'postgres:16-alpine', 1), mk('Deployment', 'adminer', 'adminer:4', 1), mk('DaemonSet', 'node-exporter', 'prom/node-exporter:v1.8.2', 1), mk('Deployment', 'prometheus', 'prom/prometheus:v2.54.1', 1), mk('Deployment', 'grafana', 'grafana/grafana:11.2.0', 1)]
  const svc = (name: string, port: number, nodePort?: number): K8sService => ({ name, namespace: 'lab', type: nodePort ? 'NodePort' : 'ClusterIP', clusterIP: `10.43.0.${port % 250}`, ports: [{ port, targetPort: String(port), nodePort, protocol: 'TCP' }], selector: { app: name }, created: ago(5) })
  k8sServices = [svc('web', 80, 30080), svc('db', 5432), svc('adminer', 8080, 30081), svc('node-exporter', 9100), svc('prometheus', 9090, 30090), svc('grafana', 3000, 30300)]
  reconcile()
}

export const mockK8s = {
  async k8s(): Promise<K8sStatus> {
    return {
      installed: true,
      running: true,
      namespaces: ['default', 'kube-system', ...(k8sWorkloads.length ? ['lab'] : [])],
      nodes: [{ name: 'teman-server', ready: true, roles: 'control-plane, master', version: 'v1.31.4+k3s1', ip: '192.168.1.20', os: 'Ubuntu 24.04 LTS', runtime: 'containerd://1.7.23-k3s2', cpu: '8', memory: '16Gi', cpuUse: '210m', cpuPct: '3%', memUse: '1480Mi', memPct: '9%', podsLimit: '110' }],
    }
  },
  async installK8s() {},
  async uninstallK8s() {},
  async k8sResources(namespace: string): Promise<K8sResources> {
    const inNs = <T extends { namespace: string }>(l: T[]) => l.filter(x => !namespace || x.namespace === namespace)
    return {
      workloads: inNs(k8sWorkloads),
      pods: inNs(k8sPods),
      services: inNs(k8sServices),
      volumes: k8sWorkloads.length ? inNs([{ name: 'data-db-0', namespace: 'lab', status: 'Bound', capacity: '1Gi', storageClass: 'local-path', volume: 'pvc-1a2b', created: ago(5) }]) : [],
      events: k8sPods.slice(-6).map(p => ({ type: 'Normal', reason: 'Started', object: `pod/${p.name}`, message: 'Started container', count: 1, last: p.created, namespace: p.namespace })),
      command: `kubectl get deployments,statefulsets,daemonsets,pods,services,pvc -o json ${namespace ? `-n ${namespace}` : '--all-namespaces'}`,
    }
  },
  async k8sAction(a: K8sActionRequest) {
    await delay(300)
    const w = k8sWorkloads.find(x => x.name === a.name && x.namespace === (a.namespace || 'default'))
    switch (a.action) {
      case 'apply':
        addLab()
        return { output: 'namespace/lab created\ndeployment.apps/web created\n…', command: 'kubectl apply -f -' }
      case 'scale':
        if (w) w.desired = a.replicas ?? w.desired
        reconcile()
        return { output: `deployment.apps/${a.name} scaled`, command: `kubectl scale deployment ${a.name} -n ${a.namespace} --replicas=${a.replicas}` }
      case 'delete':
        if (a.kind === 'pod') {
          k8sPods = k8sPods.filter(p => p.name !== a.name)
          setTimeout(reconcile, 1500)
        } else if (w) {
          k8sWorkloads = k8sWorkloads.filter(x => x !== w)
          reconcile()
        }
        return { output: `${a.kind} "${a.name}" deleted`, command: `kubectl delete ${a.kind} ${a.name} -n ${a.namespace} --wait=false` }
      default:
        return { output: 'done', command: `kubectl ${a.action} ${a.kind ?? ''} ${a.name ?? ''}` }
    }
  },
  async k8sText(view: string, kind: string, name: string, namespace: string) {
    return { text: `# mock ${view} of ${kind}/${name}\n`, command: `kubectl ${view === 'yaml' ? `get ${kind} ${name} -o yaml` : `${view} ${kind} ${name}`} -n ${namespace}` }
  },
}
