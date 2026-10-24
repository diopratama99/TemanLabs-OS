// Builds the frontend, embeds it into the Go server and cross-compiles a Linux binary:
//   node scripts/build-server.mjs [amd64|arm64]
// Needs Go on PATH (or GO=/path/to/go). Output: server/bin/temanlabsos-linux-<arch>
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const server = join(root, 'server')
const arch = process.argv[2] ?? 'amd64'
const go = process.env.GO ?? 'go'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })

// npm is a .cmd script on Windows and needs a shell; go doesn't (and a shell would split "-s -w").
run('npm', ['run', 'build'], { cwd: root, shell: process.platform === 'win32' })

rmSync(join(server, 'web'), { recursive: true, force: true })
cpSync(join(root, 'dist'), join(server, 'web'), { recursive: true })

const out = join(server, 'bin', `temanlabsos-linux-${arch}`)
mkdirSync(dirname(out), { recursive: true })
// The version shown in Settings and compared with GitHub releases: TEMANLABS_VERSION (the
// release workflow sets it to the tag), else git describe, else package.json.
const describe = () => {
  try {
    return execFileSync('git', ['describe', '--tags', '--always', '--dirty'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const version = process.env.TEMANLABS_VERSION || describe() || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
run(go, ['build', '-trimpath', '-ldflags', `-s -w -X main.version=${version}`, '-o', out, '.'], {
  cwd: server,
  env: { ...process.env, GOOS: 'linux', GOARCH: arch, CGO_ENABLED: '0' },
})
console.log(`\nBuilt ${out} (${version})`)
