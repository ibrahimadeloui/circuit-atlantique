import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createNumberPlate } from './textures.ts'

export type CarVisual = {
  root: THREE.Group
  body: THREE.Group
  spins: THREE.Object3D[]
  steers: THREE.Object3D[]
  tail: THREE.MeshStandardMaterial
}

const paint = (color: number) =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.62, roughness: 0.32, envMapIntensity: 0.85 })

export function createCarVisual(color: number, accent: number, number: string): CarVisual {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const shell = paint(color)
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.5, roughness: 0.48 })
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0b1218,
    metalness: 0.15,
    roughness: 0.06,
    transparent: true,
    opacity: 0.62,
    envMapIntensity: 1,
  })
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.4, roughness: 0.4 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.02 })
  const rim = new THREE.MeshStandardMaterial({ color: 0xd5d8de, metalness: 0.92, roughness: 0.22 })
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xfff4d2,
    emissive: 0xfff1c4,
    emissiveIntensity: 0.7,
    roughness: 0.25,
  })
  const tail = new THREE.MeshStandardMaterial({
    color: 0x3a0000,
    emissive: 0xff1d1d,
    emissiveIntensity: 0.45,
    roughness: 0.35,
  })

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.rotation.set(rx, ry, rz)
    mesh.castShadow = true
    mesh.receiveShadow = true
    body.add(mesh)
    return mesh
  }

  add(new RoundedBoxGeometry(4.35, 0.16, 1.92, 2, 0.04), dark, 0.05, 0.28, 0)
  add(new RoundedBoxGeometry(4.15, 0.38, 1.78, 3, 0.08), shell, 0.02, 0.5, 0)
  add(new RoundedBoxGeometry(3.7, 0.18, 1.96, 2, 0.04), dark, 0.0, 0.4, 0)
  add(new RoundedBoxGeometry(1.45, 0.12, 1.62, 2, 0.04), shell, 1.15, 0.74, 0, 0, 0, -0.06)
  add(new RoundedBoxGeometry(1.35, 0.4, 1.5, 3, 0.1), shell, -0.28, 0.92, 0)
  add(new THREE.BoxGeometry(0.85, 0.36, 1.38), glass, 0.42, 0.98, 0, 0, 0, -0.42)
  add(new THREE.BoxGeometry(0.55, 0.28, 1.28), glass, -0.95, 0.96, 0, 0, 0, 0.55)
  add(new RoundedBoxGeometry(0.9, 0.1, 1.66, 2, 0.03), shell, -1.45, 0.76, 0)
  add(new THREE.BoxGeometry(0.42, 0.05, 1.62), dark, 1.95, 0.42, 0)
  add(new THREE.BoxGeometry(0.12, 0.08, 0.7), dark, 2.12, 0.48, 0)

  const stripe = new THREE.BoxGeometry(2.3, 0.03, 0.18)
  add(stripe, accentMat, 0.85, 0.82, 0)
  add(new THREE.BoxGeometry(1.1, 0.03, 0.22), accentMat, -0.25, 1.14, 0)

  lamp.emissiveIntensity = 1.6
  add(new THREE.BoxGeometry(0.22, 0.12, 0.55), lamp, 2.05, 0.56, -0.58)
  add(new THREE.BoxGeometry(0.22, 0.12, 0.55), lamp, 2.05, 0.56, 0.58)
  add(new THREE.BoxGeometry(0.16, 0.18, 0.62), tail, -2.12, 0.58, -0.58)
  add(new THREE.BoxGeometry(0.16, 0.18, 0.62), tail, -2.12, 0.58, 0.58)
  add(new RoundedBoxGeometry(0.7, 0.12, 1.5, 2, 0.03), dark, -1.85, 0.32, 0)
  add(new THREE.BoxGeometry(3.2, 0.12, 0.08), dark, 0.1, 0.36, 0.98)
  add(new THREE.BoxGeometry(3.2, 0.12, 0.08), dark, 0.1, 0.36, -0.98)
  for (const side of [-1, 1]) {
    add(new RoundedBoxGeometry(0.9, 0.28, 0.18, 2, 0.04), dark, 1.35, 0.48, side * 0.92)
    add(new RoundedBoxGeometry(0.9, 0.28, 0.18, 2, 0.04), dark, -1.35, 0.48, side * 0.92)
    add(new THREE.BoxGeometry(0.08, 0.22, 0.28), dark, -2.16, 1.12, side * 0.78)
  }

  const pillarGeo = new THREE.BoxGeometry(0.06, 0.28, 0.06)
  add(pillarGeo, dark, -2.02, 0.98, -0.55)
  add(pillarGeo, dark, -2.02, 0.98, 0.55)
  add(new THREE.BoxGeometry(0.38, 0.06, 1.55), dark, -2.08, 1.14, 0)

  add(new THREE.BoxGeometry(0.08, 0.08, 0.16), dark, 0.55, 0.95, -0.82)
  add(new THREE.BoxGeometry(0.08, 0.08, 0.16), dark, 0.55, 0.95, 0.82)

  const luminance = ((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11
  const plate = createNumberPlate(number, luminance > 170 ? '#1a1a1a' : '#f6f3ea', luminance > 170 ? '#f4f4f4' : '#141414')
  const plateMat = new THREE.MeshStandardMaterial({ map: plate, roughness: 0.6, metalness: 0.1 })
  add(new THREE.PlaneGeometry(0.38, 0.38), plateMat, 0.15, 0.72, 0.9, 0, Math.PI / 2, 0)
  add(new THREE.PlaneGeometry(0.38, 0.38), plateMat, 0.15, 0.72, -0.9, 0, -Math.PI / 2, 0)
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), plateMat)
  roof.rotation.x = -Math.PI / 2
  roof.position.set(-0.2, 1.16, 0)
  roof.castShadow = true
  body.add(roof)

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 16, 12),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.45 }),
  )
  helmet.position.set(-0.12, 1.08, -0.28)
  helmet.scale.set(1, 0.9, 1)
  helmet.castShadow = true
  body.add(helmet)
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x071014, roughness: 0.05, metalness: 0.8 }),
  )
  visor.position.set(0.06, 1.1, -0.28)
  visor.scale.set(0.7, 0.55, 1)
  body.add(visor)

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18)
  wheelGeo.rotateX(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12)
  rimGeo.rotateX(Math.PI / 2)
  const spins: THREE.Object3D[] = []
  const steers: THREE.Object3D[] = []
  const axles = [
    { x: 1.38, z: -0.86, steer: true },
    { x: 1.38, z: 0.86, steer: true },
    { x: -1.38, z: -0.86, steer: false },
    { x: -1.38, z: 0.86, steer: false },
  ]
  for (const axle of axles) {
    const pivot = new THREE.Group()
    pivot.position.set(axle.x, 0.34, axle.z)
    const spin = new THREE.Group()
    const tire = new THREE.Mesh(wheelGeo, rubber)
    const hub = new THREE.Mesh(rimGeo, rim)
    tire.castShadow = true
    hub.castShadow = true
    spin.add(tire, hub)
    for (let spoke = 0; spoke < 5; spoke++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.04), rim)
      blade.rotation.z = (spoke / 5) * Math.PI
      blade.position.z = axle.z > 0 ? 0.08 : -0.08
      spin.add(blade)
    }
    pivot.add(spin)
    root.add(pivot)
    spins.push(spin)
    if (axle.steer) steers.push(pivot)
  }

  return { root, body, spins, steers, tail }
}
