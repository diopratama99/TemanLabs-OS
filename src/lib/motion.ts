// Shared timing for the JavaScript-driven animations (windows, Dock). CSS keeps its own copies
// of these curves in app.css under "Animations".

/** Ease-out: fast start, long soft landing. */
export const EASE_OUT = 'cubic-bezier(0.2, 0.9, 0.25, 1)'
/** Slight overshoot for things that spring into place. */
export const EASE_SPRING = 'cubic-bezier(0.25, 1.15, 0.4, 1)'
/** Accelerating, for things leaving the screen. */
export const EASE_IN = 'cubic-bezier(0.55, 0, 0.75, 0.25)'

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
