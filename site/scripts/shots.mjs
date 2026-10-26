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

// Just the window in front, for the highlights' tiles: <name>-win.webp.
async function saveWindow(page, lang, name) {
  await page.mouse.move(1, 450)
  await wait(500)
  const win = await page.$('.window.is-active')
  if (!win) return console.log(`  ${lang}/${name}-win: no window`)
  mkdirSync(join(out, lang), { recursive: true })
  await win.screenshot({ path: join(out, lang, `${name}-win.webp`), type: 'webp', quality: 84 })
  console.log(`  ${lang}/${name}-win`)
}

// ----- The scenes (the rest of the page is videos: scripts/demos.mjs) -----
const PHONE_APP = { downloader: { en: 'Downloader', id: 'Pengunduh' } }
const scenes = {
  async hero(lang) {
    const page = await desktop(lang, { widgets: true })
    await wait(6000) // some history for the widgets' graphs
    await call(page, 'openWindow', 'store')
    await wait(2500)
    await saveWindow(page, lang, 'store')
    await save(page, lang, 'hero')
  },
  async health(lang) {
    const page = await desktop(lang)
    await call(page, 'openSettings', 'apps')
    await wait(2000)
    await inWindow(page, '.set-pane .row button, .set-pane button.row')
    await wait(2000)
    await saveWindow(page, lang, 'health')
    await save(page, lang, 'health')
  },
  async adblock(lang) {
    const page = await desktop(lang)
    await call(page, 'openSettings', 'adblock')
    await wait(2000)
    // The sample server starts with it off: turn it on, and wait for the statistics.
    await inWindow(page, '.set-pane .btn-primary')
    await wait(9000)
    await saveWindow(page, lang, 'adblock')
    await save(page, lang, 'adblock')
  },
  async devices(lang) {
    const page = await desktop(lang)
    await call(page, 'openWindow', 'devices')
    await wait(2500)
    await saveWindow(page, lang, 'devices')
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

// The picture shown when a link to the site is shared: public/og-<lang>.png. The site's look:
// the logo's navy, Plus Jakarta Sans, and the desktop on a monitor and a phone.
const OG = {
  en: ['Your server,', 'anywhere.', 'A desktop for your home server, in any browser.', 'Free and open source'],
  id: ['Akses servermu', 'di mana saja.', 'Desktop untuk server rumahmu, di browser mana pun.', 'Gratis dan open source'],
}
async function socialCard(lang) {
  const file = (...p) => join(here, '..', ...p)
  const desk = file('public', 'shots', lang, 'hero@1x.webp')
  const mobile = file('public', 'shots', lang, 'phone-home@1x.webp')
  if (!existsSync(desk) || !existsSync(mobile)) return console.log(`  og-${lang}: take the hero and phone-home shots first`)
  const data = (p, type) => `data:${type};base64,${readFileSync(p).toString('base64')}`
  const font = data(file('node_modules', '@fontsource-variable', 'plus-jakarta-sans', 'files', 'plus-jakarta-sans-latin-wght-normal.woff2'), 'font/woff2')
  const logo = data(file('public', 'favicon.svg'), 'image/svg+xml')
  const [a, b, c, d] = OG[lang]
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Jakarta; src: url(${font}) format('woff2'); font-weight: 200 800; }
    * { box-sizing: border-box; margin: 0; }
    body { width: 1200px; height: 630px; overflow: hidden; position: relative; font-family: Jakarta, system-ui, sans-serif; color: #fff; background: #04122b; }
    .copy { position: absolute; left: 76px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; letter-spacing: -0.03em; }
    .brand img { width: 50px; height: 50px; border-radius: 13px; }
    h1 { margin-top: 52px; font-size: 68px; white-space: nowrap; line-height: 1.0; letter-spacing: -0.055em; font-weight: 700; }
    h1 span { display: block; color: #4aa3ff; }
    p { margin-top: 26px; max-width: 440px; font-size: 25px; line-height: 1.4; letter-spacing: -0.015em; color: rgba(255,255,255,0.72); }
    .chip { margin-top: 34px; align-self: flex-start; padding: 10px 18px; border-radius: 999px; font-size: 18px; font-weight: 600; color: #9fd4ff; background: rgba(4,121,255,0.16); box-shadow: inset 0 0 0 1.5px rgba(74,163,255,0.35); }
    .monitor { position: absolute; left: 640px; top: 118px; width: 640px; }
    .panel { padding: 9px; border-radius: 16px; background: #0b0b0e; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 40px 90px rgba(0,0,0,0.55); }
    .panel img { display: block; width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 8px; }
    .neck { width: 84px; height: 62px; margin: 0 auto; background: linear-gradient(90deg,#8e939c,#d8dce2 30%,#eef0f3 50%,#c9cdd4 70%,#8a8f98); clip-path: polygon(8% 0,92% 0,100% 100%,0 100%); }
    .phone { position: absolute; left: 596px; top: 268px; width: 160px; padding: 6px; border-radius: 26px; background: #0c0c0f; box-shadow: inset 0 0 0 2px #3a3c42, 0 30px 60px rgba(0,0,0,0.6); }
    .phone img { display: block; width: 100%; aspect-ratio: 390/844; object-fit: cover; border-radius: 21px; }
  </style></head><body>
    <div class="copy">
      <div class="brand"><img src="${logo}">TemanLabsOS</div>
      <h1>${a}<span>${b}</span></h1>
      <p>${c}</p>
      <span class="chip">${d}</span>
    </div>
    <div class="monitor"><div class="panel"><img src="${data(desk, 'image/webp')}"></div><div class="neck"></div></div>
    <div class="phone"><img src="${data(mobile, 'image/webp')}"></div>
  </body></html>`)
  await page.evaluate(() => document.fonts.ready)
  await wait(300)
  await page.screenshot({ path: file('public', `og-${lang}.png`) })
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
