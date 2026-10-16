// ─── The 3D dish stage ────────────────────────────────────────────────
// A plated dish the guest can turn with their finger, used on the customer
// menu. It is deliberately made of plain geometry: no textures to download,
// no 3D fonts (so the km/en/zh labels stay real HTML the translator can
// reach), and no shadow maps to compute.
//
// The scene is decorative — the dish photo and its description carry the
// meaning — so the canvas is hidden from assistive technology and the
// photo is always the accessible fallback.

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'

// ─── Deterministic variation ────────────────────────────────────────
// Every dish gets its own arrangement, but the same dish always looks the
// same: the variation is seeded from the dish id, never from Math.random.

function seededRandom(seed) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Palette ────────────────────────────────────────────────────────
const PLATE = '#f7f3ea'
const PLATE_EDGE = '#e6dfd0'
const BUN = '#d9a05b'
const BUN_TOP = '#e8b877'
const PATTY = '#6b3f24'
const CHEESE = '#f2c14e'
const GREENS = ['#5f9a4a', '#7cb85c', '#3f7d3a', '#8fc46a']
const CREAM = '#fdf6e8'
const CHERRY = '#c0392b'
const DRINK = '#e07a3c'
const COFFEE = '#5b3a21'
const STRAW = '#e04f5f'

// ─── The plate ──────────────────────────────────────────────────────
function Plate() {
  return (
    <group>
      <mesh position={[0, -0.12, 0]} receiveShadow>
        <cylinderGeometry args={[1.18, 1.1, 0.07, 48]} />
        <meshStandardMaterial color={PLATE} roughness={0.55} metalness={0.04} />
      </mesh>
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.92, 0.98, 0.1, 48]} />
        <meshStandardMaterial color={PLATE_EDGE} roughness={0.5} metalness={0.05} />
      </mesh>
    </group>
  )
}

// ─── The food ───────────────────────────────────────────────────────
// Each category gets a silhouette the guest recognises at a glance. The
// geometry is a stylised stand-in for the real plate, not a photograph.

function Burger({ seed }) {
  const random = seededRandom(seed)
  const tilt = (random() - 0.5) * 0.16
  return (
    <group position={[0, 0.06, 0]} rotation={[0, tilt, 0]}>
      <mesh position={[0, 0.05, 0]} scale={[1, 0.42, 1]}>
        <sphereGeometry args={[0.72, 28, 20]} />
        <meshStandardMaterial color={BUN} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.68, 0.68, 0.14, 32]} />
        <meshStandardMaterial color={PATTY} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.7, 0.7, 0.04, 32]} />
        <meshStandardMaterial color={CHEESE} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.27, 0]} scale={[1, 0.5, 1]}>
        <sphereGeometry args={[0.7, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color={BUN_TOP} roughness={0.85} />
      </mesh>
      <mesh position={[0.18, 0.46, 0.12]}>
        <sphereGeometry args={[0.07, 12, 10]} />
        <meshStandardMaterial color={CHERRY} roughness={0.45} />
      </mesh>
    </group>
  )
}

function Greens({ seed, count = 11 }) {
  const leaves = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: count }, () => {
      const angle = random() * Math.PI * 2
      const radius = 0.18 + random() * 0.55
      return {
        position: [Math.cos(angle) * radius, 0.1 + random() * 0.12, Math.sin(angle) * radius],
        scale: 0.13 + random() * 0.12,
        color: GREENS[Math.floor(random() * GREENS.length)],
        rotation: [random() * Math.PI, random() * Math.PI, random() * Math.PI],
      }
    })
  }, [seed, count])
  return (
    <group>
      {leaves.map((leaf, index) => (
        <mesh key={index} position={leaf.position} scale={leaf.scale} rotation={leaf.rotation}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={leaf.color} roughness={0.75} />
        </mesh>
      ))}
    </group>
  )
}

function Cake({ seed }) {
  const random = seededRandom(seed)
  return (
    <group position={[0, 0.06, 0]}>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.62, 0.62, 0.44, 32]} />
        <meshStandardMaterial color={CHERRY} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <cylinderGeometry args={[0.64, 0.62, 0.08, 32]} />
        <meshStandardMaterial color={CREAM} roughness={0.6} />
      </mesh>
      <mesh position={[0.1, 0.62, 0.08]}>
        <sphereGeometry args={[0.08 + random() * 0.03, 14, 12]} />
        <meshStandardMaterial color={CHERRY} roughness={0.4} />
      </mesh>
    </group>
  )
}

