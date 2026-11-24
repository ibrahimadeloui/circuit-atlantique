import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'
import { createCarVisual, type CarVisual } from './cars.ts'
import { loadSurfaces, type SurfaceSet } from './surfaces.ts'
import {
  createChecker,
  createLabel,
  createWaterNormal,
} from './textures.ts'
import type { Race } from '../sim/race.ts'
import { sampleAlong, type Sample, type Track } from '../sim/track.ts'

export type Phase = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished'

export type ViewState = {
  phase: Phase
  camera: 'chase' | 'hood'
  menuDist: number
  countdown: number
  shake: number
}

export type Quality = 'bas' | 'moyen' | 'eleve'

export type World = {
  renderer: THREE.WebGLRenderer
  setSize: (width: number, height: number, pixelRatio: number) => void
  setQuality: (quality: Quality) => void
  update: (race: Race, view: ViewState, dt: number) => void
}

type Vec = { x: number; y: number; z: number }

export async function createWorld(canvas: HTMLCanvasElement, race: Race): Promise<World> {
  const track = race.track
  if (document.fonts?.ready) await document.fonts.ready

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xff8a62, 140, 620)
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.15, 40000)

  const [hdr, surfaces] = await Promise.all([
    new RGBELoader().loadAsync('/assets/hdri/venice_sunset_2k.hdr'),
    loadSurfaces(),
  ])
  hdr.mapping = THREE.EquirectangularReflectionMapping
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromEquirectangular(hdr).texture
  scene.background = hdr
  scene.environmentIntensity = 1.15
  pmrem.dispose()

  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(81), THREE.MathUtils.degToRad(236))
  const hemi = new THREE.HemisphereLight(0xffc4a2, 0x0d3c46, 0.62)
  scene.add(hemi)
  const sunLight = new THREE.DirectionalLight(0xffb15a, 4.4)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(1024, 1024)
  sunLight.shadow.bias = -0.0004
  sunLight.shadow.normalBias = 0.035
  sunLight.shadow.camera.near = 4
  sunLight.shadow.camera.far = 90
  sunLight.shadow.camera.left = -26
  sunLight.shadow.camera.right = 26
  sunLight.shadow.camera.top = 26
  sunLight.shadow.camera.bottom = -26
  scene.add(sunLight)
  scene.add(sunLight.target)

  buildGround(scene, track, surfaces)
  buildTrackSurface(scene, track, surfaces)
  buildWalls(scene, track, surfaces)
  buildMarkings(scene, track)
  buildGantry(scene, track)
  buildProps(scene, track, surfaces)
  buildRails(scene, track)

  const cars = await Promise.all(
    race.cars.map(async (car) => {
      const visual = await createCarVisual(car.color, car.accent, car.number)
      scene.add(visual.root)
      return visual
    }),
  )
  const dust = buildDust(scene)
  const sparks = buildSparks(scene)
  const waterNormal = scene.getObjectByName('water') as THREE.Mesh | undefined

  const lights = gantryLights(scene)
  const camPos = new THREE.Vector3(0, 8, 12)
  const look = new THREE.Vector3()
  let shakeLeft = 0
  let camTime = 0
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
  const bloom = new BloomEffect({
    intensity: 0.4,
    luminanceThreshold: 0.86,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    radius: 0.65,
  })
  const bloomPass = new EffectPass(camera, bloom)
  const gradePass = new EffectPass(
    camera,
    new SMAAEffect(),
    new HueSaturationEffect({ saturation: 0.16 }),
    new BrightnessContrastEffect({ brightness: 0.03, contrast: 0.1 }),
    new VignetteEffect({ offset: 0.28, darkness: 0.52 }),
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
  )
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(bloomPass)
  composer.addPass(gradePass)
  let quality: Quality = 'moyen'
  let mobileSlow = 0
  let postEnabled = true
  const mobile = window.matchMedia('(pointer: coarse)').matches
  const skids = createSkids(scene)
  const applyQuality = (next: Quality) => {
    quality = next
    const size = next === 'eleve' ? 2048 : 1024
    sunLight.shadow.mapSize.set(size, size)
    sunLight.shadow.map?.dispose()
    sunLight.shadow.map = null
    const fancy = next !== 'bas' && postEnabled
    sunLight.castShadow = fancy
    bloomPass.enabled = fancy
    bloom.intensity = next === 'eleve' ? 0.48 : 0.34
  }
  applyQuality('moyen')

  const world: World = {
    renderer,
    setSize: (width, height, pixelRatio) => {
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      composer.setSize(width, height, false)
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
    },
    update: (race, view, dt) => {
      updateCars(race, cars)
      updateDust(race, dust, dt, quality)
      updateSparks(race, sparks, dt)
      updateSkids(track, race, skids)
      updateLights(lights, view, race.clock)
      if (waterNormal) {
        const mat = waterNormal.material as THREE.MeshStandardMaterial
        if (mat.normalMap) {
          mat.normalMap.offset.x += dt * 0.012
          mat.normalMap.offset.y += dt * 0.007
        }
      }
      const player = race.cars[0]!
      shakeLeft = Math.max(shakeLeft, Math.min(1.2, player.impact * 0.08))
      const focus = focusPoint(track, race, view)
      sunLight.position.set(focus.x + sun.x * 48, Math.max(10, sun.y * 48), focus.z + sun.z * 48)
      sunLight.target.position.set(focus.x, focus.y, focus.z)
      sunLight.target.updateMatrixWorld()
      camTime += dt
      updateCamera(camera, camPos, look, track, race, view, dt, shakeLeft, camTime)
      shakeLeft = Math.max(0, shakeLeft - dt * 1.6)
      if (mobile && dt > 1 / 50) mobileSlow += 1
      else mobileSlow = Math.max(0, mobileSlow - 1)
      if (mobile && mobileSlow > 24 && postEnabled) {
        postEnabled = false
        applyQuality(quality)
      }
      if (postEnabled && quality !== 'bas') composer.render()
      else {
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.2
        renderer.render(scene, camera)
        renderer.toneMapping = THREE.NoToneMapping
      }
    },
    setQuality: (next) => {
      applyQuality(next)
      composer.setSize(canvas.clientWidth, canvas.clientHeight)
    },
  }
  return world
}

