// Mock data for the system utilities (npm run dev:mock), shaped like the real server's answers.
import type {
  K8sActionRequest,
  K8sPod,
  K8sResources,
  K8sService,
  K8sStatus,
  K8sWorkload,
  AptUpdate,
  BlockDevice,
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

const sources = ['systemd', 'sshd', 'dockerd', 'casaos-gateway', 'kernel', 'sudo', 'cron']
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
]

export const mockSystem = {
  async job(kind: string) {
    return kind === 'apt' ? aptJob : { kind, running: false, log: [] }
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
  async mountDisk() {
    return { message: 'Done' }
  },
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
