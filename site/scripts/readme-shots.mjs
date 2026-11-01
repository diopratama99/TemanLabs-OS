// Takes the README's screenshots from TemanLabsOS itself, running with sample data (npm run
// dev:mock), in English: docs/screenshots/<name>.png, 1440 × 900, the whole desktop.
//
//   node scripts/readme-shots.mjs                 every screenshot
//   node scripts/readme-shots.mjs desktop files   just these
//
// Run from site/ (it uses the site's puppeteer). Needs Chrome or Chromium: set CHROME to its path
// if it isn't found.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const out = join(root, 'docs', 'screenshots')
const PORT = 5198
const URL = `http://localhost:${PORT}`
const only = process.argv.slice(2)
const wait = ms => new Promise(r => setTimeout(r, ms))

const chrome =
  process.env.CHROME ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(p => existsSync(p))
if (!chrome) throw new Error('Chrome not found: set CHROME to its path')

async function up() {
  try {
    await fetch(URL)
    return null
  } catch {}
  const vite = spawn('npx', ['vite', '--mode', 'mock', '--port', String(PORT), '--strictPort'], { cwd: root, shell: true, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    await wait(500)
    try {
      await fetch(URL)
      return vite
    } catch {}
  }
  throw new Error('the sample-data desktop did not start')
}
function down(vite) {
  if (!vite) return
  if (process.platform === 'win32') execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: 'ignore' })
  else vite.kill()
}

let browser
async function desktop(theme = 'dark') {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  page.on('pageerror', e => console.log('  page error:', e.message))
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  // A fresh desktop each time, in English, in the theme asked for.
  await page.evaluateOnNewDocument(theme => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('temanlabs.settings', JSON.stringify({ language: 'en', theme }))
  }, theme)
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dock')
  await wait(1500)
  return page
}
const call = (page, fn, ...args) => page.evaluate((fn, args) => window.temanlabs[fn](...args), fn, args)
// Clicks the first element in the window in front that matches selector and has text.
const clickText = (page, selector, text) =>
  page.evaluate(
    (s, t) => {
      const el = [...document.querySelectorAll(`.window.is-active ${s}`)].find(e => e.textContent.trim() === t || e.textContent.includes(t))
      el?.click()
      return !!el
    },
    selector,
    text,
  )

async function save(page, name) {
  await page.mouse.move(720, 897)
  await wait(600)
  mkdirSync(out, { recursive: true })
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log(`  ${name}`)
  await page.close()
}

const scenes = {
  async desktop() {
    const page = await desktop()
    await wait(5000) // some history for the widgets' graphs
    await save(page, 'desktop')
  },
  async backup() {
    const page = await desktop()
    await call(page, 'openSettings', 'backup')
    await wait(2000)
    await save(page, 'backup')
  },
  async history() {
    const page = await desktop()
    await call(page, 'openWindow', 'activity')
    await wait(1500)
    await clickText(page, '.tb-segmented button', 'History')
    await wait(2500)
    await save(page, 'history')
  },
  async apps() {
    const page = await desktop()
    await call(page, 'openSettings', 'apps')
    await wait(2000)
    await save(page, 'apps')
  },
  async share() {
    const page = await desktop()
    await call(page, 'openFilesAt', '/DATA')
    await wait(1500)
    // Right-click Downloads, then Share Link…
    const box = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.window.is-active .files-scroll *')].find(e => e.children.length === 0 && e.textContent.trim() === 'Downloads')
      const r = el?.getBoundingClientRect()
      return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    if (box) {
      await page.mouse.click(box.x, box.y, { button: 'right' })
      await wait(500)
      await page.evaluate(() => [...document.querySelectorAll('.context-menu button, [role="menuitem"]')].find(b => b.textContent.includes('Share Link'))?.click())
      await wait(1200)
    }
    await save(page, 'share')
  },
  async 'app-center'() {
    const page = await desktop()
    await call(page, 'openWindow', 'store')
    await wait(2500)
    await save(page, 'app-center')
  },
  async devices() {
    const page = await desktop()
    await call(page, 'openWindow', 'devices')
    await wait(2500)
    await save(page, 'devices')
  },
  async files() {
    const page = await desktop()
    await call(page, 'openFilesAt', '/DATA/Gallery')
    await wait(2500)
    await save(page, 'files')
  },
  async launcher() {
    const page = await desktop()
    await page.evaluate(() => document.querySelector('.dock button, .dock [role="button"]')?.click())
    await wait(1500)
    await save(page, 'launcher')
  },
  async about() {
    const page = await desktop()
    await call(page, 'openSettings', 'about')
    await wait(2000)
    await save(page, 'about')
  },
  async light() {
    const page = await desktop('light')
    await wait(3000)
    await call(page, 'openSettings', 'appearance')
    await wait(2000)
    await save(page, 'light')
  },
  async commands() {
    const page = await desktop()
    await call(page, 'openWindow', 'commands')
    await wait(1500)
    await page.keyboard.type('see which ports are open', { delay: 15 })
    await wait(1500)
    await save(page, 'commands')
  },
  async network() {
    const page = await desktop()
    await call(page, 'openWindow', 'network')
    await wait(2500)
    await save(page, 'network')
  },
  async speedtest() {
    const page = await desktop()
    await call(page, 'openWindow', 'speedtest')
    await wait(2500)
    await save(page, 'speedtest')
  },
  async monitor() {
    const page = await desktop()
    await call(page, 'openWindow', 'activity')
    await wait(3000)
    await save(page, 'monitor')
  },
  async code() {
    const page = await desktop()
    await call(page, 'openWindow', 'code')
    await wait(1500)
    for (const row of ['Projects', 'teman-app', 'lib', 'main.dart']) {
      await clickText(page, '.ce-row', row)
      await wait(500)
    }
    await wait(2500)
    await save(page, 'code')
  },
  async kubernetes() {
    const page = await desktop()
    await call(page, 'openWindow', 'kubernetes')
    await wait(2500)
    await save(page, 'kubernetes')
  },
}

const vite = await up()
browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' })
try {
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue
    await scene().catch(e => console.log(`  ${name} FAILED: ${e.message}`))
  }
} finally {
  await browser.close()
  down(vite)
}
