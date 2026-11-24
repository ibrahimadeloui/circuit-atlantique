import * as THREE from 'three'

export type CarVisual = {
  root: THREE.Group
  body: THREE.Group
  spins: THREE.Object3D[]
  steers: THREE.Object3D[]
  tail: THREE.MeshStandardMaterial
}

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xb7d7ea,
  metalness: 0,
  roughness: 0.04,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  transparent: true,
  opacity: 0.42,
  envMapIntensity: 1.5,
  depthWrite: false,
})
const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 })
const dark = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6, metalness: 0.2 })
const chrome = new THREE.MeshPhysicalMaterial({ color: 0xd5dbe3, metalness: 0.9, roughness: 0.18, clearcoat: 0.4 })

function plateMaterial(number: string): THREE.MeshStandardMaterial {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 48
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f4f1ea'
  ctx.fillRect(0, 0, 128, 48)
  ctx.fillStyle = '#1a1a1a'
  ctx.font = '700 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(number, 64, 26)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })
}

function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  cast = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = cast
  parent.add(mesh)
  return mesh
}

function addWheel(parent: THREE.Object3D, x: number, y: number, z: number, front: boolean) {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, z)
  const spin = new THREE.Group()
  const radius = 0.34
  const width = 0.24
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 16)
  tireGeo.rotateX(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.05, 12)
  rimGeo.rotateX(Math.PI / 2)
  const hubGeo = new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, width * 1.15, 8)
  hubGeo.rotateX(Math.PI / 2)
  spin.add(new THREE.Mesh(tireGeo, rubber), new THREE.Mesh(rimGeo, chrome), new THREE.Mesh(hubGeo, dark))
  for (const child of spin.children) (child as THREE.Mesh).castShadow = true
  pivot.add(spin)
  parent.add(pivot)
  return { pivot, spin, front }
}

export function createCarVisual(color: number, accent: number, number: string): CarVisual {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.22,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.25,
  })
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: accent,
    metalness: 0.2,
    roughness: 0.28,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
  })
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xfff1c4,
    emissiveIntensity: 1.4,
    roughness: 0.25,
  })
  const tail = new THREE.MeshStandardMaterial({
    color: 0x3a0008,
    emissive: 0xff2430,
    emissiveIntensity: 0.55,
    roughness: 0.35,
  })

  addBox(body, 4.35, 0.22, 1.78, 0, 0.42, 0, dark, false)
  addBox(body, 4.15, 0.42, 1.72, 0.02, 0.62, 0, paint)
  const hood = addBox(body, 1.2, 0.12, 1.55, 1.2, 0.88, 0, paint)
  hood.rotation.z = -0.1
  addBox(body, 0.7, 0.16, 1.42, -1.45, 0.78, 0, paint)
  addBox(body, 1.7, 0.5, 1.5, -0.15, 1.08, 0, paint)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.36, 1.38), glassMat)
  glass.position.set(-0.12, 1.1, 0)
  body.add(glass)
  addBox(body, 0.12, 0.14, 1.82, 2.15, 0.42, 0, chrome, false)
  addBox(body, 0.12, 0.14, 1.82, -2.12, 0.42, 0, chrome, false)
  addBox(body, 0.2, 0.12, 0.16, 0.4, 0.98, 0.95, chrome, false)
  addBox(body, 0.2, 0.12, 0.16, 0.4, 0.98, -0.95, chrome, false)
  addBox(body, 3.6, 0.08, 0.22, 0.1, 0.78, 0, accentMat, false)

  const wheels = [
    addWheel(body, 1.38, 0.34, -0.86, true),
    addWheel(body, 1.38, 0.34, 0.86, true),
    addWheel(body, -1.35, 0.34, -0.86, false),
    addWheel(body, -1.35, 0.34, 0.86, false),
  ]
  for (const side of [-0.58, 0.58]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.28), headMat)
    lamp.position.set(2.12, 0.58, side)
    body.add(lamp)
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.26), tail)
    rear.position.set(-2.12, 0.62, side)
    body.add(rear)
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.42), plateMaterial(number))
  plate.position.set(-2.16, 0.46, 0)
  body.add(plate)

  return {
    root,
    body,
    spins: wheels.map((wheel) => wheel.spin),
    steers: wheels.filter((wheel) => wheel.front).map((wheel) => wheel.pivot),
    tail,
  }
}
