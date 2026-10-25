// What the page does in the browser: the bar's switches, copy buttons, things coming
// into view, motion tied to scrolling, the tour, the Launcher's search, and clips that only play
// while they're seen. Everything reads fine without it.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const wide = () => matchMedia('(min-width: 901px)').matches
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

function nav() {
  const bar = document.querySelector<HTMLElement>('[data-nav]')
  if (!bar) return
  // Over the opening's dark blue the bar turns light-on-dark.
  const story = document.querySelector<HTMLElement>('.story')
  const onScroll = () => {
    bar.classList.toggle('is-scrolled', scrollY > 8)
    bar.classList.toggle('on-story', !!story && scrollY < story.offsetTop + story.offsetHeight - bar.offsetHeight)
  }
  onScroll()
  addEventListener('scroll', onScroll, { passive: true })

  bar.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('tl-theme', next)
    } catch {}
  })

  const toggle = bar.querySelector<HTMLButtonElement>('[data-menu-toggle]')
  const close = () => {
    bar.classList.remove('is-open')
    toggle?.setAttribute('aria-expanded', 'false')
  }
  toggle?.addEventListener('click', () => {
    const open = !bar.classList.contains('is-open')
    bar.classList.toggle('is-open', open)
    toggle.setAttribute('aria-expanded', String(open))
  })
  bar.querySelectorAll('.nav-menu a').forEach(a => a.addEventListener('click', close))
  addEventListener('keydown', e => e.key === 'Escape' && close())
}

function copyButtons() {
  document.querySelectorAll<HTMLElement>('[data-copy]').forEach(box => {
    const btn = box.querySelector<HTMLButtonElement>('.command-btn')
    const label = btn?.querySelector('.command-text')
    if (!btn || !label) return
    let timer = 0
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(box.dataset.copy!)
      } catch {
        // Without the clipboard (plain http): select the command so it can be copied by hand.
        const range = document.createRange()
        range.selectNodeContents(box.querySelector('code')!)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(range)
        return
      }
      box.classList.add('is-copied')
      label.textContent = btn.dataset.done!
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        box.classList.remove('is-copied')
        label.textContent = btn.dataset.label!
      }, 1800)
    })
  })
}

// Things rise into place as they come into view, side by side ones one after another.
function reveal() {
  const items = document.querySelectorAll<HTMLElement>('.reveal, .pop')
  if (reduced() || !('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('is-in'))
    return
  }
  const seen = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-in')
        seen.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
  )
  items.forEach(el => {
    if (el.classList.contains('reveal')) {
      const siblings = el.parentElement ? [...el.parentElement.children].filter(c => c.classList.contains('reveal')) : []
      el.style.setProperty('--delay', `${Math.min(Math.max(siblings.indexOf(el), 0), 8) * 70}ms`)
    }
    seen.observe(el)
  })
}

// Motion tied to scrolling: each [data-progress] gets --p, 0 → 1 as it crosses the screen.
function scrollMotion() {
  if (reduced()) {
    document.querySelectorAll<HTMLElement>('[data-progress]').forEach(el => el.style.setProperty('--p', '1'))
    return
  }
  const els = [...document.querySelectorAll<HTMLElement>('[data-progress]')]
  let queued = false
  const update = () => {
    queued = false
    const h = innerHeight
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.bottom < -h || r.top > h * 2) continue
      // The opening is held on screen: its progress is how far the page has scrolled through it.
      const p = el.dataset.progress === 'story' ? clamp(-r.top / Math.max(1, r.height - h)) : clamp((h - r.top) / (h + r.height))
      el.style.setProperty('--p', p.toFixed(4))
    }
    tourStep()
  }
  const ask = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(update)
  }
  addEventListener('scroll', ask, { passive: true })
  addEventListener('resize', ask)
  update()
}

