import type { FileKind } from '../api/types'

export interface Language {
  /** Monaco language id. */
  id: string
  name: string
}

const lang = (id: string, name: string): Language => ({ id, name })

// Like VS Code, a file's whole name is looked at first (LICENSE, Dockerfile, .gitignore), then its
// extensions from the longest (a.d.ts: "d.ts", then "ts"); a name starting with a dot counts the
// rest as its extension (.env → "env").
const BY_EXTENSION: Record<string, Language> = {
  ts: lang('typescript', 'TypeScript'),
  mts: lang('typescript', 'TypeScript'),
  cts: lang('typescript', 'TypeScript'),
  'd.ts': lang('typescript', 'TypeScript Declarations'),
  tsx: lang('typescript', 'TypeScript JSX'),
  js: lang('javascript', 'JavaScript'),
  mjs: lang('javascript', 'JavaScript'),
  cjs: lang('javascript', 'JavaScript'),
  jsx: lang('javascript', 'JavaScript JSX'),
  json: lang('json', 'JSON'),
  jsonc: lang('json', 'JSON with Comments'),
  json5: lang('json', 'JSON5'),
  webmanifest: lang('json', 'Web Manifest'),
  geojson: lang('json', 'GeoJSON'),
  ipynb: lang('json', 'Jupyter Notebook'),
  html: lang('html', 'HTML'),
  htm: lang('html', 'HTML'),
  xhtml: lang('html', 'HTML'),
  vue: lang('html', 'Vue'),
  svelte: lang('html', 'Svelte'),
  astro: lang('html', 'Astro'),
  ejs: lang('html', 'EJS'),
  hbs: lang('handlebars', 'Handlebars'),
  handlebars: lang('handlebars', 'Handlebars'),
  twig: lang('twig', 'Twig'),
  liquid: lang('liquid', 'Liquid'),
  pug: lang('pug', 'Pug'),
  css: lang('css', 'CSS'),
  scss: lang('scss', 'SCSS'),
  sass: lang('scss', 'Sass'),
  less: lang('less', 'Less'),
  md: lang('markdown', 'Markdown'),
  markdown: lang('markdown', 'Markdown'),
  mdx: lang('mdx', 'MDX'),
  rst: lang('restructuredtext', 'reStructuredText'),
  yml: lang('yaml', 'YAML'),
  yaml: lang('yaml', 'YAML'),
  xml: lang('xml', 'XML'),
  svg: lang('xml', 'SVG'),
  plist: lang('xml', 'Property List'),
  csproj: lang('xml', 'MSBuild'),
  sh: lang('shell', 'Shell Script'),
  bash: lang('shell', 'Shell Script'),
  zsh: lang('shell', 'Shell Script'),
  fish: lang('shell', 'Shell Script'),
  ps1: lang('powershell', 'PowerShell'),
  psm1: lang('powershell', 'PowerShell'),
  psd1: lang('powershell', 'PowerShell'),
  bat: lang('bat', 'Batch'),
  cmd: lang('bat', 'Batch'),
  py: lang('python', 'Python'),
  pyw: lang('python', 'Python'),
  pyi: lang('python', 'Python'),
  go: lang('go', 'Go'),
  rs: lang('rust', 'Rust'),
  dart: lang('dart', 'Dart'),
  java: lang('java', 'Java'),
  kt: lang('kotlin', 'Kotlin'),
  kts: lang('kotlin', 'Kotlin'),
  gradle: lang('kotlin', 'Gradle'),
  scala: lang('scala', 'Scala'),
  sc: lang('scala', 'Scala'),
  swift: lang('swift', 'Swift'),
  m: lang('objective-c', 'Objective-C'),
  mm: lang('objective-c', 'Objective-C++'),
  c: lang('c', 'C'),
  h: lang('c', 'C'),
  cpp: lang('cpp', 'C++'),
  cc: lang('cpp', 'C++'),
  cxx: lang('cpp', 'C++'),
  hpp: lang('cpp', 'C++'),
  hh: lang('cpp', 'C++'),
  ino: lang('cpp', 'Arduino'),
  cs: lang('csharp', 'C#'),
  fs: lang('fsharp', 'F#'),
  fsx: lang('fsharp', 'F#'),
  vb: lang('vb', 'Visual Basic'),
  php: lang('php', 'PHP'),
  rb: lang('ruby', 'Ruby'),
  erb: lang('html', 'ERB'),
  lua: lang('lua', 'Lua'),
  pl: lang('perl', 'Perl'),
  pm: lang('perl', 'Perl'),
  r: lang('r', 'R'),
  jl: lang('julia', 'Julia'),
  ex: lang('elixir', 'Elixir'),
  exs: lang('elixir', 'Elixir'),
  clj: lang('clojure', 'Clojure'),
  cljs: lang('clojure', 'ClojureScript'),
  edn: lang('clojure', 'EDN'),
  coffee: lang('coffee', 'CoffeeScript'),
  scm: lang('scheme', 'Scheme'),
  pas: lang('pascal', 'Pascal'),
  tcl: lang('tcl', 'Tcl'),
  sv: lang('systemverilog', 'SystemVerilog'),
  svh: lang('systemverilog', 'SystemVerilog'),
  v: lang('systemverilog', 'Verilog'),
  sol: lang('solidity', 'Solidity'),
  wgsl: lang('wgsl', 'WGSL'),
  bicep: lang('bicep', 'Bicep'),
  sql: lang('sql', 'SQL'),
  mysql: lang('mysql', 'MySQL'),
  pgsql: lang('pgsql', 'PostgreSQL'),
  graphql: lang('graphql', 'GraphQL'),
  gql: lang('graphql', 'GraphQL'),
  proto: lang('protobuf', 'Protocol Buffers'),
  tf: lang('hcl', 'Terraform'),
  tfvars: lang('hcl', 'Terraform'),
  hcl: lang('hcl', 'HCL'),
  ini: lang('ini', 'Ini'),
  conf: lang('ini', 'Config'),
  cfg: lang('ini', 'Config'),
  cnf: lang('ini', 'Config'),
  properties: lang('ini', 'Properties'),
  toml: lang('ini', 'TOML'),
  env: lang('ini', 'Environment'),
  service: lang('ini', 'systemd Unit'),
  timer: lang('ini', 'systemd Unit'),
  socket: lang('ini', 'systemd Unit'),
  mount: lang('ini', 'systemd Unit'),
  network: lang('ini', 'systemd Unit'),
  desktop: lang('ini', 'Desktop Entry'),
  reg: lang('ini', 'Registry'),
  txt: lang('plaintext', 'Plain Text'),
  text: lang('plaintext', 'Plain Text'),
  log: lang('plaintext', 'Log'),
  csv: lang('plaintext', 'CSV'),
  tsv: lang('plaintext', 'TSV'),
  diff: lang('plaintext', 'Diff'),
  patch: lang('plaintext', 'Diff'),
  lock: lang('plaintext', 'Lock File'),
  sum: lang('plaintext', 'Checksums'),
  mod: lang('plaintext', 'Go Module'),
  gitignore: lang('plaintext', 'Ignore'),
  dockerignore: lang('plaintext', 'Ignore'),
  dockerfile: lang('dockerfile', 'Dockerfile'),
  containerfile: lang('dockerfile', 'Dockerfile'),
}