function buildGround(scene: THREE.Scene, track: Track, surfaces: SurfaceSet): void {
  const { minX, maxX, minZ, maxZ } = track.bounds
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const span = Math.max(maxX - minX, maxZ - minZ)
  const grassMat = surfaces.grass.clone()
  grassMat.map = surfaces.grass.map?.clone() ?? null
  grassMat.normalMap = surfaces.grass.normalMap?.clone() ?? null
  grassMat.roughnessMap = surfaces.grass.roughnessMap?.clone() ?? null
  for (const tex of [grassMat.map, grassMat.normalMap, grassMat.roughnessMap]) {
    if (!tex) continue
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(span / 14, span / 14)
    tex.needsUpdate = true
  }
  const grass = new THREE.Mesh(new THREE.CircleGeometry(span * 0.72 + 120, 64), grassMat)
  grass.rotation.x = -Math.PI / 2
  grass.position.set(cx, 0, cz)
  grass.receiveShadow = true
  scene.add(grass)

  const waterNormal = createWaterNormal()
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(span + 900, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0x083f4c,
      roughness: 0.07,
      metalness: 0.68,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.45,
      normalMap: waterNormal,
    }),
  )
  water.name = 'water'
  water.rotation.x = -Math.PI / 2
  water.position.set(cx, -0.55, cz)
  water.receiveShadow = true
  scene.add(water)
}

function buildTrackSurface(scene: THREE.Scene, track: Track, surfaces: SurfaceSet): void {
  const asphalt = surfaces.asphalt.clone()
  asphalt.side = THREE.DoubleSide
  const sand = surfaces.sand.clone()
  sand.side = THREE.DoubleSide
  scene.add(coloredMesh(flatRibbon(track, -track.halfWidth, track.halfWidth, 0.05, 0.05, 7), asphalt))
  scene.add(coloredMesh(flatRibbon(track, track.halfWidth + 0.5, track.wall - 0.05, 0.03, 0.03, 6), sand))
  scene.add(coloredMesh(flatRibbon(track, -(track.wall - 0.05), -(track.halfWidth + 0.5), 0.03, 0.03, 6), sand))
  const curbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04, side: THREE.DoubleSide })
  scene.add(coloredMesh(curbRibbon(track, 1), curbMat))
  scene.add(coloredMesh(curbRibbon(track, -1), curbMat))
}

function buildWalls(scene: THREE.Scene, track: Track, surfaces: SurfaceSet): void {
  const concrete = surfaces.concrete.clone()
  const stripe = new THREE.MeshStandardMaterial({ color: 0xff7a3c, roughness: 0.45, metalness: 0.12, emissive: 0x5a2208, emissiveIntensity: 0.18 })
  const { positions, normals } = wallGeometry(track)
  const geo = new THREE.BufferGeometry()
  const pos = new THREE.Float32BufferAttribute(positions, 3)
  geo.setAttribute('position', pos)
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 0.18
    uv[i * 2 + 1] = pos.getY(i) * 0.45 + pos.getZ(i) * 0.04
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const mesh = new THREE.Mesh(geo, concrete)
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)

  const band = flatRibbon(track, track.wall - 0.02, track.wall + 0.46, 0.96, 0.96, 4)
  const band2 = flatRibbon(track, -(track.wall + 0.46), -(track.wall - 0.02), 0.96, 0.96, 4)
  scene.add(coloredMesh(band, stripe))
  scene.add(coloredMesh(band2, stripe))
  scene.add(embankment(track, 1))
  scene.add(embankment(track, -1))

  const posts = new THREE.CylinderGeometry(0.08, 0.09, 0.85, 6)
  posts.translate(0, 0.42, 0)
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.4, metalness: 0.05 })
  const matrices: THREE.Matrix4[] = []
  const dummy = new THREE.Object3D()
  for (let dist = 0; dist < track.length; dist += 12) {
    for (const side of [1, -1]) {
      const s = sampleAlong(track, dist)
      const base = roadPoint(s, side * (track.wall + 0.15), 0)
      dummy.position.set(base.x, base.y, base.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      matrices.push(dummy.matrix.clone())
    }
  }
  const inst = new THREE.InstancedMesh(posts, postMat, matrices.length)
  matrices.forEach((m, i) => inst.setMatrixAt(i, m))
  inst.castShadow = false
  scene.add(inst)
}

