// The words on the page, one set per language (en.ts, id.ts). Both must say everything.

export type Lang = 'en' | 'id'
export type SecurityIcon = 'key' | 'lock' | 'monitor' | 'eye' | 'hard' | 'shield'
export type HostIcon = 'cloud' | 'server' | 'pc' | 'laptop' | 'cpu' | 'tv'

interface Titled {
  title: string
  text: string
}

export interface TourItem extends Titled {
  /** A demo video in public/demos, or a screenshot in public/shots. */
  media: { kind: 'video' | 'shot'; name: string }
  app: string
  label: string
  points: string[]
}

export interface Content {
  lang: Lang
  locale: string
  meta: { title: string; description: string }
  menu: { demo: string; tour: string; phone: string; apps: string; about: string; install: string; faq: string; github: string; light: string; dark: string; language: string; languageShort: string; top: string }
  hero: { title: string; lead: string; primary: string; secondary: string; demo: string; scroll: string; copy: string; copied: string; note: string; alts: { monitor: string; laptop: string; phone: string } }
  /** The words that split apart to show the devices, as the hero scrolls. */
  story: [string, string]
  connect: { title: string; lead: string; server: string; devices: string; screens: [string, string, string, string]; facts: { value: string; label: string }[] }
  /** The kinds of machine it installs on. */
  hosts: { title: string; lead: string; items: (Titled & { icon: HostIcon; arch: string })[] }
  /** A paragraph read as the page scrolls; [words in brackets] are picked out in blue. */
  how: { title: string; text: string }
  widgets: { title: string; lead: string; items: (Titled & { icon: string })[] }
  tour: { window: string; title: string; lead: string; play: string; pause: string; items: TourItem[] }
  phone: { title: string; lead: string; points: Titled[]; alts: [string, string, string] }
  launcher: { title: string; lead: string; search: string; all: string; none: string; groups: Record<'apps' | 'files' | 'network' | 'tools', string> }
  about: { window: string; tagline: string; version: string; rows: [string, string][]; button: string }
  security: { window: string; title: string; items: (Titled & { icon: SecurityIcon })[]; warning: Titled }
  install: { title: string; lead: string; window: string; steps: Titled[]; terminal: string[]; guide: string; requirements: string }
  faq: { window: string; title: string; items: { q: string; a: string }[] }
  end: { title: string; lead: string; primary: string; secondary: string }
  footer: { tagline: string; links: { install: string; architecture: string; releases: string; license: string; issues: string }; made: string; notice: string }
}