const BY_NAME: Record<string, Language> = {
  dockerfile: lang('dockerfile', 'Dockerfile'),
  containerfile: lang('dockerfile', 'Dockerfile'),
  makefile: lang('plaintext', 'Makefile'),
  gnumakefile: lang('plaintext', 'Makefile'),
  'cmakelists.txt': lang('plaintext', 'CMake'),
  caddyfile: lang('plaintext', 'Caddyfile'),
  procfile: lang('plaintext', 'Procfile'),
  license: lang('plaintext', 'License'),
  licence: lang('plaintext', 'License'),
  'license.md': lang('markdown', 'Markdown'),
  copying: lang('plaintext', 'License'),
  notice: lang('plaintext', 'Plain Text'),
  authors: lang('plaintext', 'Plain Text'),
  readme: lang('plaintext', 'Plain Text'),
  changelog: lang('plaintext', 'Plain Text'),
  todo: lang('plaintext', 'Plain Text'),
  gemfile: lang('ruby', 'Ruby'),
  rakefile: lang('ruby', 'Ruby'),
  vagrantfile: lang('ruby', 'Ruby'),
  podfile: lang('ruby', 'Ruby'),
  jenkinsfile: lang('java', 'Jenkinsfile'),
  'go.mod': lang('plaintext', 'Go Module'),
  'go.sum': lang('plaintext', 'Go Checksums'),
  '.gitignore': lang('plaintext', 'Ignore'),
  '.dockerignore': lang('plaintext', 'Ignore'),
  '.npmignore': lang('plaintext', 'Ignore'),
  '.prettierignore': lang('plaintext', 'Ignore'),
  '.eslintignore': lang('plaintext', 'Ignore'),
  '.gitattributes': lang('plaintext', 'Git Attributes'),
  '.gitmodules': lang('ini', 'Git Config'),
  '.gitconfig': lang('ini', 'Git Config'),
  '.editorconfig': lang('ini', 'EditorConfig'),
  '.npmrc': lang('ini', 'npm Config'),
  '.yarnrc': lang('ini', 'Yarn Config'),
  '.nvmrc': lang('plaintext', 'Plain Text'),
  '.prettierrc': lang('json', 'JSON'),
  '.eslintrc': lang('json', 'JSON'),
  '.babelrc': lang('json', 'JSON'),
  '.bashrc': lang('shell', 'Shell Script'),
  '.bash_profile': lang('shell', 'Shell Script'),
  '.bash_aliases': lang('shell', 'Shell Script'),
  '.bash_logout': lang('shell', 'Shell Script'),
  '.profile': lang('shell', 'Shell Script'),
  '.zshrc': lang('shell', 'Shell Script'),
  '.zprofile': lang('shell', 'Shell Script'),
  '.vimrc': lang('plaintext', 'Vim Script'),
  '.htaccess': lang('ini', 'Apache Config'),
  crontab: lang('shell', 'Crontab'),
  hosts: lang('plaintext', 'Hosts'),
  fstab: lang('plaintext', 'fstab'),
  'nginx.conf': lang('ini', 'Nginx Config'),
}

