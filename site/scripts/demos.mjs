// Records the website's demo videos from TemanLabsOS itself, with sample data, in English and
// Indonesian: public/demos/<lang>/<name>.mp4 and a poster <name>.jpg.
//
//   npm run demos                      every demo
//   npm run demos -- files phone       just these
//   FFMPEG_REMOTE=user@host npm run demos   encode on another machine over ssh (no local ffmpeg)
//
// Chrome sends a frame whenever the screen changes; ffmpeg turns them into a 30 fps H.264 video.
import { spawn, spawnSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const work = join(here, '..', '.demos')
const out = join(here, '..', 'public', 'demos')
const PORT = 5199
const URL = `http://localhost:${PORT}`
const LANGS = ['en', 'id']
const only = process.argv.slice(2)
const remote = process.env.FFMPEG_REMOTE
const wait = ms => new Promise(r => setTimeout(r, ms))

const chrome =
  process.env.CHROME ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p =>
    existsSync(p),
  )
if (!chrome) throw new Error('Chrome not found: set CHROME to its path')
if (!remote && spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg not found: install it, or set FFMPEG_REMOTE=user@host')

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

// A pointer you can see (headless Chrome draws none), and a ring where a finger touches.
function pointer() {
  const add = () => {
    const css = document.createElement('style')
    css.textContent = `
      #demo-pointer { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none;
        transform: translate(-100px, -100px); transition: scale .12s; filter: drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
      #demo-pointer.is-down { scale: .86; }
      #demo-touch { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
        pointer-events: none; background: rgba(255,255,255,.35); border: 2px solid rgba(255,255,255,.85); box-shadow: 0 2px 10px rgba(0,0,0,.35);
        opacity: 0; transition: opacity .15s, scale .15s; scale: .7; }
      #demo-touch.is-on { opacity: 1; scale: 1; }`
    document.head.append(css)
    const p = document.createElement('div')
    p.id = 'demo-pointer'
    p.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2.5v17.2l4.6-4.4 3 6.7 3.2-1.4-3-6.6h6.4z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    const t = document.createElement('div')
    t.id = 'demo-touch'
    document.body.append(p, t)
    const at = e => `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`
    addEventListener('mousemove', e => (p.style.transform = at(e)), true)
    addEventListener('mousedown', () => p.classList.add('is-down'), true)
    addEventListener('mouseup', () => p.classList.remove('is-down'), true)
    const touch = e => {
      const f = e.touches[0]
      if (f) t.style.transform = `translate(${f.clientX}px, ${f.clientY}px)`
      t.classList.toggle('is-on', e.touches.length > 0)
    }
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) addEventListener(type, touch, { capture: true, passive: true })
    if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints) p.style.display = 'none'
  }
  if (document.body) add()
  else addEventListener('DOMContentLoaded', add)
}

function seed(lang, { widgets = false, theme } = {}) {
  return [
    (lang, widgets, theme) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      const s = { language: lang }
      if (theme) s.theme = theme
      if (widgets) {
        const id = lang === 'id'
        const item = (type, size, options = {}) => ({ id: `${type}-demo`, type, size, options })
        s.widgets = [
          item('clock', 'small'),
          item('cpu', 'small'),
          item('calendar', 'medium'),
          item('note', 'small', { text: id ? 'Akhir pekan\n• Backup foto ke HDD\n• Update Jellyfin' : 'Weekend\n• Back up photos to the HDD\n• Update Jellyfin', color: 'yellow' }),
          item('memory', 'small'),
          item('power', 'small'),
        ]
      }
      localStorage.setItem('temanlabs.settings', JSON.stringify(s))
    },
    lang,
    widgets,
    theme,
  ]
}

