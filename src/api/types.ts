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
  /** A cloud drive (rclone); widgets leave it out. */
  cloud?: boolean
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
  /** Power draw, when something measures it: a laptop battery, or the processor's own counters (CPU and RAM only). */
  power?: { watts: number; source: 'cpu' | 'battery'; parts?: { name: string; watts: number }[] }
  /** Load averages over 1, 5 and 15 minutes. */
  load?: [number, number, number]
}

export type FileKind = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code'

export interface FileEntry {
  name: string
  kind: FileKind
  size?: number
  modified: string
  /** The whole path, for files listed away from their folder (Recents, a tag). */
  path?: string
}

/** One stretch of the server's history (averages; cpuMax is the busiest moment). */
export interface HistoryPoint {
  t: number
  cpu: number
  cpuMax: number
  /** Percent of memory used. */
  mem: number
  temp: number
  /** Bytes a second. */
  rx: number
  tx: number
  read: number
  write: number
  load: number
  watts: number
}

export type HistoryRange = '1h' | '24h' | '7d' | '30d'

export interface HistoryData {
  /** Seconds each point covers. */
  step: number
  /** When recording began (unix seconds). */
  since: number
  /** null where the server was off. */
  points: (HistoryPoint | null)[]
}

export interface AppIncident {
  start: string
  /** Missing while it's still down. */
  end?: string
  reason: string
  /** TemanLabsOS restarted it. */
  restarted?: boolean
}

export interface AppHealth {
  id: string
  status: 'up' | 'down' | 'stopped' | 'starting' | 'unknown'
  since?: string
  checked?: string
  error?: string
  autoRestart: boolean
  uptime24h: number
  uptime7d: number
  uptime30d: number
  watching: string
  incidents: AppIncident[]
}

/** Whether a native app can move into Docker, and how it would run there. */
export interface MovePreview {
  possible: boolean
  /** Why not, when it can't. */
  reason?: string
  /** Its pm2 name. */
  name?: string
  project?: string
  folder?: string
  node?: string
  compose?: string
}

/** A Docker app that came from pm2, and can go back. */
export interface MovedApp {
  app: string
  name: string
  project: string
  compose: string
  moved: string
}

/** yt-dlp, gallery-dl, streamlink and deno, in TemanLabsOS's own Python environment. */
export interface MediaTools {
  installed: boolean
  /** Installing or updating now. */
  working: boolean
  versions: Record<string, string>
  /** gallery-dl comes from its development version, with fixes not released yet. */
  galleryDev: boolean
}

export type DownloadMode = 'video' | 'audio' | 'photos'

export interface DownloadItem {
  id: string
  url: string
  /** files: chosen from a profile's list, fetched as they are. */
  mode: DownloadMode | 'files'
  quality: string
  playlist: boolean
  folder: string
  /** For the device in front of the browser, not the server's folders; kept there a day. */
  device?: boolean
  /** Its files for the device were removed. */
  expired?: boolean
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'
  title?: string
  site?: string
  uploader?: string
  percent: number
  size?: string
  speed?: string
  eta?: string
  /** Items in a playlist or album. */
  count?: number
  files: string[]
  error?: string
  added: string
  finished?: string
}

/** One video or file in a profile, channel or playlist being chosen from. */
export interface BrowseEntry {
  index: number
  kind: 'video' | 'image'
  title?: string
  thumb: boolean
  /** Seconds. */
  duration?: number
  date?: string
  /** The post it belongs to (a carousel's photos share one). */
  group?: string
  /** A video saved in the quality chosen (rather than a file as it is). */
  page?: boolean
}

export interface BrowseList {
  id: string
  url: string
  title: string
  uploader?: string
  site: string
  /** Of the thumbnails: square posts, wide (16:9) videos, tall (9:16) reels and stories. */
  shape: 'square' | 'wide' | 'tall'
  entries: BrowseEntry[]
  more: boolean
  /** A profile's handle (@name), whether it has a picture, and its tabs (posts, reels…). */
  handle?: string
  avatar: boolean
  followers?: number
  tabs?: string[]
  tab?: string
}

/** The saved cookies for one site. */
export interface CookieSite {
  site: string
  count: number
  /** Has a sign-in cookie, not just a visitor's. */
  signedIn: boolean
}

export interface Downloads {
  folder: string
  /** A cookies.txt is saved, for posts that need signing in. */
  cookies: boolean
  cookieSites: CookieSite[]
  cookiesAt?: string
  items: DownloadItem[]
}

export interface RecChannel {
  id: string
  url: string
  name: string
  platform: string
  quality: string
  /** Record by itself when it goes live. */
  auto: boolean
  /** 0 = keep recordings forever. */
  keepDays: number
  added: string
  live: boolean
  title?: string
  checked?: string
  error?: string
  /** The recording in progress. */
  recording?: string
}

