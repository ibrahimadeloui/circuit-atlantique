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

const MODELS = ['sedan-sports', 'taxi', 'suv', 'hatchback-sports']

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

export async function loadRaceCars(): Promise<CarVisual[]> {
  if (MeshoptDecoder.ready) await MeshoptDecoder.ready
  const gltfs = await Promise.all(MODELS.map((name) => loader.loadAsync(`/assets/cars/${name}.glb`)))
  return gltfs.map((gltf) => buildVisual(gltf.scene))
}

function buildVisual(source: THREE.Group): CarVisual {
  const scene = source
  scene.updateMatrixWorld(true)
  const wheels = collectWheels(scene)
  const front = wheels.filter((wheel) => wheel.name.includes('front'))
  const rear = wheels.filter((wheel) => wheel.name.includes('back') || wheel.name.includes('rear'))
  const nose = average(front.length ? front : wheels)
  const tailPoint = average(rear.length ? rear : wheels)
  const forward = nose.clone().sub(tailPoint)
  forward.y = 0
  if (forward.lengthSq() < 1e-4) forward.set(0, 0, 1)
  forward.normalize()
  scene.rotation.y = Math.atan2(forward.z, forward.x)

  const axle = Math.max(nose.distanceTo(tailPoint), 0.4)
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  body.add(scene)
  body.scale.setScalar(2.62 / axle)
  body.updateMatrixWorld(true)
  const grounded = wheels[0]?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3()
  const mid = average(wheels)
  body.position.set(-mid.x, -grounded.y + 0.28 * body.scale.x, -mid.z)

  const spins = wheels
  const steers = front
  const tail = new THREE.MeshStandardMaterial({
    color: 0x6a1010,
    emissive: 0xff2a2a,
    emissiveIntensity: 0.45,
  })
  const head = new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xfff1c4,
    emissiveIntensity: 2.2,
  })
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || isWheel(mesh)) return
    const previous = mesh.material as THREE.MeshStandardMaterial
    const map = previous?.map ?? null
    if (map) map.colorSpace = THREE.SRGBColorSpace
    mesh.material = new THREE.MeshPhysicalMaterial({
      map,
      color: 0xffffff,
      metalness: 0.6,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.15,
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
  for (const wheel of wheels) {
    wheel.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
  }
  for (const side of [-0.42, 0.42]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), head)
    lamp.position.set(1.9, 0.55, side)
    body.add(lamp)
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.05), tail)
    brake.position.set(-1.9, 0.55, side)
    body.add(brake)
  }
  return { root, body, spins, steers, tail }
}

function collectWheels(scene: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse((obj) => {
    if (obj.name.startsWith('wheel')) found.push(obj)
  })
  return found
}

function isWheel(mesh: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = mesh
  while (node) {
    if (node.name.startsWith('wheel')) return true
    node = node.parent
  }
  return false
}

function average(nodes: THREE.Object3D[]): THREE.Vector3 {
  const out = new THREE.Vector3()
  for (const node of nodes) out.add(node.getWorldPosition(new THREE.Vector3()))
  return nodes.length ? out.multiplyScalar(1 / nodes.length) : out
}