function buildMarkings(scene: THREE.Scene, track: Track): void {
  const paint = new THREE.MeshStandardMaterial({
    color: 0xf4f1ea,
    roughness: 0.6,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const positions: number[] = []
  const pushRoad = (a: Sample, latA: number, b: Sample, latB: number, lift: number) => {
    const p0 = roadPoint(a, latA, lift)
    const p1 = roadPoint(b, latB, lift)
    const p2 = roadPoint(b, latB + Math.sign(latB || 1) * 0.16, lift)
    const p3 = roadPoint(a, latA + Math.sign(latA || 1) * 0.16, lift)
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z)
  }
  for (let i = 0; i < track.samples.length; i++) {
    const a = track.samples[i]!
    const b = track.samples[(i + 1) % track.samples.length]!
    for (const side of [1, -1]) pushRoad(a, side * (track.halfWidth - 0.55), b, side * (track.halfWidth - 0.55), 0.025)
  }
  for (let dist = 4; dist < track.length; dist += 8) {
    const a = sampleAlong(track, dist)
    const b = sampleAlong(track, dist + 3.4)
    const w = 0.12
    const pa = roadPoint(a, w, 0.03)
    const pb = roadPoint(b, w, 0.03)
    const pc = roadPoint(b, -w, 0.03)
    const pd = roadPoint(a, -w, 0.03)
    positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z, pa.x, pa.y, pa.z, pc.x, pc.y, pc.z, pd.x, pd.y, pd.z)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, paint)
  mesh.receiveShadow = true
  scene.add(mesh)

  const start = sampleAlong(track, 0)
  const checker = new THREE.Mesh(
    new THREE.PlaneGeometry(track.halfWidth * 2, 1.4),
    new THREE.MeshStandardMaterial({ map: createChecker(), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  )
  checker.position.set(start.x, start.y + 0.05, start.z)
  checker.rotation.order = 'YXZ'
  checker.rotation.y = Math.atan2(start.rx, start.rz)
  checker.rotation.x = -Math.PI / 2
  scene.add(checker)
}

function buildGantry(scene: THREE.Scene, track: Track): void {
  const s = sampleAlong(track, 0)
  const group = new THREE.Group()
  group.position.set(s.x, s.y, s.z)
  group.rotation.y = -Math.atan2(s.tz, s.tx)
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.45, metalness: 0.6 })
  const span = track.halfWidth + 1.4
  const pillarGeo = new THREE.BoxGeometry(0.45, 6.4, 0.45)
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, metal)
    pillar.position.set(0, 3.2, side * span)
    pillar.castShadow = true
    group.add(pillar)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, span * 2 + 0.4), metal)
  beam.position.set(0, 6.2, 0)
  beam.castShadow = true
  group.add(beam)
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.15),
    new THREE.MeshStandardMaterial({ map: createLabel('ATLANTIQUE', '#10241f', '#ffb15a'), roughness: 0.55, emissive: 0x3a2010, emissiveIntensity: 0.25 }),
  )
  banner.position.set(-0.35, 6.15, 0)
  banner.rotation.y = -Math.PI / 2
  group.add(banner)

  const redMat = () =>
    new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.4 })
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x002208, emissive: 0x39e27a, emissiveIntensity: 0, roughness: 0.4 })
  const zeds = [-1.6, -0.55, 0.55, 1.6]
  zeds.forEach((z, i) => {
    const mat = i === 3 ? greenMat : redMat()
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat)
    lamp.position.set(0.05, 5.75, z)
    lamp.name = i === 3 ? 'lamp-green' : `lamp-red-${i}`
    group.add(lamp)
  })
  scene.add(group)
  group.name = 'gantry'
}

function gantryLights(scene: THREE.Scene): { reds: THREE.MeshStandardMaterial[]; green: THREE.MeshStandardMaterial } {
  const redMeshes: THREE.Mesh[] = []
  let green: THREE.MeshStandardMaterial | null = null
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.name.startsWith('lamp-red')) redMeshes.push(mesh)
    if (mesh.name === 'lamp-green') green = mesh.material as THREE.MeshStandardMaterial
  })
  redMeshes.sort((a, b) => a.name.localeCompare(b.name))
  if (!green || redMeshes.length !== 3) throw new Error('Feux de départ introuvables')
  return { reds: redMeshes.map((mesh) => mesh.material as THREE.MeshStandardMaterial), green }
}

function updateLights(
  lights: { reds: THREE.MeshStandardMaterial[]; green: THREE.MeshStandardMaterial },
  view: ViewState,
  clock: number,
): void {
  let redsOn = 0
  let greenOn = false
  if (view.phase === 'menu') {
    lights.reds.forEach((mat) => {
      mat.emissiveIntensity = 0.28
    })
    lights.green.emissiveIntensity = 0.02
    return
  } else if (view.phase === 'countdown') {
    if (view.countdown >= 2.55) greenOn = true
    else if (view.countdown >= 1.7) redsOn = 3
    else if (view.countdown >= 0.85) redsOn = 2
    else redsOn = 1
  } else if (view.phase === 'racing' && clock < 1.2) {
    greenOn = true
  }
  lights.reds.forEach((mat, i) => {
    mat.emissiveIntensity = i < redsOn ? 2.4 : 0.02
  })
  lights.green.emissiveIntensity = greenOn ? 2.8 : 0.02
}

