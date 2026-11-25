import * as THREE from 'three'

export type SurfaceSet = {
  asphalt: THREE.MeshStandardMaterial
  grass: THREE.MeshStandardMaterial
  sand: THREE.MeshStandardMaterial
  concrete: THREE.MeshStandardMaterial
}

export async function loadSurfaces(): Promise<SurfaceSet> {
  const [asphalt, grass, sand, concrete] = await Promise.all([
    loadPbr('asphalt', 1, 1, 0x14181e),
    loadPbr('grass', 18, 18, 0xffffff),
    loadPbr('sand', 1, 1, 0xffe6c2),
    loadPbr('concrete', 1, 1, 0xe6ddd2),
  ])
  asphalt.roughness = 0.92
  asphalt.metalness = 0.04
  grass.roughness = 1
  sand.roughness = 0.96
  concrete.roughness = 0.88
  concrete.metalness = 0.02
  return { asphalt, grass, sand, concrete }
}

async function loadPbr(name: string, repeatX: number, repeatY: number, color: number): Promise<THREE.MeshStandardMaterial> {
  const loader = new THREE.TextureLoader()
  const base = `/assets/textures/${name}`
  const [map, normalMap, roughnessMap] = await Promise.all([
    loader.loadAsync(`${base}/diff.jpg`),
    loader.loadAsync(`${base}/nor.jpg`),
    loader.loadAsync(`${base}/rough.jpg`),
  ])
  map.colorSpace = THREE.SRGBColorSpace
  normalMap.colorSpace = THREE.NoColorSpace
  roughnessMap.colorSpace = THREE.NoColorSpace
  for (const tex of [map, normalMap, roughnessMap]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeatX, repeatY)
    tex.anisotropy = 8
  }
  return new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, color, roughness: 1, metalness: 0 })
}
