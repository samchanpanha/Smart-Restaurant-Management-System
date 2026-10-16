// ─── 3D capability checks ─────────────────────────────────────────────
// Two questions decide whether a customer sees the 3D dish stage or the
// ordinary product photo: can this browser draw WebGL, and has the guest
// asked their system to reduce motion.
//
// Nothing here imports three: the checks must run before the 3D chunk is
// ever fetched, so a browser without WebGL never downloads it.

/** True when this browser can actually create a WebGL context. */
export function supportsWebGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  // A browser without the WebGL types cannot draw a scene. Checking the
  // types first also keeps headless DOMs (tests) from logging a noisy
  // "getContext is not implemented" error.
  if (typeof WebGLRenderingContext === 'undefined' && typeof WebGL2RenderingContext === 'undefined') {
    return false
  }
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** True when the guest asked the system to reduce motion. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}

/**
 * Whether the 3D stage should run at all. Reduced motion always wins:
 * a guest who asked for less movement gets the photo, not a spinning plate.
 */
export function shouldRender3D() {
  return supportsWebGL() && !prefersReducedMotion()
}
