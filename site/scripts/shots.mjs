// Takes the website's screenshots from TemanLabsOS itself, running with sample data (npm run
// dev:mock), in English and Indonesian: public/shots/<lang>/<name>.webp, plus a half-size
// <name>@1x.webp for small screens.
//
//   npm run shots                 every screenshot
//   npm run shots -- hero files   just these
//
// Needs Chrome or Chromium: set CHROME to its path if it isn't found.
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const out = join(here, '..', 'public', 'shots')
const PORT = 5199
const URL = `http://localhost:${PORT}`
const LANGS = ['en', 'id']
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

// ----- The desktop with sample data -----
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

// A fuller desktop than the default: the system widgets plus a calendar, a note and a to-do list.
const WIDGETS = {
  en: { note: 'Weekend\n• Back up photos to the HDD\n• Update Jellyfin\n• Try the new dashboard', todo: 'Server', items: ['Renew domain', 'New disk', 'Backups'] },
  id: { note: 'Akhir pekan\n• Backup foto ke HDD\n• Update Jellyfin\n• Coba dashboard baru', todo: 'Server', items: ['Perpanjang domain', 'Disk baru', 'Backup'] },
}
function seed(lang, { widgets = false, theme } = {}) {
  const w = WIDGETS[lang]
  return [
    (lang, widgets, theme, w) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      const s = { language: lang }
      if (theme) s.theme = theme
      if (widgets) {
        const item = (type, size, options = {}) => ({ id: `${type}-site`, type, size, options })
        s.widgets = [
          item('clock', 'small'),
          item('cpu', 'small'),
          item('calendar', 'medium'),
          item('note', 'small', { text: w.note, color: 'yellow' }),
          item('todo', 'small', { title: w.todo, items: w.items.map((text, i) => ({ id: String(i), text, done: i === 0 })) }),
          item('power', 'small'),
          item('memory', 'small'),
        ]
      }
      localStorage.setItem('temanlabs.settings', JSON.stringify(s))
    },
    lang,
    widgets,
    theme,
    w,
  ]
}

