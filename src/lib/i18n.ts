import { ID } from './i18n-id'

// Interface language. English text is the key: tr('Open') returns the translation, or the
// English when there is none. Values go in as {0}, {1}…: tr('{0} apps', n).
//
// The language is read once at startup (settings in localStorage, else the browser's language),
// because module-level labels are translated when their module loads; changing it reloads.

export type Language = 'en' | 'id'

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'id', label: 'Bahasa Indonesia' },
]

const SETTINGS_KEY = 'temanlabs.settings'

export function browserLanguage(): Language {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en'
}

function startupLanguage(): Language {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { language?: unknown }
    if (saved.language === 'en' || saved.language === 'id') return saved.language
  } catch {
    // No storage (private mode): fall back to the browser.
  }
  return browserLanguage()
}

export const language: Language = startupLanguage()
const dictionary: Record<string, string> = language === 'id' ? ID : {}

export function tr(text: string, ...values: unknown[]): string {
  const s = dictionary[text] ?? text
  return values.length ? s.replace(/\{(\d+)\}/g, (match, i: string) => (Number(i) < values.length ? String(values[Number(i)]) : match)) : s
}
