// Which interface this browser gets: the desktop, or the phone's own (screens, tabs, sheets).
// Chosen once at start, so turning a phone sideways doesn't swap it; ?shell=desktop or
// ?shell=mobile in the address picks one and keeps it, as does the switch in each.

export type Shell = 'mobile' | 'desktop'

const KEY = 'temanlabs.shell'

function looksLikePhone() {
  const narrow = window.matchMedia('(max-width: 720px)').matches
  const touch = window.matchMedia('(pointer: coarse)').matches
  return narrow || (touch && Math.min(screen.width, screen.height) <= 600)
}

function pick(): Shell {
  const asked = new URLSearchParams(location.search).get('shell')
  if (asked === 'mobile' || asked === 'desktop') {
    try {
      localStorage.setItem(KEY, asked)
    } catch {
      // Kept for this visit only.
    }
    return asked
  }
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'mobile' || saved === 'desktop') return saved
  } catch {
    // No storage: decide by the screen.
  }
  return looksLikePhone() ? 'mobile' : 'desktop'
}

export const SHELL: Shell = pick()
document.documentElement.dataset.shell = SHELL

/** Switches to the other interface, for good on this browser. */
export function switchShell(shell: Shell) {
  try {
    localStorage.setItem(KEY, shell)
  } catch {
    // Kept for this visit only.
  }
  const url = new URL(location.href)
  url.searchParams.set('shell', shell)
  location.replace(url)
}