function buildRails(scene: THREE.Scene, track: Track): void {
  const metal = new THREE.MeshStandardMaterial({ color: 0xe7edf2, metalness: 0.82, roughness: 0.28 })
  const geo = new THREE.BoxGeometry(5.4, 0.07, 0.07)
  const count = Math.ceil(track.length / 5) * 2 * 2
  const mesh = new THREE.InstancedMesh(geo, metal, count)
  const dummy = new THREE.Object3D()
  let n = 0
  for (let dist = 0; dist < track.length; dist += 5) {
    const s = sampleAlong(track, dist)
    for (const side of [1, -1]) {
      for (const lift of [0.42, 0.78]) {
        const p = roadPoint(s, side * (track.wall + 0.22), lift)
        dummy.position.set(p.x, p.y, p.z)
        dummy.rotation.set(0, -Math.atan2(s.tz, s.tx), 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(n, dummy.matrix)
        n += 1
      }
    }
  }
  mesh.count = n
  mesh.castShadow = false
  scene.add(mesh)
}

function buildProps(scene: THREE.Scene, track: Track, surfaces: SurfaceSet): void {
  const palms = palmMatrices(track)
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 4.6, 6)
  trunkGeo.translate(0, 2.3, 0)
  const fronds = []
  for (let i = 0; i < 7; i++) {
    const frond = new THREE.ConeGeometry(0.22, 2.6, 4)
    frond.translate(0, 1.15, 0)
    frond.rotateZ(1.05)
    frond.rotateY((i / 7) * Math.PI * 2)
    fronds.push(frond)
  }
  const crown = mergeGeometries(fronds)
  crown?.translate(0, 4.55, 0)
  if (!crown) return
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.86 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f9a45, roughness: 0.62, emissive: 0x0c3a18, emissiveIntensity: 0.12 })
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palms.length)
  const leaves = new THREE.InstancedMesh(crown, leafMat, palms.length)
  palms.forEach((m, i) => {
    trunks.setMatrixAt(i, m)
    leaves.setMatrixAt(i, m)
  })
  scene.add(trunks, leaves)

  const concrete = surfaces.concrete
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffc2a8,
    roughness: 0.08,
    metalness: 0.15,
    transmission: 0.2,
    transparent: true,
    opacity: 0.82,
    envMapIntensity: 1.3,
  })
  const doorColors = [0xff7a3c, 0x2ad6c8, 0xffd27a, 0x1d4e89, 0xfff4ea]
  for (let i = 0; i < 5; i++) {
    const s = sampleAlong(track, 28 + i * 16)
    const lat = track.wall + 7
    const box = new THREE.Mesh(new THREE.BoxGeometry(14, 4.6, 7), concrete)
    box.position.set(s.x + s.rx * lat, s.y + 2.3, s.z + s.rz * lat)
    box.rotation.y = -Math.atan2(s.tz, s.tx)
    box.castShadow = true
    box.receiveShadow = true
    scene.add(box)
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(6.5, 2.6),
      new THREE.MeshStandardMaterial({ color: doorColors[i]!, roughness: 0.5 }),
    )
    door.position.set(0, -0.4, -3.51)
    box.add(door)
  }

  const towerS = sampleAlong(track, track.length - 8)
  const tower = new THREE.Mesh(new THREE.BoxGeometry(4.5, 11, 4.5), concrete)
  tower.position.set(towerS.x + towerS.rx * (track.wall + 8), towerS.y + 5.5, towerS.z + towerS.rz * (track.wall + 8))
  tower.castShadow = true
  scene.add(tower)
  const windowBand = new THREE.Mesh(new THREE.BoxGeometry(4.7, 1.2, 4.7), glass)
  windowBand.position.copy(tower.position)
  windowBand.position.y = 8.2
  scene.add(windowBand)

  const standS = sampleAlong(track, 150)
  const stand = new THREE.Group()
  stand.position.set(standS.x + standS.rx * (track.wall + 9), standS.y, standS.z + standS.rz * (track.wall + 9))
  stand.rotation.y = -Math.atan2(standS.tz, standS.tx)
  const base = new THREE.Mesh(new THREE.BoxGeometry(28, 2.2, 8), concrete)
  base.position.set(0, 1.1, 2)
  base.castShadow = true
  base.receiveShadow = true
  stand.add(base)
  const seats = seatTexture()
  const seatMesh = new THREE.Mesh(
    new THREE.BoxGeometry(26, 2.4, 6),
    new THREE.MeshStandardMaterial({ map: seats, roughness: 0.8 }),
  )
  seatMesh.position.set(0, 3.2, 3.2)
  seatMesh.rotation.x = -0.35
  seatMesh.castShadow = true
  stand.add(seatMesh)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c3338, roughness: 0.55, metalness: 0.35 })
  for (const x of [-10, 10]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.2, 8), roofMat)
    pole.position.set(x, 4.2, 5.2)
    pole.castShadow = true
    stand.add(pole)
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(28, 0.28, 10), roofMat)
  roof.position.set(0, 6.7, 3.4)
  roof.castShadow = true
  stand.add(roof)
  scene.add(stand)

  const phrases = ['COTONOU', 'PNEUS ATLANTIC', 'ESSENCE', 'GRAND PRIX', 'LAGUNE', 'VITESSE', 'BÉNIN', 'FREINS']
  phrases.forEach((text, i) => {
    const dist = 80 + i * (track.length / phrases.length)
    const s = sampleAlong(track, dist)
    const side = i % 2 === 0 ? 1 : -1
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.5),
      new THREE.MeshStandardMaterial({
        map: createLabel(text, i % 2 ? '#1a1210' : '#10241f', i % 2 ? '#2ad6c8' : '#ff7a3c'),
        roughness: 0.7,
      }),
    )
    const lat = side * (track.wall + 0.35)
    const boardBase = roadPoint(s, lat, 1.7)
    board.position.set(boardBase.x, boardBase.y, boardBase.z)
    const facing = side > 0 ? Math.PI : 0
    board.rotation.y = -Math.atan2(s.tz, s.tx) + facing
    scene.add(board)
  })

  const windows = windowTexture()
  for (let i = 0; i < 7; i++) {
    const s = sampleAlong(track, 50 + i * 28)
    const height = 8 + (i % 4) * 3.2
    const block = makeBuilding(11 + (i % 2) * 3, height, 8, i % 2 ? 0xf0c2a0 : 0xc45a3a, windows)
    const lat = track.wall + 18 + (i % 3) * 4
    block.position.set(s.x - s.rx * lat, s.y, s.z - s.rz * lat)
    block.rotation.y = -Math.atan2(s.tz, s.tx)
    scene.add(block)
  }
}

function windowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d9d0c4'
  ctx.fillRect(0, 0, 128, 256)
  for (let y = 18; y < 240; y += 28) {
    for (let x = 10; x < 120; x += 22) {
      ctx.fillStyle = (x + y) % 44 === 10 ? '#9ec4d6' : '#6f8fa3'
      ctx.fillRect(x, y, 12, 16)
    }
  }
  ctx.fillStyle = '#6a6258'
  ctx.fillRect(0, 220, 128, 36)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeBuilding(width: number, height: number, depth: number, color: number, windows: THREE.Texture): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, map: windows, roughness: 0.78 }),
  )
  body.position.y = height / 2
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.8, 0.5, depth + 0.8),
    new THREE.MeshStandardMaterial({ color: 0x3e3832, roughness: 0.7 }),
  )
  roof.position.y = height + 0.15
  roof.castShadow = true
  group.add(roof)
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.72, 0.14, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 }),
  )
  awning.position.set(0, height * 0.22, -depth / 2 - 0.45)
  group.add(awning)
  return group
}

function palmMatrices(track: Track): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  const dummy = new THREE.Object3D()
  const push = (x: number, z: number, scale: number, rot: number) => {
    dummy.position.set(x, 0, z)
    dummy.rotation.set(0, rot, 0)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    matrices.push(dummy.matrix.clone())
  }
  for (let dist = 0; dist < track.length; dist += 11) {
    const n = hash(dist)
    if (n < 0.22) continue
    const s = sampleAlong(track, dist)
    const extra = 1.7 + hash(dist + 3) * 5.5
    const x = s.x + s.rx * (track.wall + extra)
    const z = s.z + s.rz * (track.wall + extra)
    if (Math.abs(projectLat(track, x, z)) < track.wall + 3) continue
    push(x, z, 0.85 + hash(dist + 8) * 0.55, hash(dist + 1) * Math.PI * 2)
  }
  const { minX, maxX, minZ, maxZ } = track.bounds
  for (let x = minX + 10; x < maxX; x += 24) {
    for (let z = minZ + 10; z < maxZ; z += 24) {
      if (!insideLoop(track, x, z)) continue
      if (Math.abs(projectLat(track, x, z)) < track.wall + 9) continue
      if (hash(x * 0.1 + z) < 0.45) continue
      push(x, z, 0.9 + hash(z + 4) * 0.7, hash(x) * 6)
      if (matrices.length > 150) return matrices
    }
  }
  return matrices
}

function seatTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const colors = ['#008751', '#f2c200', '#e10600', '#f4f1ea']
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = colors[i % colors.length]!
    ctx.fillRect(0, i * 8, 64, 8)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.set(8, 1)
  return tex
}

function buildSparks(scene: THREE.Scene): { points: THREE.Points; life: number[]; vel: number[] } {
  const count = 48
  const positions = new Float32Array(count * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0xffb15a, size: 0.28, transparent: true, opacity: 0.9, depthWrite: false }),
  )
  scene.add(points)
  return { points, life: Array.from({ length: count }, () => 0), vel: Array.from({ length: count * 3 }, () => 0) }
}

