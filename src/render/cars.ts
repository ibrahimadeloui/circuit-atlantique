import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

export type CarVisual = {
  root: THREE.Group
  body: THREE.Group
  spins: THREE.Object3D[]
  steers: THREE.Object3D[]
  tail: THREE.MeshStandardMaterial
}

let template: THREE.Group | null = null

async function loadTemplate(): Promise<THREE.Group> {
  if (template) return template
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync('/assets/cars/car.glb')
  template = gltf.scene
  return template
}

export async function createCarVisual(color: number, accent: number, number: string): Promise<CarVisual> {
  const source = await loadTemplate()
  const model = source.clone(true)
  const tail = new THREE.MeshStandardMaterial({
    color: 0x2a0000,
    emissive: 0xff2a1a,
    emissiveIntensity: 0.45,
    roughness: 0.35,
  })
  const spins: THREE.Object3D[] = []
  const steers: THREE.Object3D[] = []

  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = /Body(Hood|Door|Roof|Panel|Rear|Pillar)/.test(mesh.name)
    mesh.receiveShadow = false
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]
    const next = mats.map((mat) => retint(mat, color, accent))
    mesh.material = next.length === 1 ? next[0]! : next
    if (/Taillight/.test(mesh.name) && !/Panel/.test(mesh.name)) mesh.material = tail
  })

  // Le glTF regarde +Z. Le jeu aligne le nez (+X) sur le cap.
  model.rotation.y = Math.PI / 2
  model.position.y = 0

  const body = new THREE.Group()
  body.add(model)
  const root = new THREE.Group()
  root.add(body)
  void number
  return { root, body, spins, steers, tail }
}

function retint(mat: THREE.MeshStandardMaterial, color: number, accent: number): THREE.MeshStandardMaterial {
  const name = mat.name.toLowerCase()
  if (!name.includes('paint')) return mat
  const copy = mat.clone()
  const primary = name.includes('paint 1') || name.includes('paint1')
  copy.map = null
  copy.color.setHex(primary ? color : accent)
  copy.metalness = 0.08
  copy.roughness = 0.34
  if ('clearcoat' in copy) {
    const physical = copy as THREE.MeshPhysicalMaterial
    physical.clearcoat = 1
    physical.clearcoatRoughness = 0.05
    physical.envMapIntensity = 1.2
  }
  return copy
}
