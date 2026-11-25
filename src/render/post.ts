import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export type PostTier = 'basse' | 'phone' | 'moyenne' | 'haute'

function makeLut(): THREE.Data3DTexture {
  const size = 16
  const data = new Uint8Array(size * size * size * 4)
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const i = ((b * size + g) * size + r) * 4
        let R = r / (size - 1)
        let G = g / (size - 1)
        let B = b / (size - 1)
        const l = R * 0.2126 + G * 0.7152 + B * 0.0722
        R = Math.min(1, R * (0.86 + 0.4 * l) + 0.04 * l)
        G = Math.min(1, G * (0.8 + 0.12 * l))
        B = Math.min(1, B * (1.08 - 0.5 * l) + 0.08 * (1 - l))
        data[i] = Math.round(R * 255)
        data[i + 1] = Math.round(G * 255)
        data[i + 2] = Math.round(B * 255)
        data[i + 3] = 255
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size)
  tex.format = THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.wrapR = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
) {
  let tier: PostTier = 'moyenne'
  let composer: EffectComposer | null = null
  const lut = makeLut()

  function rebuild() {
    composer?.dispose()
    const width = Math.max(2, renderer.domElement.clientWidth || window.innerWidth)
    const height = Math.max(2, renderer.domElement.clientHeight || window.innerHeight)
    composer = new EffectComposer(renderer)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(width, height)
    composer.addPass(new RenderPass(scene, camera))
    if (tier === 'haute') {
      const gtao = new GTAOPass(scene, camera, width, height)
      gtao.output = GTAOPass.OUTPUT.Default
      gtao.blendIntensity = 0.55
      composer.addPass(gtao)
      composer.addPass(new SMAAPass())
    } else if (tier === 'moyenne') {
      const ssao = new SSAOPass(scene, camera, width, height, 12)
      ssao.kernelRadius = 8
      ssao.minDistance = 0.002
      ssao.maxDistance = 0.12
      composer.addPass(ssao)
    }
    if (tier === 'haute' || tier === 'moyenne') {
      const strength = tier === 'haute' ? 0.05 : 0.03
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), strength, 0.32, 0.88))
    }
    if (tier !== 'basse') {
      composer.addPass(new LUTPass({ lut, intensity: 0.88 }))
    }
    composer.addPass(new OutputPass())
  }

  return {
    tier: () => tier,
    setTier(next: PostTier) {
      if (next === tier) return
      tier = next
      composer = null
    },
    setSize() {
      composer = null
    },
    render() {
      if (!composer) rebuild()
      composer?.render()
    },
  }
}