export interface Recording {
  id: string
  channel: string
  title: string
  file: string
  status: 'recording' | 'converting' | 'done' | 'failed'
  started: string
  ended?: string
  bytes: number
  error?: string
}

export interface Recorder {
  folder: string
  channels: RecChannel[]
  recordings: Recording[]
}

export type BackupSchedule = 'manual' | 'daily' | 'weekly'

/** What a backup plan is set to; also the body for creating or changing one. */
export interface BackupPlanSettings {
  name: string
  /** Every Docker app's settings and data. */
  apps: boolean
  paths: string[]
  /** A folder, or "rclone:<remote>:<folder>" for a cloud drive. */
  dest: string
  schedule: BackupSchedule
  /** HH:MM, the server's time. */
  time: string
  /** 0 = Sunday, for weekly. */
  weekday: number
  keep: number
  pauseApps: boolean
}

export interface BackupPlan extends BackupPlanSettings {
  id: string
  created: string
  lastRun?: string
  lastOk: boolean
  lastError?: string
  lastWarning?: string
  lastAdded?: number
  lastTotal?: number
  lastFiles?: number
  running: boolean
  nextRun?: string
  destFree?: number
  /** On the same disk as the apps' data. */
  sameDisk?: boolean
}

export interface BackupsInfo {
  /** restic, the backup engine. */
  installed: boolean
  installing: boolean
  plans: BackupPlan[]
}

export interface BackupDestination {
  label: string
  dest: string
  cloud?: boolean
  free?: number
}

export interface BackupApp {
  id: string
  name: string
  paths: string[]
}

export interface BackupVersion {
  id: string
  time: string
  paths: string[]
  host: string
  /** Made by this plan, not another one (or another server) saving to the same place. */
  mine: boolean
}

export interface BackupFile {
  name: string
  path: string
  folder: boolean
  size?: number
  modified?: string
}

/** A link that lets anyone who has it download a file or folder, or send files into a folder. */
export interface ShareLink {
  id: string
  path: string
  name: string
  folder: boolean
  /** Visitors send files in, and can't see what's there. */
  upload: boolean
  created: string
  expires?: string
  expired: boolean
  hasPassword: boolean
  downloads: number
  uploads: number
  /** What it shared was deleted or moved. */
  missing?: boolean
}

export interface ShareLinks {
  /** The address links are given out with; empty for this desktop's own. */
  baseUrl: string
  links: ShareLink[]
}

export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray'

export interface TrashItem {
  id: string
  name: string
  /** The folder it was deleted from, where Put Back returns it. */
  from: string
  deleted: string
  kind: FileKind
  size?: number
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
  /** The app asks for an HTTP Basic login, which the window collects and the proxy sends. */
  auth?: 'basic'
  /** A saved sign-in that the app accepts. */
  signedIn?: boolean
  /** The saved (or last used) user name. */
  username?: string
}

