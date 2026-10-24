import type { MenuItem } from '../components/ContextMenu'
import { ALT, MOD, SHIFT } from './platform'

const CODE_LABELS: Record<string, string> = {
  Backquote: '`',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Minus: '-',
  Equal: '=',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
}

// From `code` rather than `key`, which changes with Shift/Option (e.g. ⌥F gives "ƒ" on a Mac).
function keyLabel(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  return CODE_LABELS[code] ?? null
}

/**
 * The event as a shortcut label in the same format menus display, e.g. "Ctrl+Shift+F" or "⌘⇧F",
 * or null for keys that can't be a menu shortcut (plain letters, modifiers alone).
 */
export function shortcutOf(e: KeyboardEvent): string | null {
  const key = keyLabel(e.code)
  if (!key) return null
  const mod = e.ctrlKey || e.metaKey
  if (!mod && !e.altKey && !/^F\d/.test(key)) return null
  return `${mod ? MOD : ''}${e.shiftKey ? SHIFT : ''}${e.altKey ? ALT : ''}${key}`
}

/** Keys that text fields handle themselves (copy, paste, undo…), so menus must not take them there. */
export const TEXT_EDITING_KEYS = new Set(['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyY'])

export function findShortcut(items: MenuItem[], shortcut: string) {
  return items.find((item): item is Exclude<MenuItem, 'separator'> => item !== 'separator' && item.shortcut === shortcut)
}