let browser
async function desktop(lang, opts = {}) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  page.on('pageerror', e => console.log('  page error:', e.message))
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme ?? 'dark' }])
  await page.evaluateOnNewDocument(...seed(lang, opts))
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dock')
  await wait(1500)
  return page
}
async function phone(lang) {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  page.on('pageerror', e => console.log('  page error:', e.message))
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.evaluateOnNewDocument(...seed(lang))
  await page.goto(`${URL}/?shell=mobile`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.m-tabbar')
  await wait(1200)
  return page
}
const call = (page, fn, ...args) => page.evaluate((fn, args) => window.temanlabs[fn](...args), fn, args)
const inWindow = (page, selector) => page.evaluate(s => document.querySelector(`.window.is-active ${s}`)?.click(), selector)

async function save(page, lang, name) {
  await page.mouse.move(1, 450)
  await wait(500)
  const dir = join(out, lang)
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.webp`), type: 'webp', quality: 82 })
  // Half size, for phones and the small cards.
  const scale = (await page.viewport()).deviceScaleFactor
  await page.setViewport({ ...(await page.viewport()), deviceScaleFactor: scale / 2 })
  await wait(400)
  await page.screenshot({ path: join(dir, `${name}@1x.webp`), type: 'webp', quality: 80 })
  console.log(`  ${lang}/${name}`)
  await page.close()
}

// ----- The scenes (the rest of the page is videos: scripts/demos.mjs) -----
const PHONE_APP = { downloader: { en: 'Downloader', id: 'Pengunduh' } }
const scenes = {
  async hero(lang) {
    const page = await desktop(lang, { widgets: true })
    await wait(6000) // some history for the widgets' graphs
    await call(page, 'openWindow', 'store')
    await wait(2500)
    await save(page, lang, 'hero')
  },
  async health(lang) {
    const page = await desktop(lang)
    await call(page, 'openSettings', 'apps')
    await wait(2000)
    await inWindow(page, '.set-pane .row button, .set-pane button.row')
    await wait(2000)
    await save(page, lang, 'health')
  },
  async adblock(lang) {
    const page = await desktop(lang)
    await call(page, 'openSettings', 'adblock')
    await wait(2000)
    // The sample server starts with it off: turn it on, and wait for the statistics.
    await inWindow(page, '.set-pane .btn-primary')
    await wait(9000)
    await save(page, lang, 'adblock')
  },
  async devices(lang) {
    const page = await desktop(lang)
    await call(page, 'openWindow', 'devices')
    await wait(2500)
    await save(page, lang, 'devices')
  },
  async commands(lang) {
    const page = await desktop(lang)
    await call(page, 'openWindow', 'commands')
    await wait(1200)
    await page.keyboard.type(lang === 'id' ? 'lihat port yang terbuka' : 'see which ports are open', { delay: 15 })
    await wait(1500)
    await save(page, lang, 'commands')
  },
  async 'phone-home'(lang) {
    const page = await phone(lang)
    await wait(2500)
    await save(page, lang, 'phone-home')
  },
  async 'phone-downloader'(lang) {
    const page = await phone(lang)
    await page.evaluate(() => document.querySelectorAll('.m-tabbar button')[1].click())
    await wait(800)
    await page.evaluate(n => [...document.querySelectorAll('.m-screen:not([hidden]) .m-row')].find(r => r.textContent.trim() === n)?.click(), PHONE_APP.downloader[lang])
    await wait(1500)
    if (!(await page.$('.m-screen:not([hidden]) .dlr-form textarea'))) {
      await page.evaluate(() => document.querySelector('.m-screen:not([hidden]) .btn-primary')?.click())
      await wait(2000)
    }
    await save(page, lang, 'phone-downloader')
  },
}

// The picture shown when a link to the site is shared: public/og-<lang>.png, from the hero shot.
const OG = {
  en: ['Your server,', 'anywhere.', 'A desktop for your home server, in any browser. Free and open source.'],
  id: ['Akses servermu', 'di mana saja.', 'Desktop untuk server rumahmu, di browser mana pun. Gratis dan open source.'],
}
async function socialCard(lang) {
  const hero = join(out, lang, 'hero@1x.webp')
  if (!existsSync(hero)) return console.log(`  og-${lang}: take the hero shot first`)
  const img = `data:image/webp;base64,${readFileSync(hero).toString('base64')}`
  const logo = `data:image/svg+xml;base64,${readFileSync(join(here, '..', 'public', 'favicon.svg')).toString('base64')}`
  const [a, b, c] = OG[lang]
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: Inter, 'Segoe UI', system-ui, sans-serif; color: #eef2f8;
      background: #04122b; }
    .copy { position: absolute; left: 72px; top: 92px; width: 520px; }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; letter-spacing: -.02em; }
    .brand img { width: 48px; height: 48px; border-radius: 12px; }
    h1 { margin: 56px 0 0; font-size: 64px; line-height: 1.04; letter-spacing: -.045em; font-weight: 800; }
    h1 span { display: block; color: #4aa3ff; }
    p { margin: 26px 0 0; font-size: 24px; line-height: 1.45; color: #a7b0c0; }
    .shot { position: absolute; left: 640px; top: 96px; width: 760px; border-radius: 16px; border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 40px 100px rgba(0,0,0,.8); }
  </style></head><body>
    <div class="copy"><div class="brand"><img src="${logo}">TemanLabsOS</div><h1>${a}<span>${b}</span></h1><p>${c}</p></div>
    <img class="shot" src="${img}">
  </body></html>`)
  await wait(300)
  await page.screenshot({ path: join(here, '..', 'public', `og-${lang}.png`) })
  await page.close()
  console.log(`  og-${lang}`)
}

const vite = await up()
browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' })
try {
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue
    for (const lang of LANGS) await scene(lang).catch(e => console.log(`  ${lang}/${name} FAILED: ${e.message}`))
  }
  if (!only.length || only.includes('hero') || only.includes('og')) for (const lang of LANGS) await socialCard(lang)
} finally {
  await browser.close()
  down(vite)
}