export interface Session {
  authenticated: boolean
  /** Signed in, but behind the lock screen until the password is entered again. */
  locked?: boolean
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
  /** A small copy for the picker (falls back to url). */
  thumb?: string
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
  /** Where /etc/fstab mounts it at startup. */
  startup?: string
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

/** A container belonging to an installed app. */
export interface AppContainer {
  id: string
  name: string
  service?: string
  state: string
  image: string
}

/** An app's settings as App Settings edits them: its compose file and the main service as a form. */
export interface AppConfig {
  source: AppSource
  /** Whether there is a compose file to edit; reason says why not. */
  editable: boolean
  reason?: string
  canUpdate: boolean
  file?: string
  extraFiles?: string[]
  yaml?: string
  service?: string
  services?: string[]
  /** The edited service as the Manual Install form (arrays may be null). */
  spec?: CustomAppSpec
  containers: AppContainer[]
  /** Folders under /DATA/AppData that "delete app data" removes. */
  dataDirs: string[]
}

export interface ImageUpdate {
  image: string
  available: boolean
  /** Built on the server or not in a public registry: nothing to compare with. */
  local?: boolean
  error?: string
  checked: string
}

export interface AppUpdates {
  checking: boolean
  checked: string
  apps: Record<string, { available: boolean; images: ImageUpdate[] }>
}

/** A CasaOS-format app store TemanLabsOS downloads (a zip of Apps/<name>/docker-compose.yml). */
export interface StoreSource {
  id: string
  name: string
  url: string
  apps: number
  updated?: string
  error?: string
}

/** An app in the App Center: from a store, or one of TemanLabsOS's built-in picks (source "TemanLabsOS"). */
export interface StoreEntry {
  id: string
  name: string
  tagline: string
  category: string
  iconUrl: string
  developer?: string
  source: string
  port?: number
  /** Installed app running this (by store ID or image). */
  installedAs?: string
}

export interface StoreListing {
  syncing: boolean
  sources: StoreSource[]
  apps: StoreEntry[]
}

/** A store app ready to install: its compose file with $AppID, $PUID… filled in, and the form. */
export interface StoreAppDetails extends StoreEntry {
  description: string
  screenshots: string[] | null
  tips?: string
  /** Who packaged it for the store. */
  author?: string
  /** Processors it runs on (amd64, arm64…), when the store says. */
  architectures?: string[]
  yaml: string
  service: string
  services: string[]
  spec: CustomAppSpec
  /** The app ID it will install as (folders under /DATA/AppData use it). */
  appId: string
}

/** Drives merged into one folder with mergerfs. */
export interface MergedStorage {
  name: string
  target: string
  branches: string[]
  mounted: boolean
  size: number
  free: number
}

export interface StorageInfo {
  fstab: { source: string; target: string; fstype: string; options: string; managed: boolean }[]
  merged: MergedStorage[]
  /** Whether mergerfs is installed. */
  mergerfs: boolean
  usbAutomount: boolean
  /** Filesystems Format can create on this server. */
  filesystems: string[]
}

export type FormatFS = 'ext4' | 'xfs' | 'btrfs' | 'exfat' | 'ntfs'

export interface CloudProvider {
  type: string
  name: string
  /** Signs in through the provider's page (Google Drive, Dropbox, OneDrive). */
  oauth?: boolean
  fields?: { key: string; label: string; placeholder?: string; secret?: boolean; optional?: boolean }[]
}

export interface CloudRemote {
  name: string
  type: string
  mount: string
  mounted: boolean
  service: string
  error?: string
}

export interface CloudInfo {
  rclone: boolean
  providers: CloudProvider[]
  remotes: CloudRemote[]
}

/** TemanLabsOS's own version and the newest GitHub release. */
/** An app and whether it starts by itself when the server boots. */
export interface StartupApp {
  id: string
  name: string
  icon: string
  iconUrl?: string
  color: [string, string]
  enabled: boolean
  /** Always starts (ssh, TemanLabsOS itself). */
  locked?: boolean
}

/** What the server is, from its firmware. */
export interface HardwareInfo {
  vendor?: string
  model?: string
  /** The maker's number for the model (Lenovo's machine type), when the model is a name. */
  modelNumber?: string
  kind: 'mini' | 'desktop' | 'laptop' | 'allinone' | 'server' | 'board' | 'virtual' | 'unknown'
  /** The hypervisor, for a virtual server. */
  virtualization?: string
  serial?: string
  /** The firmware's year. */
  year?: string
}

export interface ReleaseStatus {
  current: string
  latest?: string
  available: boolean
  notes?: string
  url?: string
  published?: string
  checked?: string
  error?: string
  arch: string
}

// ----- Remux (ffmpeg) -----

export type ConvertContainer = 'mp4' | 'mkv' | 'webm' | 'mov' | 'ts' | 'mp3' | 'm4a' | 'flac' | 'opus' | 'wav'
export type ConvertVideo = 'copy' | 'h264' | 'hevc' | 'vp9' | 'av1'
export type ConvertAudio = 'copy' | 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm' | 'none'
export type ConvertQuality = 'high' | 'medium' | 'small'

export interface ProbeStream {
  index: number
  type: 'video' | 'audio' | 'subtitle' | 'attachment' | 'data'
  codec: string
  width?: number
  height?: number
  fps?: number
  hdr?: boolean
  channels?: number
  language?: string
  title?: string
  /** A cover picture, not part of the film. */
  cover?: boolean
  bitrate?: number
}

export interface MediaProbe {
  path: string
  /** ffmpeg's name for the container ("matroska,webm", "mov,mp4,m4a,3gp,3g2,mj2"). */
  container: string
  duration: number
  size: number
  bitrate?: number
  streams: ProbeStream[]
  /** Per result format: why its video or sound can't be copied in as it is (unset when it can). */
  remux: Record<ConvertContainer, { video?: string; audio?: string }>
}

export interface ConvertRequest {
  path: string
  container: ConvertContainer
  video: ConvertVideo
  audio: ConvertAudio
  quality: ConvertQuality
  /** Shrink to this height; 0 keeps the size. */
  height: number
  subtitles: boolean
  /** The result's file name, in the same folder; optional. */
  name?: string
}

export interface ConvertTask {
  id: string
  input: string
  output: string
  container: ConvertContainer
  video?: ConvertVideo
  audio: ConvertAudio
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  /** × real time. */
  speed?: number
  /** MP4/MOV's last pass (moving the index to the front of the file), and how far it is. */
  final?: boolean
  finishing?: number
  error?: string
  size?: number
  /** Of the input, in seconds. */
  duration: number
  created: string
  started?: string
  ended?: string
}

export interface ConvertInfo {
  ffmpeg: boolean
  version?: string
  /** Codecs this server's ffmpeg can make (h264, hevc, vp9, av1, aac, opus, mp3, flac, pcm). */
  encoders: string[]
  tasks: ConvertTask[]
}

// ----- Commands (command book) -----

export interface CommandApp {
  id: string
  name: string
  containers?: string[]
  /** Compose apps: the project, its folder and compose files. */
  project?: string
  dir?: string
  files?: string[]
  /** Native apps: the systemd service that runs it. */
  unit?: string
}

/** A command the user saved themselves. */
export interface SavedCommand {
  id: string
  title: string
  command: string
  note?: string
  keywords?: string
}

export interface CommandBook {
  custom: SavedCommand[]
  /** Ids of starred commands (library, app and saved ones alike). */
  favorites: string[]
}

export interface CommandsInfo {
  /** Which of the asked-for programs are installed. */
  tools: Record<string, boolean>
  apps: CommandApp[]
  book: CommandBook
  /** The shell history of the TemanLabsOS user, newest first. */
  history: string[]
  user: string
  /** The user is in the docker group, so docker needs no sudo. */
  dockerGroup: boolean
}

/** Get Info: everything about one file or folder. */
export interface FileDetails {
  name: string
  path: string
  kind: FileKind
  folder: boolean
  size: number
  /** Folders: entries directly inside, and everything inside added up (partial: it took too long). */
  items?: number
  total?: number
  files?: number
  partial?: boolean
  modified: string
  accessed?: string
  changed?: string
  /** Not every filesystem records it. */
  created?: string
  /** e.g. -rw-r--r-- (the last nine characters are the permissions). */
  mode: string
  octal: string
  owner: string
  group: string
  uid: number
  gid: number
  /** A symlink's target. */
  link?: string
  mime?: string
  hidden?: boolean
  volume?: { mount: string; fstype: string; size: number; free: number }
  media?: { width?: number; height?: number; duration?: number; video?: string; audio?: string; fps?: number; bitrate?: number; channels?: number }
}

// ----- Devices (Wake-on-LAN and remote screens) -----

export type DeviceKind = 'windows' | 'mac' | 'linux' | 'other'
/** How its screen is shown: VNC, RDP, or not at all (wake only). */
export type ScreenProtocol = 'vnc' | 'rdp' | ''

export interface Device {
  id: string
  name: string
  kind: DeviceKind
  /** IP address or host name. */
  host: string
  /** For Wake-on-LAN; empty when not set. */
  mac: string
  protocol: ScreenProtocol
  port: number
  username: string
  /** Whether a password is saved (it never leaves the server). */
  hasPassword: boolean
}

/** A device to save; leaving out password keeps the saved one. */
export type DeviceInput = Omit<Device, 'id' | 'hasPassword'> & { password?: string }

export interface DeviceStatus {
  online: boolean
  /** Its screen-sharing port answers. */
  screen: boolean
  latency?: number
}

/** The remote desktop engine (a container on the server). */
export interface RemoteEngine {
  docker: boolean
  installed: boolean
  running: boolean
  installing: boolean
  step?: string
  error?: string
}

/** A computer found on the local network. */
export interface FoundDevice {
  ip: string
  mac: string
  name?: string
  kind: DeviceKind
  ports: number[] | null
  self?: boolean
  router?: boolean
}

// ----- Ad blocking (AdGuard Home, run by the server) -----

export interface AdblockStatus {
  docker: boolean
  installed: boolean
  running: boolean
  installing: boolean
  step?: string
  error?: string
  /** Blocking is on; while paused, the seconds left. */
  protection: boolean
  pausedFor?: number
  /** Rules in the block lists. */
  rules: number
  /** Domains let through anyway. */
  allowed: string[]
  /** Extra lists that are on (gambling, strict, indonesia, bypass) and their rule counts. */
  lists: Record<string, number>
  stats?: {
    queries: number
    blocked: number
    avgMs: number
    topBlocked: { name: string; count: number }[] | null
    topClients: { name: string; count: number; label?: string }[] | null
  }
  version?: string
  /** Running but not answering yet (still starting). */
  unresponsive?: boolean
}

/** A browser signed in to TemanLabsOS (Settings → Login & Password). */
export interface SignedInBrowser {
  id: string
  current: boolean
  created?: string
  seen?: string
  addr?: string
  agent?: string
  locked?: boolean
}
