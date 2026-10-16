// ─── The dish showcase ───────────────────────────────────────────────
// The one place the customer menu decides between the 3D stage and the
// dish photo. It is written so the 3D code is opt-in and disposable:
//
//   • no WebGL, or the guest asked for reduced motion  → the photo
//   • the 3D chunk fails to load, or the scene throws  → the photo
//   • otherwise                                          → the stage
//
// The 3D bundle is fetched only when a guest actually reaches this
// component and the browser can draw it, so a phone without WebGL never
// downloads three.js.
//
// The photograph is always in the DOM underneath. The stage fades in over
// it once the canvas exists, and if anything goes wrong the photo is
// simply left showing.

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { shouldRender3D } from './capabilities.js'
import { StageBoundary } from './StageBoundary.jsx'

const DishStage = lazy(() => import('./DishStage.jsx'))

/**
 * Show a dish in 3D, with the photograph always ready underneath.
 *
 * @param {object}  dish      the menu item (id, name, category, image)
 * @param {node}    photo     the photograph to show before/without the stage
 * @param {string}  className classes for the frame
 * @param {function} onReady  called when the stage has taken over the frame
 */
export default function DishShowcase({ dish, photo, className = '', onReady }) {
  // The capability check is a read of the browser, so it can run during the
  // first render — no effect, no extra paint, no flash of the photo.
  const [allowed] = useState(() => shouldRender3D())
  const [live, setLive] = useState(false)
  const [visible, setVisible] = useState(true)
  const frame = useRef(null)

  // Stop drawing when the stage scrolls out of view.
  useEffect(() => {
    const node = frame.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const ready = (renderer) => {
    setLive(true)
    if (renderer) onReady?.()
  }

  return (
    <div ref={frame} className={`relative overflow-hidden bg-stone-100 ${className}`}>
      <div className={`absolute inset-0 transition-opacity duration-500 ${live ? 'opacity-0' : 'opacity-100'}`}>
        {photo}
      </div>
      {allowed && (
        <StageBoundary fallback={null}>
          <Suspense fallback={null}>
            <div
              className={`absolute inset-0 bg-gradient-to-b from-amber-50 to-stone-200 transition-opacity duration-500 ${live ? 'opacity-100' : 'opacity-0'}`}
            >
              <DishStage dish={dish} active={visible} onReady={ready} />
            </div>
          </Suspense>
        </StageBoundary>
      )}
    </div>
  )
}
