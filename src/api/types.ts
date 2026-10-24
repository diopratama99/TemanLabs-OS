export type AppStatus = 'running' | 'stopped' | 'installing'

/**
 * Where an installed app came from; only TemanLabsOS's own installs can be uninstalled here.
 * `native` apps run outside Docker (a systemd service or a plain process with a web UI).
 */
export type AppSource = 'temanlabs' | 'casaos' | 'compose' | 'container' | 'native'

/** An App Center entry. */
export interface StoreApp {
  id: string
  name: string
  /** Built-in glyph (see lib/icons.ts), used when there's no icon image. */
  icon: string
  iconUrl?: string
  color: [string, string]
  category: string
  description: string
  /** Preferred host port; the server picks the next free one if it's taken. */
  port: number
  /** Set when the same image already runs as another app (e.g. installed through CasaOS). */
  installedAs?: string
}

/** A compose project or lone container running on the server. */
export interface InstalledApp {
  id: string
  name: string
  icon: string
  iconUrl?: string
  color: [string, string]
  category: string
  description: string
  /** Host port of the web UI, or null when the app has none reachable from the network. */
  port: number | null
  path: string
  scheme: string
  status: AppStatus
  source: AppSource
  containers: number
  canUninstall: boolean
  /** Last install error, if the install failed. */
  error?: string
  /** Native apps: the systemd service that runs it (start/stop go through it). */
  unit?: string
  /** Native apps listening on localhost only, reachable through TemanLabsOS's proxy alone. */
  localOnly?: boolean
}

export interface Disk {
  name: string
  mount: string
  used: number
  total: number
}

export interface NetworkAddresses {
  /** Primary LAN address: the interface of the default route. */
  lan: { interface: string; ipv4: string } | null
  /** The tailscale0 interface; null when Tailscale isn't running. */
  tailscale: { ipv4: string; dnsName?: string } | null
}

export interface SystemStats {
  hostname: string
  os: string
  kernel: string
  uptime: number
  cpu: { usage: number; cores: number; temp: number; model: string }
  memory: { used: number; total: number }
  disks: Disk[]
  network: { rx: number; tx: number }
  addresses: NetworkAddresses
}

export type FileKind = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code'

export interface FileEntry {
  name: string
  kind: FileKind
  size?: number
  modified: string
}

export interface SearchMatch {
  path: string
  line: number
  column: number
  preview: string
}

/** Resource use of a running container, as `docker stats` computes it. */
export interface ContainerSample {
  /** Percent of one core, so up to cores × 100. */
  cpu: number
  memUsed: number
  memLimit: number
  /** Bytes per second. */
  netRx: number
  netTx: number
  /** Totals since the container started. */
  blockRead: number
  blockWrite: number
  pids: number
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: string
  /** Docker's human status, e.g. "Up 3 days (healthy)". */
  status: string
  /** The installed app (compose project) this container belongs to. */
  appId: string
  created: number
  ports: string[]
  /** null until the first sample arrives, and for containers that aren't running. */
  stats: ContainerSample | null
}

/** How to show an app in a window: directly, or through a proxy port that allows framing. */
export interface AppFrame {
  proxied: boolean
  port?: number
}

export interface Session {
  authenticated: boolean
  hostname: string
  /** Only sent once signed in: the file manager's root and the terminal user's home. */
  root?: string
  home?: string
}

/** The Manual Install form. With `compose` set, that file is installed instead of the form's fields. */
export interface CustomAppSpec {
  compose?: string
  image: string
  tag: string
  title: string
  iconUrl: string
  webUi: { scheme: 'http' | 'https'; port: number; path: string }
  network: string
  ports: { host: number; container: number; protocol: 'tcp' | 'udp' }[]
  volumes: { host: string; container: string; readOnly: boolean }[]
  env: { key: string; value: string }[]
  devices: { host: string; container: string }[]
  command: string
  restart: 'unless-stopped' | 'always' | 'on-failure' | 'no'
  privileged: boolean
  memoryMb: number
  cpuShares: number
  capAdd: string[]
  hostname: string
}

/** A port something on the server listens on. */
export interface ListenPort {
  port: number
  protocol: 'tcp' | 'udp'
  addresses: string[]
  /** Reachable from other machines (not bound to loopback only). */
  public: boolean
  pid?: number
  process?: string
  command?: string
  user?: string
  /** The container it belongs to: published by Docker, or a process inside one. */
  container?: string
  containerId?: string
  appId?: string
  /** Port inside the container, for published ports. */
  targetPort?: number
}

/** A photo uploaded as a wallpaper. */
export interface WallpaperImage {
  name: string
  url: string
}

