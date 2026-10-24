/** True for text fields, where the browser's own context menu (copy/paste) should stay. */
export const isEditable = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]')
