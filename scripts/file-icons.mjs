// Copies the file icons Code uses from the Material Icon Theme package (MIT, the icon theme most
// used in VS Code) into public/file-icons: the SVGs its mapping refers to, the mapping itself, and
// its license. Code fetches map.json when it opens; each SVG downloads only when it's shown.
//
// map.json lists, per icon, the names that get it ({ icon: [names] }, smaller than the other way
// round): "ext" file extensions, "names" file names, "folders" folder names, "langs" language ids;
// "light" overrides them on light backgrounds. An open folder's icon is "<icon>-open".
//
//   npm pack material-icon-theme@<version> && tar -xzf material-icon-theme-*.tgz
//   node scripts/file-icons.mjs <path to the unpacked package>
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = process.argv[2]
if (!pkg) {
  console.error('usage: node scripts/file-icons.mjs <unpacked material-icon-theme package>')
  process.exit(1)
}
const out = 'public/file-icons'
const manifest = JSON.parse(readFileSync(join(pkg, 'dist/material-icons.json'), 'utf8'))
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
const defs = manifest.iconDefinitions

const used = new Set([manifest.file, manifest.folder, manifest.folderExpanded])
const invert = group => {
  const byIcon = {}
  for (const [name, id] of Object.entries(group ?? {})) {
    if (!defs[id]) continue
    ;(byIcon[id] ??= []).push(name)
    used.add(id)
  }
  return byIcon
}
const pick = m => ({ ext: invert(m.fileExtensions), names: invert(m.fileNames), folders: invert(m.folderNames), langs: invert(m.languageIds) })
const map = { file: manifest.file, folder: manifest.folder, ...pick(manifest), light: pick(manifest.light ?? {}) }
// Open folders: "<icon>-open", which the theme always has.
for (const id of [...used]) if (defs[`${id}-open`]) used.add(`${id}-open`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
let copied = 0
for (const id of used) {
  const def = defs[id]
  const from = def && join(pkg, 'dist', def.iconPath)
  if (!from || !existsSync(from)) continue
  copyFileSync(from, join(out, `${id}.svg`))
  copied++
}
writeFileSync(join(out, 'map.json'), JSON.stringify(map))
copyFileSync(join(pkg, 'LICENSE'), join(out, 'LICENSE'))
writeFileSync(
  join(out, 'README.md'),
  `File icons from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) ${version}, under its MIT license (LICENSE). Regenerate with scripts/file-icons.mjs.\n`,
)
console.log(`${copied} icons; map.json ${(JSON.stringify(map).length / 1024).toFixed(0)} KB`)