// A clip plays only while it's on screen (and the tab is in front), to spare the battery.
const visible = new Set<HTMLVideoElement>()
function play(video: HTMLVideoElement) {
  if (!video.getAttribute('src') && video.dataset.src) video.src = video.dataset.src
  if (reduced()) return
  video.play().catch(() => {})
}
function clips() {
  const watch = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement
        if (e.isIntersecting) {
          visible.add(v)
          if (!v.closest('.tour-media') || v.classList.contains('is-active')) play(v)
        } else {
          visible.delete(v)
          v.pause()
        }
      }
    },
    { threshold: 0.15 },
  )
  document.querySelectorAll<HTMLVideoElement>('video').forEach(v => watch.observe(v))
  document.addEventListener('visibilitychange', () => {
    for (const v of visible) document.hidden ? v.pause() : play(v)
  })
}

// The tour. On a wide screen its window stays put while the page scrolls through the apps; on
// a narrow one, the row of apps is tapped.
let tourShow: ((n: number) => void) | null = null
let tourStep = () => {}
function tour() {
  const root = document.querySelector<HTMLElement>('[data-tour]')
  const runway = document.querySelector<HTMLElement>('[data-tour-scroll]')
  if (!root || !runway) return
  const items = [...root.querySelectorAll<HTMLButtonElement>('.side-item')]
  const media = [...root.querySelectorAll<HTMLElement>('.tour-media > *')]
  const texts = [...root.querySelectorAll<HTMLElement>('.tour-text')]
  const bar = runway.querySelector<HTMLElement>('.tour-progress i')
  let current = 0
  tourShow = n => {
    if (n === current) return
    current = n
    items.forEach((it, i) => {
      it.classList.toggle('is-active', i === n)
      it.setAttribute('aria-pressed', String(i === n))
    })
    texts.forEach((p, i) => {
      p.classList.toggle('is-active', i === n)
      p.setAttribute('aria-hidden', String(i !== n))
    })
    media.forEach((m, i) => {
      m.classList.toggle('is-active', i === n)
      if (!(m instanceof HTMLVideoElement)) return
      if (i === n) {
        m.currentTime = 0
        play(m)
      } else m.pause()
    })
    // On a narrow screen the apps are a row: bring the chosen one into it (the page stays put).
    const row = items[n]?.parentElement
    if (row && !wide()) row.scrollTo({ left: items[n].offsetLeft - 12, behavior: 'smooth' })
  }
  const steps = items.length
  // How far through the runway the page is, 0 → 1.
  const through = () => {
    const r = runway.getBoundingClientRect()
    return clamp(-r.top / Math.max(1, r.height - innerHeight))
  }
  tourStep = () => {
    if (!wide()) return
    const p = through()
    if (bar) bar.style.transform = `scaleX(${p})`
    tourShow!(Math.min(steps - 1, Math.floor(p * steps)))
  }
  items.forEach((item, n) =>
    item.addEventListener('click', () => {
      if (!wide()) return tourShow!(n)
      // Scroll to where that app is shown.
      const top = runway.getBoundingClientRect().top + scrollY
      const span = runway.offsetHeight - innerHeight
      scrollTo({ top: top + ((n + 0.5) / steps) * span, behavior: reduced() ? 'auto' : 'smooth' })
    }),
  )
}

// The Launcher: type to find an app, or pick a group.
function launcher() {
  const root = document.querySelector<HTMLElement>('[data-launcher]')
  if (!root) return
  const search = root.querySelector<HTMLInputElement>('[data-launcher-search]')!
  const none = root.querySelector<HTMLElement>('[data-launcher-none]')!
  const apps = [...root.querySelectorAll<HTMLElement>('.launcher-grid li')]
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.segmented button')]
  let group = 'all'
  const apply = () => {
    const words = search.value.trim().toLowerCase()
    let any = false
    for (const a of apps) {
      const show = (group === 'all' || a.dataset.group === group) && (!words || a.dataset.name!.includes(words))
      a.hidden = !show
      any ||= show
    }
    none.hidden = any
  }
  search.addEventListener('input', apply)
  buttons.forEach(b =>
    b.addEventListener('click', () => {
      group = b.dataset.group!
      buttons.forEach(x => {
        x.classList.toggle('is-active', x === b)
        x.setAttribute('aria-checked', String(x === b))
      })
      apply()
    }),
  )
}

export function start() {
  nav()
  copyButtons()
  reveal()
  tour()
  clips()
  scrollMotion()
  launcher()
}