function updateSparks(race: Race, sparks: { points: THREE.Points; life: number[]; vel: number[] }, dt: number): void {
  const attr = sparks.points.geometry.getAttribute('position') as THREE.BufferAttribute
  const player = race.cars[0]!
  for (let i = 0; i < sparks.life.length; i++) {
    if (sparks.life[i]! > 0) {
      sparks.life[i] = sparks.life[i]! - dt
      attr.setX(i, attr.getX(i) + sparks.vel[i * 3]! * dt)
      attr.setY(i, attr.getY(i) + sparks.vel[i * 3 + 1]! * dt)
      attr.setZ(i, attr.getZ(i) + sparks.vel[i * 3 + 2]! * dt)
      sparks.vel[i * 3 + 1]! -= dt * 6
    } else if (player.impact > 1.4 || (player.drifting && player.speed > 12 && i % 3 === 0)) {
      const fx = Math.cos(player.heading)
      const fz = Math.sin(player.heading)
      attr.setXYZ(i, player.x - fx * 1.2, player.roadY + 0.25, player.z - fz * 1.2)
      sparks.vel[i * 3] = -fx * 2 + (Math.random() - 0.5) * 6
      sparks.vel[i * 3 + 1] = 2 + Math.random() * 4
      sparks.vel[i * 3 + 2] = -fz * 2 + (Math.random() - 0.5) * 6
      sparks.life[i] = 0.35
    } else {
      attr.setY(i, -20)
    }
  }
  attr.needsUpdate = true
}

function buildDust(scene: THREE.Scene): { points: THREE.Points; life: number[]; vel: number[] } {
  const count = 70
  const positions = new Float32Array(count * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0xf3f0ea, size: 1.8, transparent: true, opacity: 0.72, depthWrite: false, sizeAttenuation: true }),
  )
  scene.add(points)
  return { points, life: Array.from({ length: count }, () => 0), vel: Array.from({ length: count * 3 }, () => 0) }
}

function updateDust(race: Race, dust: { points: THREE.Points; life: number[]; vel: number[] }, dt: number, quality: Quality): void {
  const attr = dust.points.geometry.getAttribute('position') as THREE.BufferAttribute
  const player = race.cars[0]!
  for (let i = 0; i < dust.life.length; i++) {
    if (dust.life[i]! > 0) {
      dust.life[i] = dust.life[i]! - dt
      attr.setX(i, attr.getX(i) + dust.vel[i * 3]! * dt)
      attr.setY(i, attr.getY(i) + dust.vel[i * 3 + 1]! * dt)
      attr.setZ(i, attr.getZ(i) + dust.vel[i * 3 + 2]! * dt)
      dust.vel[i * 3 + 1]! -= dt * 0.4
    } else if ((player.drifting || player.slipAngle > 0.1) && player.speed > 6) {
      const fx = Math.cos(player.heading)
      const fz = Math.sin(player.heading)
      const rx = Math.sin(player.heading)
      if (quality === 'bas' && i > 12) continue
      attr.setXYZ(i, player.x - fx * 1.5 + rx * (i % 2 ? 1.05 : -1.05), player.roadY + 0.85, player.z - fz * 1.5)
      dust.vel[i * 3] = -fx * 0.6 + (Math.random() - 0.5) * 2.2
      dust.vel[i * 3 + 1] = 2.2 + Math.random() * 1.8
      dust.vel[i * 3 + 2] = -fz * 1.4 + (Math.random() - 0.5) * 1.4
      dust.life[i] = 2.1
    } else {
      attr.setY(i, -10)
    }
  }
  attr.needsUpdate = true
}

function updateCars(race: Race, cars: CarVisual[]): void {
  if (cars.length !== race.cars.length) return
  for (let i = 0; i < race.cars.length; i++) {
    const car = race.cars[i]!
    const view = cars[i]!
    view.root.position.set(car.x, car.roadY + 0.02, car.z)
    // Le nez du modèle est +X. Un repère (avant, haut, droite physique) est inversé :
    // le quaternion extrait retournait la voiture dès que le cap quittait 0.
    // rotateY(-cap) aligne +X sur (cos cap, sin cap) tout en gardant le toit vers le haut.
    view.root.quaternion.identity()
    view.root.rotateY(-car.heading)
    view.root.rotateZ(car.grade)
    view.root.rotateX(car.bank)
    const roll = THREE.MathUtils.clamp(-car.latAccel * 0.012, -0.08, 0.08)
    const pitch = THREE.MathUtils.clamp(-car.accel * 0.003, -0.04, 0.04)
    view.body.rotation.set(pitch, 0, roll)
    const spin = car.wheelSpin % (Math.PI * 2)
    for (const wheel of view.spins) wheel.rotation.x = spin
    for (const steer of view.steers) steer.rotation.y = -car.steer * 0.42
    view.tail.emissiveIntensity = car.brake > 0.12 ? 3 : 0.4
  }
}

function focusPoint(track: Track, race: Race, view: ViewState): THREE.Vector3 {
  if (view.phase === 'menu' || race.cars.length === 0) {
    const s = sampleAlong(track, view.menuDist)
    return new THREE.Vector3(s.x, 0, s.z)
  }
  const car = race.cars[0]!
  return new THREE.Vector3(car.x, 0, car.z)
}