let browser
async function desktop(lang, opts = {}) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  page.on('pageerror', e => console.log('  page error:', e.message))
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme ?? 'dark' }])
  await page.evaluateOnNewDocument(...seed(lang, opts))
  await page.evaluateOnNewDocument(pointer)
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dock')
  await page.mouse.move(1100, 620)
  await wait(opts.widgets ? 5000 : 1500)
  return page
}
async function phone(lang) {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', e => console.log('  page error:', e.message))
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.evaluateOnNewDocument(...seed(lang))
  await page.evaluateOnNewDocument(pointer)
  await page.goto(`${URL}/?shell=mobile`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.m-tabbar')
  await wait(2500)
  return page
}

// ----- Moving like a person -----
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
let mouse = { x: 1100, y: 620 }
async function glide(page, x, y, ms = 650) {
  const from = { ...mouse }
  const steps = Math.max(8, Math.round(ms / 16))
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps)
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k)
    await wait(ms / steps)
  }
  mouse = { x, y }
}
async function centerOf(page, selector) {
  const el = typeof selector === 'string' ? await page.$(selector) : selector
  if (!el) throw new Error(`not found: ${selector}`)
  const b = await el.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
async function click(page, selector, { double = false, ms } = {}) {
  const { x, y } = await centerOf(page, selector)
  await glide(page, x, y, ms)
  await wait(140)
  await page.mouse.click(x, y, double ? { count: 2 } : undefined)
}
async function drag(page, from, to, ms = 900) {
  await glide(page, from.x, from.y)
  await page.mouse.down()
  await wait(120)
  await glide(page, to.x, to.y, ms)
  await wait(250)
  await page.mouse.up()
}
// The element whose text is exactly this, among those matching selector (last one wins).
async function byText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (s, t) => [...document.querySelectorAll(s)].filter(e => e.offsetParent && e.textContent.trim() === t).at(-1) ?? null,
    selector,
    text,
  )
  return handle.asElement()
}
async function tap(page, selector) {
  const { x, y } = await centerOf(page, selector)
  await page.touchscreen.touchStart(x, y)
  await wait(90)
  await page.touchscreen.touchEnd()
}
async function swipe(page, x1, x2, y, ms = 280) {
  await page.touchscreen.touchStart(x1, y)
  const steps = 14
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(x1 + ((x2 - x1) * ease(i / steps)), y)
    await wait(ms / steps)
  }
  await page.touchscreen.touchEnd()
}
const call = (page, fn, ...args) => page.evaluate((fn, args) => window.temanlabs[fn](...args), fn, args)

// ----- Recording -----
async function record(page, lang, name, act) {
  const dir = join(work, lang, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const cdp = await page.createCDPSession()
  const frames = []
  cdp.on('Page.screencastFrame', f => {
    frames.push({ data: f.data, at: f.metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  const vp = page.viewport()
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: vp.width * vp.deviceScaleFactor, maxHeight: vp.height * vp.deviceScaleFactor, everyNthFrame: 1 })
  const started = Date.now() / 1000
  await act()
  const ended = Date.now() / 1000
  await cdp.send('Page.stopScreencast')
  await page.close()
  // Each frame lasts until the next one; the last until the end.
  const list = []
  frames.forEach((f, i) => {
    const file = `f${String(i).padStart(5, '0')}.jpg`
    writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'))
    const next = frames[i + 1]?.at ?? ended
    const from = i === 0 ? started : f.at
    list.push(`file '${file}'`, `duration ${Math.max(0.001, next - from).toFixed(4)}`)
  })
  list.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`)
  writeFileSync(join(dir, 'frames.txt'), list.join('\n') + '\n')
  encode(dir, lang, name)
  console.log(`  ${lang}/${name}: ${frames.length} frames, ${(ended - started).toFixed(1)} s`)
}

function encode(dir, lang, name) {
  const target = join(out, lang)
  mkdirSync(target, { recursive: true })
  const args = '-y -loglevel error -f concat -safe 0 -i frames.txt -vf "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -c:v libx264 -preset slow -crf 25 -movflags +faststart -an out.mp4'
  const first = readdirSync(dir).find(f => f.endsWith('.jpg'))
  copyFileSync(join(dir, first), join(target, `${name}.jpg`))
  if (!remote) {
    execSync(`ffmpeg ${args}`, { cwd: dir, stdio: 'inherit', shell: true })
    copyFileSync(join(dir, 'out.mp4'), join(target, `${name}.mp4`))
    return
  }
  // On another machine: the frames go over ssh as a tar, the video comes back.
  const tmp = `/tmp/tl-demo-${lang}-${name}`
  execSync(`tar -cf - -C "${dir}" . | ssh ${remote} "rm -rf ${tmp} && mkdir -p ${tmp} && tar -xf - -C ${tmp} && cd ${tmp} && ffmpeg ${args.replace(/"/g, '\\"')} && cat out.mp4 && rm -rf ${tmp}" > "${join(target, `${name}.mp4`)}"`, {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: true,
  })
}

