export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)

/** Modifier prefixes for shortcut labels, e.g. `${MOD}S` → "⌘S" or "Ctrl+S". */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'
export const SHIFT = IS_MAC ? '⇧' : 'Shift+'
export const ALT = IS_MAC ? '⌥' : 'Alt+'
