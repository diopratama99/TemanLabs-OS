/** Launcher items being dragged carry their key under this type (the Dock takes them too). */
export const DRAG_TYPE = 'application/x-temanlabs-launchpad'

/**
 * Also set on a drag from the Launcher: which part of the Dock the app belongs in. A drag's data
 * can only be read on drop, but its types can be read while it hovers, so the Dock can open a gap.
 */
export const DRAG_GROUP_TYPE = (group: 'system' | 'apps') => `${DRAG_TYPE}-${group}`