// ----- The demos -----
const DOCK = id => `.dock [data-dock-id="${id}"]`
const demos = {
  // The desktop: apps from the Dock, snapped side by side.
  async desktop(lang) {
    const page = await desktop(lang, { widgets: true })
    await record(page, lang, 'desktop', async () => {
      await wait(900)
      await click(page, DOCK('files'))
      await wait(1400)
      await click(page, '.window.is-active [data-name="Gallery"]', { double: true })
      await wait(1300)
      await click(page, DOCK('store'))
      await wait(1800)
      // Held by the title bar's top edge, clear of its buttons, as a person would.
      const grip = async el => {
        const b = await (typeof el === 'string' ? await page.$(el) : el).boundingBox()
        return { x: b.x + b.width / 2, y: b.y + 8 }
      }
      await drag(page, await grip('.window.is-active .window-titlebar'), { x: 1439, y: 420 })
      await wait(1100)
      const files = await page.$('.window[aria-label="Files"] .window-titlebar, .window[aria-label="Berkas"] .window-titlebar')
      await drag(page, await grip(files), { x: 1, y: 420 })
      await wait(1600)
      await glide(page, 1060, 520, 900)
      await wait(1200)
    })
  },
  // App Center: an app's own page.
  async store(lang) {
    const page = await desktop(lang)
    await call(page, 'openWindow', 'store')
    await wait(2200)
    await record(page, lang, 'store', async () => {
      await wait(700)
      const cards = await page.$$('.window.is-active .store-card')
      await glide(page, ...Object.values(await centerOf(page, cards[2])), 700)
      await wait(500)
      await glide(page, ...Object.values(await centerOf(page, cards[5])), 600)
      await wait(500)
      const jelly = await page.evaluateHandle(() => [...document.querySelectorAll('.window.is-active .store-card')].find(c => /Jellyfin/.test(c.textContent)))
      await click(page, jelly.asElement())
      await wait(1800)
      for (let i = 0; i < 14; i++) {
        await page.mouse.wheel({ deltaY: 60 })
        await wait(70)
      }
      await wait(1500)
      for (let i = 0; i < 14; i++) {
        await page.mouse.wheel({ deltaY: -60 })
        await wait(50)
      }
      await wait(1200)
    })
  },
  // Files: into a folder, the gallery view, a photo in the viewer.
  async files(lang) {
    const page = await desktop(lang)
    await call(page, 'openFilesAt', '/DATA/Gallery')
    await wait(2000)
    await record(page, lang, 'files', async () => {
      await wait(700)
      await click(page, '.window.is-active [data-name="Bali 2026"]', { double: true })
      await wait(1500)
      const views = await page.$$('.window.is-active .tb-segmented.tb-icons button')
      if (views[2]) await click(page, views[2])
      await wait(1500)
      const first = await page.$('.window.is-active [data-name$=".jpg"]')
      if (first) await click(page, first, { double: true })
      await wait(1600)
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowRight')
        await wait(1000)
      }
      await wait(600)
    })
  },
  // Downloader: a profile's posts, a few picked, saved to the server.
  async downloader(lang) {
    const page = await desktop(lang)
    await call(page, 'openWindow', 'downloader')
    await wait(1500)
    if (!(await page.$('.window.is-active .dlr-form textarea'))) {
      await page.evaluate(() => document.querySelector('.window.is-active .btn-primary')?.click())
      await wait(2000)
    }
    await record(page, lang, 'downloader', async () => {
      await wait(600)
      await click(page, '.window.is-active .dlr-form textarea')
      await page.keyboard.type('https://www.instagram.com/temantravels/', { delay: 28 })
      await wait(700)
      await click(page, '.window.is-active .dlr-options .btn:not(.btn-primary)')
      await wait(2400)
      const tiles = await page.$$('.window.is-active .dlb-grid > *')
      for (const i of [0, 1, 4, 5, 6]) {
        if (!tiles[i]) continue
        await click(page, tiles[i], { ms: 420 })
        await wait(260)
      }
      await wait(700)
      const save = await page.$('.window.is-active .dlb-foot .btn-primary')
      if (save) await click(page, save)
      await wait(3200)
    })
  },
  // System Monitor: containers, services, then 7 days of history.
  async monitor(lang) {
    const page = await desktop(lang)
    await call(page, 'openWindow', 'activity')
    await wait(2500)
    await record(page, lang, 'monitor', async () => {
      await wait(900)
      // Each tab draws its own bar, so the tabs are looked up again every time.
      await click(page, '.window.is-active .am-tabs button:nth-child(2)')
      await wait(1500)
      await click(page, '.window.is-active .am-tabs button:nth-child(5)')
      await wait(1800)
      await click(page, '.window.is-active .hv-range button:nth-child(3)')
      await wait(1800)
      await glide(page, 700, 330, 1400)
      await wait(800)
    })
  },
  // The phone: home, an app, photos swiped through.
  async phone(lang) {
    const page = await phone(lang)
    await record(page, lang, 'phone', async () => {
      await wait(1600)
      await tap(page, '.m-tabbar button:nth-child(3)')
      await wait(1200)
      await tap(page, '.m-screen:not([hidden]) [data-name$="Gallery"]')
      await wait(1200)
      await tap(page, '.m-screen:not([hidden]) [data-name$="Bali 2026"]')
      await wait(1300)
      await tap(page, '.m-screen:not([hidden]) [data-name$=".jpg"]')
      await wait(1500)
      for (let i = 0; i < 3; i++) {
        await swipe(page, 320, 70, 420)
        await wait(900)
      }
      await tap(page, '.m-screen:not([hidden]) .m-back')
      await wait(900)
      await tap(page, '.m-tabbar button:nth-child(1)')
      await wait(1500)
    })
  },
}

const vite = await up()
browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' })
try {
  for (const [name, demo] of Object.entries(demos)) {
    if (only.length && !only.includes(name)) continue
    for (const lang of LANGS) {
      mouse = { x: 1100, y: 620 }
      await demo(lang).catch(e => console.log(`  ${lang}/${name} FAILED: ${e.message}`))
    }
  }
} finally {
  await browser.close()
  down(vite)
}