function updateCamera(
  camera: THREE.PerspectiveCamera,
  camPos: THREE.Vector3,
  look: THREE.Vector3,
  track: Track,
  race: Race,
  view: ViewState,
  dt: number,
  shake: number,
  time: number,
): void {
  const desired = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()
  if (view.phase === 'menu' || race.cars.length === 0) {
    const s = sampleAlong(track, view.menuDist)
    const ahead = sampleAlong(track, view.menuDist + 28)
    desired.set(s.x - s.tx * 16 + s.rx * 5, 11, s.z - s.tz * 16 + s.rz * 5)
    lookTarget.set(ahead.x, 1, ahead.z)
    camera.fov = 60
  } else {
    const car = race.cars[0]!
    const fx = Math.cos(car.heading)
    const fz = Math.sin(car.heading)
    const rx = Math.sin(car.heading)
    const rz = -Math.cos(car.heading)
    const carY = car.roadY
    const pace = THREE.MathUtils.clamp(Math.abs(car.speed) / 62, 0, 1)
    if (view.camera === 'hood') {
      desired.set(car.x + fx * 0.9 + rx * -0.34, carY + 1.62, car.z + fz * 0.9 + rz * -0.34)
      lookTarget.set(car.x + fx * 22, carY + 0.55, car.z + fz * 22)
      camera.fov = 66 + pace * 12
    } else {
      desired.set(car.x - fx * 6.6 + rx * 0.15, carY + 2.35, car.z - fz * 6.6 + rz * 0.15)
      lookTarget.set(car.x + fx * 4.5, carY + 0.9, car.z + fz * 4.5)
      camera.fov = 60 + pace * 15
    }
  }
  const chase = view.camera !== 'hood'
  const k = 1 - Math.exp(-(chase ? 8 : 12) * dt)
  if (camPos.distanceTo(desired) > 3.2) camPos.copy(desired)
  else camPos.lerp(desired, view.phase === 'menu' ? Math.min(1, k) : k)
  if (look.distanceTo(lookTarget) > 6) look.copy(lookTarget)
  else look.lerp(lookTarget, 1 - Math.exp(-(chase ? 14 : 16) * dt))
  const speed = race.cars[0] && view.phase !== 'menu' ? Math.abs(race.cars[0].speed) : 0
  const buzz = Math.min(0.07, speed * 0.0007 + Math.abs(race.cars[0]?.slip ?? 0) * 0.003)
  const sx = (hash(shake * 10) - 0.5) * shake + Math.sin(time * 43) * buzz
  const sy = (hash(shake * 20) - 0.5) * shake * 0.6 + Math.sin(time * 57) * buzz * 0.55
  camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z)
  camera.up.set(0, 1, 0)
  camera.lookAt(look)
  if (view.camera === 'chase' && race.cars[0]) {
    camera.rotateZ(THREE.MathUtils.clamp(-race.cars[0].steer * 0.045 - race.cars[0].slip * 0.004, -0.08, 0.08))
  }
  camera.updateProjectionMatrix()
}

function flatRibbon(track: Track, lat0: number, lat1: number, y0: number, y1: number, uvMeters: number): THREE.BufferGeometry {
  const samples = track.samples
  const n = samples.length
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n]!
    const dist = i === n ? track.length : s.dist
    const p0 = roadPoint(s, lat0, y0)
    const p1 = roadPoint(s, lat1, y1)
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
    const bank = s.bank
    const nx = -s.rx * Math.sin(bank)
    const ny = Math.cos(bank)
    const nz = -s.rz * Math.sin(bank)
    normals.push(nx, ny, nz, nx, ny, nz)
    const v = dist / uvMeters
    uvs.push(0, v, 1, v)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

function curbRibbon(track: Track, side: number): THREE.BufferGeometry {
  const samples = track.samples
  const n = samples.length
  const latA = side * (track.halfWidth - 0.15)
  const latB = side * (track.halfWidth + 0.85)
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n]!
    const dist = i === n ? track.length : s.dist
    const warm = Math.floor(dist / 1.55) % 2 === 0
    const c: [number, number, number] = warm ? [1, 0.48, 0.18] : [0.18, 0.86, 0.8]
    const inner = roadPoint(s, latA, 0.03)
    const outer = roadPoint(s, latB, 0.09)
    positions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z)
    colors.push(...c, ...c)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function wallGeometry(track: Track): { positions: number[]; normals: number[] } {
  const positions: number[] = []
  const normals: number[] = []
  const samples = track.samples
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!
    const b = samples[(i + 1) % samples.length]!
    addWall(positions, normals, a, b, track.wall, track.wall + 0.46, 1)
    addWall(positions, normals, a, b, -track.wall, -(track.wall + 0.46), -1)
  }
  return { positions, normals }
}

