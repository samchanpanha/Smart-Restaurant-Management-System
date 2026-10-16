import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'

// Lightweight 3D flourish. Uses only `three` + `@react-three/fiber` (both
// already dependencies) so there is no extra install. Lazy-loaded via
// ModernVisual so it never touches the POS / Kitchen bundles.

function FloatingTiles({ count = 6 }) {
  const group = useRef(null)
  const tiles = useMemo(
    () => Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2
      return {
        key: i,
        position: [Math.sin(angle) * 1.9, (i - count / 2) * 0.32, Math.cos(angle) * 1.9],
        color: `hsl(22, 92%, ${52 + i * 5}%)`,
        speed: 0.6 + i * 0.12,
      }
    }),
    [count],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (!group.current) return
    group.current.rotation.y = t * 0.18
    group.current.children.forEach((child, i) => {
      child.position.y = tiles[i].position[1] + Math.sin(t * tiles[i].speed + i) * 0.12
      child.rotation.x = t * 0.3 * tiles[i].speed
    })
  })

  return (
    <group ref={group}>
      {tiles.map((tile) => (
        <mesh key={tile.key} position={tile.position} castShadow>
          <boxGeometry args={[0.42, 0.42, 0.42]} />
          <meshStandardMaterial color={tile.color} roughness={0.35} metalness={0.15} />
        </mesh>
      ))}
    </group>
  )
}

function PulsingSphere() {
  const mesh = useRef(null)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (!mesh.current) return
    mesh.current.rotation.y = t * 0.25
    const s = 1 + Math.sin(t * 1.4) * 0.06
    mesh.current.scale.setScalar(s)
  })
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.1, 1]} />
      <meshStandardMaterial color="#ea580c" flatShading roughness={0.4} metalness={0.2} />
    </mesh>
  )
}

export default function ThreeScene({ className = '', variant = 'wave' }) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 1.1, 4.2], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 4]} intensity={1.05} />
        {variant === 'wave' ? <FloatingTiles /> : <PulsingSphere />}
      </Canvas>
    </div>
  )
}