const MEDIA: Record<string, FileKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  mp4: 'video',
  mkv: 'video',
  mov: 'video',
  avi: 'video',
  webm: 'video',
  m2ts: 'video',
  mts: 'video',
  mp3: 'audio',
  flac: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  iso: 'archive',
  xz: 'archive',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
}

/** A name's extensions, longest first: "a.d.ts" → ["d.ts", "ts"]; ".env.local" → ["env.local", "local"]. */
export function extensionsOf(name: string): string[] {
  // "Makefile" has none; ".env" has "env" (the part before its dot is empty).
  const parts = name.toLowerCase().split('.')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    if (ext) out.push(ext)
  }
  return out
}

/** The editor language for a file, or null when it isn't a text file the editor can open. */
export function languageFor(name: string): Language | null {
  const lower = name.toLowerCase()
  const byName = BY_NAME[lower]
  if (byName) return byName
  // .env, .env.local, .env.production…
  if (lower === '.env' || lower.startsWith('.env.')) return BY_EXTENSION.env
  for (const ext of extensionsOf(name)) {
    const found = BY_EXTENSION[ext]
    if (found) return found
  }
  return null
}

export const isTextFile = (name: string) => languageFor(name) !== null

export function fileKind(name: string): FileKind {
  const media = MEDIA[extensionsOf(name).at(-1) ?? '']
  if (media) return media
  // An SVG is a picture first, though Code can open it.
  if (name.toLowerCase().endsWith('.svg')) return 'image'
  const language = languageFor(name)
  return language && language.id !== 'markdown' && language.id !== 'plaintext' ? 'code' : 'document'
}
