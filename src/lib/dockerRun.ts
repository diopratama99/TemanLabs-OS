import type { CustomAppSpec } from '../api/types'

/** Splits a shell command line the way sh would: quotes, backslash escapes and line continuations. */
export function shellSplit(line: string): string[] {
  const words: string[] = []
  let word = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) word += line[++i]
      else word += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      inWord = true
    } else if (ch === '\\') {
      const next = line[++i]
      // Backslash-newline is a line continuation; anything else is taken literally.
      if (next !== undefined && next !== '\n' && next !== '\r') {
        word += next
        inWord = true
      }
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(word)
      word = ''
      inWord = false
    } else {
      word += ch
      inWord = true
    }
  }
  if (inWord) words.push(word)
  return words
}

// `docker run` flags that take a value (the rest are switches). Unknown ones are skipped.
const VALUE_FLAGS = new Set([
  '-p', '--publish', '-v', '--volume', '-e', '--env', '--env-file', '--name', '--network', '--net', '--restart',
  '--device', '--cap-add', '--cap-drop', '-m', '--memory', '-c', '--cpu-shares', '-h', '--hostname', '-l', '--label',
  '-w', '--workdir', '-u', '--user', '--entrypoint', '--add-host', '--dns', '--mount', '--log-driver', '--log-opt',
  '--shm-size', '--ulimit', '--security-opt', '--sysctl', '--tmpfs', '--cpus', '--memory-swap', '--pid', '--ipc',
  '--gpus', '--health-cmd', '--health-interval', '--platform', '--pull', '--stop-signal', '--stop-timeout',
])

const parseMemoryMb = (value: string) => {
  const m = /^(\d+(?:\.\d+)?)\s*([bkmg]?)b?$/i.exec(value.trim())
  if (!m) return 0
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  return Math.round(unit === 'g' ? n * 1024 : unit === 'k' ? n / 1024 : unit === 'b' ? n / 1024 ** 2 : n)
}

/**
 * Fills the Manual Install form from a `docker run …` command. Returns only the fields the
 * command sets, plus `skipped`: flags the form can't express.
 */
export function parseDockerRun(command: string): { spec: Partial<CustomAppSpec>; skipped: string[] } {
  let args = shellSplit(command.trim())
  const start = args.findIndex((a, i) => a === 'run' && args[i - 1]?.endsWith('docker'))
  if (start >= 0) args = args.slice(start + 1)
  else if (args[0] === 'run') args = args.slice(1)
  else if (args[0]?.endsWith('docker')) throw new Error('Only “docker run” commands can be imported.')

  const spec: Partial<CustomAppSpec> = { ports: [], volumes: [], env: [], devices: [], capAdd: [] }
  const skipped: string[] = []
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('-') || arg === '-') break
    let flag = arg
    let value: string | undefined
    const eq = arg.indexOf('=')
    if (arg.startsWith('--') && eq > 0) {
      flag = arg.slice(0, eq)
      value = arg.slice(eq + 1)
    } else if (/^-[a-zA-Z]./.test(arg)) {
      // A short flag with its value attached (-p8080:80), or bundled switches like -it or -dit.
      const short = arg.slice(0, 2)
      if (VALUE_FLAGS.has(short)) {
        flag = short
        value = arg.slice(2).replace(/^=/, '')
      } else if (/^-[a-zA-Z]+$/.test(arg)) {
        continue
      }
    }
    if (VALUE_FLAGS.has(flag) && value === undefined) value = args[++i] ?? ''
    if (value === undefined) {
      if (flag === '--privileged') spec.privileged = true
      else if (!['-d', '--detach', '-i', '-t', '--interactive', '--tty', '--rm', '--init'].includes(flag)) skipped.push(flag)
      continue
    }
    switch (flag) {
      case '-p':
      case '--publish': {
        const [mapping, proto = 'tcp'] = value.split('/')
        const parts = mapping.split(':')
        // [ip:]host:container or just container.
        const container = Number(parts.at(-1))
        const host = parts.length > 1 ? Number(parts.at(-2)) : container
        if (container && !mapping.includes('-')) {
          spec.ports!.push({ host: host || container, container, protocol: proto === 'udp' ? 'udp' : 'tcp' })
        } else skipped.push(`${flag} ${value}`)
        break
      }
      case '-v':
      case '--volume': {
        const [host, container, mode] = value.split(':')
        if (host?.startsWith('/') && container) spec.volumes!.push({ host, container, readOnly: mode?.split(',').includes('ro') ?? false })
        else skipped.push(`${flag} ${value} (only host folders are supported)`)
        break
      }
      case '-e':
      case '--env': {
        const at = value.indexOf('=')
        spec.env!.push(at >= 0 ? { key: value.slice(0, at), value: value.slice(at + 1) } : { key: value, value: '' })
        break
      }
      case '--name':
        spec.title = value
        break
      case '--network':
      case '--net':
        spec.network = value
        break
      case '--restart': {
        const policy = value.split(':')[0]
        if (policy === 'always' || policy === 'unless-stopped' || policy === 'on-failure' || policy === 'no') spec.restart = policy
        break
      }
      case '--device': {
        const [host, container] = value.split(':')
        spec.devices!.push({ host, container: container ?? host })
        break
      }
      case '--cap-add':
        spec.capAdd!.push(value)
        break
      case '-m':
      case '--memory':
        spec.memoryMb = parseMemoryMb(value)
        break
      case '-c':
      case '--cpu-shares':
        spec.cpuShares = Number(value) || 0
        break
      case '-h':
      case '--hostname':
        spec.hostname = value
        break
      default:
        skipped.push(`${flag} ${value}`)
    }
  }

  const image = args[i]
  if (!image) throw new Error('No image found in the command.')
  // Split off the tag, but not a registry port (registry:5000/name).
  const slash = image.lastIndexOf('/')
  const colon = image.lastIndexOf(':')
  if (colon > slash && !image.includes('@')) {
    spec.image = image.slice(0, colon)
    spec.tag = image.slice(colon + 1)
  } else {
    spec.image = image
    spec.tag = ''
  }
  const rest = args.slice(i + 1)
  if (rest.length) spec.command = rest.map(a => (/[\s"'\\$]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' ')
  return { spec, skipped }
}