function addWall(
  positions: number[],
  normals: number[],
  a: Sample,
  b: Sample,
  latIn: number,
  latOut: number,
  facing: number,
): void {
  const p = (s: Sample, lat: number, lift: number): Vec => roadPoint(s, lat, lift)
  const y0 = 0
  const y1 = 0.95
  const aIn0 = p(a, latIn, y0)
  const aIn1 = p(a, latIn, y1)
  const bIn0 = p(b, latIn, y0)
  const bIn1 = p(b, latIn, y1)
  const aOut0 = p(a, latOut, y0)
  const aOut1 = p(a, latOut, y1)
  const bOut0 = p(b, latOut, y0)
  const bOut1 = p(b, latOut, y1)
  const rx = (a.rx + b.rx) / 2
  const rz = (a.rz + b.rz) / 2
  const inward = { x: -rx * facing, y: 0, z: -rz * facing }
  const outward = { x: rx * facing, y: 0, z: rz * facing }
  const up = { x: 0, y: 1, z: 0 }
  if (facing > 0) {
    tri(positions, normals, aIn0, bIn0, bIn1, inward)
    tri(positions, normals, aIn0, bIn1, aIn1, inward)
    tri(positions, normals, aOut0, aOut1, bOut1, outward)
    tri(positions, normals, aOut0, bOut1, bOut0, outward)
  } else {
    tri(positions, normals, aIn0, bIn1, bIn0, inward)
    tri(positions, normals, aIn0, aIn1, bIn1, inward)
    tri(positions, normals, aOut0, bOut1, aOut1, outward)
    tri(positions, normals, aOut0, bOut0, bOut1, outward)
  }
  tri(positions, normals, aIn1, bIn1, bOut1, up)
  tri(positions, normals, aIn1, bOut1, aOut1, up)
}

function tri(positions: number[], normals: number[], a: Vec, b: Vec, c: Vec, n: Vec): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z)
}

function embankment(track: Track, side: number): THREE.Mesh {
  const samples = track.samples
  const n = samples.length
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n]!
    const inner = roadPoint(s, side * (track.wall + 0.2), 0)
    const outerLat = side * (track.wall + 14)
    positions.push(inner.x, inner.y, inner.z, s.x + s.rx * outerLat, 0.12, s.z + s.rz * outerLat)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xd7b07a, roughness: 0.95, side: THREE.DoubleSide }),
  )
  mesh.receiveShadow = true
  return mesh
}

type SkidState = { cursor: number; last: { x: number; y: number; z: number } | null; geo: THREE.BufferGeometry }

function createSkids(scene: THREE.Scene): SkidState {
  const count = 220
  const positions = new Float32Array(count * 18)
  const colors = new Float32Array(count * 24)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: true }),
  )
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  scene.add(mesh)
  return { cursor: 0, last: null, geo }
}

function updateSkids(track: Track, race: Race, skids: SkidState): void {
  const player = race.cars[0]!
  const pos = skids.geo.getAttribute('position') as THREE.BufferAttribute
  const col = skids.geo.getAttribute('color') as THREE.BufferAttribute
  const slipping = player.slipAngle > 0.16 && Math.abs(player.speed) > 8 && Math.abs(player.lat) < track.wall
  if (!slipping) {
    skids.last = null
    return
  }
  const fx = Math.cos(player.heading)
  const fz = Math.sin(player.heading)
  const rx = Math.sin(player.heading)
  const x = player.x - fx * 1.35
  const z = player.z - fz * 1.35
  const y = player.roadY + 0.04
  const prev = skids.last
  skids.last = { x, y, z }
  if (!prev) return
  if (Math.hypot(x - prev.x, z - prev.z) < 0.35) return
  const slot = skids.cursor % 220
  skids.cursor += 1
  const base = slot * 6
  const w = 0.16
  const verts = [
    prev.x + rx * w, prev.y, prev.z - fx * w,
    x + rx * w, y, z - fx * w,
    x - rx * w, y, z + fx * w,
    prev.x + rx * w, prev.y, prev.z - fx * w,
    x - rx * w, y, z + fx * w,
    prev.x - rx * w, prev.y, prev.z + fx * w,
  ]
  for (let i = 0; i < 6; i++) {
    pos.setXYZ(base + i, verts[i * 3]!, verts[i * 3 + 1]!, verts[i * 3 + 2]!)
    col.setXYZW(base + i, 0.05, 0.05, 0.05, 0.45)
  }
  pos.needsUpdate = true
  col.needsUpdate = true
}

function roadPoint(s: Sample, lat: number, lift = 0): Vec {
  return {
    x: s.x + s.rx * lat,
    y: s.y + lat * Math.sin(s.bank) + lift * Math.cos(s.bank),
    z: s.z + s.rz * lat,
  }
}

function coloredMesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material)
  mesh.receiveShadow = true
  return mesh
}

function projectLat(track: Track, x: number, z: number): number {
  let best = Infinity
  let lat = 0
  const step = 6
  for (let i = 0; i < track.samples.length; i += step) {
    const s = track.samples[i]!
    const dx = x - s.x
    const dz = z - s.z
    const d = dx * dx + dz * dz
    if (d < best) {
      best = d
      lat = dx * s.rx + dz * s.rz
    }
  }
  return lat
}

function insideLoop(track: Track, x: number, z: number): boolean {
  let inside = false
  const samples = track.samples
  for (let i = 0, j = samples.length - 1; i < samples.length; j = i++) {
    const yi = samples[i]!.z
    const yj = samples[j]!.z
    const xi = samples[i]!.x
    const xj = samples[j]!.x
    if ((yi > z) !== (yj > z) && x < ((xj - xi) * (z - yi)) / (yj - yi + 1e-9) + xi) inside = !inside
  }
  return inside
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