/** A systemd service. */
export interface ServiceInfo {
  unit: string
  description: string
  load: string
  /** active, inactive, failed, activating… */
  active: string
  /** running, exited, dead… */
  sub: string
  /** Unit file state: enabled, disabled, static, masked… */
  enabled?: string
  mainPid?: number
  memory?: number
  /** Percent of one core. */
  cpu: number
  /** Unix seconds when it last became active. */
  since?: number
  /** Keeps the server reachable; can't be stopped or disabled from the UI. */
  protected?: boolean
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'

/** A process on the server. */
export interface ProcessInfo {
  pid: number
  ppid: number
  name: string
  user: string
  state: string
  /** Percent of one core. */
  cpu: number
  memory: number
  threads: number
  /** Unix seconds. */
  started: number
  command?: string
  unit?: string
  container?: string
  kernel?: boolean
}

/** A Samba (SMB) share. Only TemanLabsOS's own can be edited; CasaOS rewrites its file. */
export interface SmbShare {
  name: string
  path: string
  comment?: string
  readOnly: boolean
  /** Anyone on the network, no password. */
  guest: boolean
  /** Who may connect when not guest. */
  users?: string[]
  browseable: boolean
  source: 'temanlabs' | 'casaos' | 'samba'
}

export interface SmbUser {
  name: string
  fullName?: string
  disabled: boolean
}

export interface SmbInfo {
  installed: boolean
  running: boolean
  version: string
  shares: SmbShare[]
  users: SmbUser[]
  /** Accounts on the server that could become Samba users. */
  people: string[]
}

export interface SmbSession {
  user: string
  machine: string
  protocol: string
  shares: string[]
  since?: string
}

export type SmbShareSpec = Pick<SmbShare, 'name' | 'path' | 'comment' | 'readOnly' | 'guest' | 'users' | 'browseable'>

// ----- System utilities -----

/** A background admin task (apt…), polled for its log. */
export interface Job {
  kind: string
  title?: string
  running: boolean
  started?: string
  ended?: string
  exit?: number
  log: string[]
  dropped?: number
}

export interface AptUpdate {
  name: string
  current: string
  version: string
  origin: string
  security: boolean
  arch?: string
}

export interface UpdatesInfo {
  updates: AptUpdate[]
  lastChecked: string
  rebootRequired: boolean
  rebootFor: string[] | null
}

export interface LogEntry {
  /** Unix ms. */
  time: number
  /** syslog priority: 0 emergency … 3 error, 4 warning, 6 info, 7 debug. */
  priority: number
  source: string
  unit?: string
  pid?: string
  message: string
}

export type LogView = 'all' | 'errors' | 'warnings' | 'kernel' | 'auth'

export interface SmartInfo {
  passed?: boolean
  temperature?: number
  powerOnHours?: number
  powerCycles?: number
  reallocated?: number
  pending?: number
  wearPercent?: number
  error?: string
}

export interface BlockDevice {
  name: string
  path: string
  size: number
  type: string
  fstype?: string
  mountpoints?: string[]
  label?: string
  model?: string
  serial?: string
  tran?: string
  rota: boolean
  rm: boolean
  uuid?: string
  fsused?: number
  fsavail?: number
  children?: BlockDevice[]
  smart?: SmartInfo
}

export interface DiskUsage {
  path: string
  total: number
  entries: { name: string; size: number; isDir: boolean }[]
  partial?: boolean
}

export interface NetInterface {
  name: string
  mac?: string
  state: string
  mtu: number
  addresses: string[]
  speedMbps?: number
  rxBytes: number
  txBytes: number
  virtual: boolean
}

export interface NetConnection {
  protocol: string
  state: string
  local: string
  peer: string
  process?: string
  pid?: number
}

export interface FirewallRule {
  number: number
  to: string
  action: string
  from: string
  v6: boolean
}

export interface CronTask {
  schedule: string
  command: string
  enabled: boolean
  name?: string
}

export interface Crontab {
  user: string
  tasks: CronTask[]
  header?: string[]
}

export interface SystemTimer {
  unit: string
  activates: string
  next?: number
  last?: number
}

export interface SystemAccount {
  name: string
  uid: number
  fullName?: string
  home: string
  shell: string
  groups: string[]
  admin: boolean
  locked: boolean
  noLogin: boolean
  /** root and the account TemanLabsOS runs as. */
  protected: boolean
}

export interface SystemGroup {
  name: string
  gid: number
  members: string[]
}

export interface TimeInfo {
  timezone: string
  ntp: boolean
  synced: boolean
  now: string
  zones: string[]
  hostname: string
}

// ----- Kubernetes (k3s) -----

export interface K8sNode {
  name: string
  ready: boolean
  roles: string
  version: string
  ip: string
  os: string
  runtime: string
  cpu: string
  memory: string
  cpuUse?: string
  memUse?: string
  cpuPct?: string
  memPct?: string
  podsLimit: string
}

export interface K8sStatus {
  installed: boolean
  running?: boolean
  nodes?: K8sNode[]
  namespaces?: string[]
  error?: string
}

export interface K8sWorkload {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'
  name: string
  namespace: string
  desired: number
  ready: number
  updated: number
  images: string[]
  created: string
  strategy?: string
}

export interface K8sPod {
  name: string
  namespace: string
  phase: string
  status: string
  ready: string
  restarts: number
  node: string
  ip: string
  owner?: string
  created: string
  cpu?: string
  memory?: string
  containers: string[]
}

export interface K8sService {
  name: string
  namespace: string
  type: string
  clusterIP: string
  ports: { name?: string; port: number; targetPort: string; nodePort?: number; protocol: string }[]
  selector?: Record<string, string>
  created: string
}

export interface K8sVolume {
  name: string
  namespace: string
  status: string
  capacity: string
  storageClass: string
  volume: string
  created: string
}

export interface K8sEvent {
  type: string
  reason: string
  object: string
  message: string
  count: number
  last: string
  namespace: string
}

export interface K8sResources {
  workloads: K8sWorkload[]
  pods: K8sPod[]
  services: K8sService[]
  volumes: K8sVolume[]
  events: K8sEvent[]
  command: string
}

export interface K8sActionRequest {
  action: 'apply' | 'delete' | 'scale' | 'restart' | 'image' | 'undo' | 'namespace' | 'deleteNamespace'
  kind?: string
  name?: string
  namespace?: string
  replicas?: number
  container?: string
  image?: string
  yaml?: string
}