function Drink({ seed, hot = false }) {
  const random = seededRandom(seed)
  return (
    <group position={[0, 0.06, 0]}>
      <mesh position={[0, 0.44, 0]}>
        <cylinderGeometry args={[0.42, 0.34, 0.88, 32]} />
        <meshStandardMaterial color={hot ? COFFEE : DRINK} roughness={0.35} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 0.06, 32]} />
        <meshStandardMaterial color={CREAM} roughness={0.5} />
      </mesh>
      <mesh position={[0.12, 1.05, 0]} rotation={[0, 0, -0.3]}>
        <cylinderGeometry args={[0.03, 0.03, 0.6, 10]} />
        <meshStandardMaterial color={STRAW} roughness={0.5} />
      </mesh>
      <mesh position={[-0.16, 0.2 + random() * 0.1, 0.2]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color={CREAM} roughness={0.5} />
      </mesh>
    </group>
  )
}

/** A main course that is not a burger: a plated protein with a garnish. */
function PlatedMain({ seed }) {
  const random = seededRandom(seed)
  return (
    <group position={[0, 0.06, 0]}>
      <mesh position={[0, 0.16, 0]} scale={[1, 0.5, 0.8]}>
        <sphereGeometry args={[0.62, 26, 18]} />
        <meshStandardMaterial color={PATTY} roughness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.34, 0.16]} scale={[0.9, 0.5, 0.9]}>
        <sphereGeometry args={[0.24, 16, 12]} />
        <meshStandardMaterial color={GREENS[1]} roughness={0.7} />
      </mesh>
      <mesh position={[-0.26, 0.26, -0.14]} scale={[0.8, 0.4, 0.8]}>
        <sphereGeometry args={[0.18, 14, 10]} />
        <meshStandardMaterial color={random() > 0.5 ? CHEESE : CHERRY} roughness={0.6} />
      </mesh>
    </group>
  )
}

/** Which silhouette suits this dish. */
function DishModel({ dish }) {
  const category = String(dish?.category || '').toLowerCase()
  const name = String(dish?.name || '').toLowerCase()
  const seed = String(dish?.id || 'dish')

  if (category.includes('drink') || category.includes('beverage') || name.includes('soda') || name.includes('coffee') || name.includes('juice')) {
    return <Drink seed={seed} hot={name.includes('coffee')} />
  }
  if (category.includes('dessert') || name.includes('cake') || name.includes('ice')) {
    return <Cake seed={seed} />
  }
  if (category.includes('starter') || category.includes('salad') || name.includes('salad') || name.includes('soup')) {
    return <Greens seed={seed} />
  }
  if (name.includes('burger')) {
    return <Burger seed={seed} />
  }
  return <PlatedMain seed={seed} />
}

// ─── Motion ─────────────────────────────────────────────────────────
// The plate turns slowly and leans a little with the pointer. The whole
// rig is skipped when the canvas is off screen, so a guest scrolling past
// the stage does not keep the GPU busy.

function Rig({ active, dish }) {
  const group = useRef(null)
  const target = useRef({ x: 0, y: 0 })

  useFrame((state, delta) => {
    const node = group.current
    if (!node || !active) return
    node.rotation.y += delta * 0.28
    // Ease towards the pointer instead of snapping to it.
    target.current.x += (state.pointer.y * 0.16 - target.current.x) * 0.06
    target.current.y += (state.pointer.x * 0.22 - target.current.y) * 0.06
    node.rotation.x += (target.current.x - node.rotation.x) * 0.08
    node.position.y = Math.sin(state.clock.elapsedTime * 0.9) * 0.03
  })

  return (
    <group ref={group} position={[0, 0, 0]}>
      <Plate />
      <DishModel dish={dish} />
    </group>
  )
}

/**
 * The 3D stage. `dish` drives the shape and its id the arrangement; the
 * caller decides whether this is rendered at all (see DishShowcase).
 */
export default function DishStage({ dish, active = true, onReady }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.35, 3.1], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      style={{ width: '100%', height: '100%' }}
      onCreated={(renderer) => onReady?.(renderer)}
      aria-hidden="true"
    >
      <ambientLight intensity={0.85} color="#fff6ea" />
      <directionalLight position={[3, 5, 4]} intensity={1.5} color="#fff2d8" />
      <directionalLight position={[-4, 2, -3]} intensity={0.5} color="#cfe2ff" />
      <Rig active={active} dish={dish} />
    </Canvas>
  )
}
