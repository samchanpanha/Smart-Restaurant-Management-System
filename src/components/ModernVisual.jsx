import { lazy, Suspense, useMemo } from 'react'
import { shouldRender3D } from './three/capabilities'
import { StageBoundary } from './three/StageBoundary'

// A small, optional 3D flourish for hero surfaces (sign-in, empty states).
// It shares the guest menu's capability contract: no WebGL — or a guest who
// asked for reduced motion — gets a static gradient instead, and the three.js
// chunk is never fetched. POS and the Kitchen never mount this, so they pay
// nothing for it.

const Scene = lazy(() => import('./ThreeScene'))

export function ModernVisual({ className = '', variant = 'wave' }) {
  const show3d = useMemo(shouldRender3D, [])
  const fallback = (
    <div
      className={`rounded-2xl bg-gradient-to-br from-orange-100 via-amber-50 to-orange-50 ${className}`}
      aria-hidden="true"
    />
  )

  if (!show3d) return fallback

  return (
    <StageBoundary fallback={fallback}>
      <Suspense fallback={<div className={`animate-pulse rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 ${className}`} />}>
        <Scene className={className} variant={variant} />
      </Suspense>
    </StageBoundary>
  )
}
