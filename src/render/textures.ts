import * as THREE from 'three'

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
  n = (n ^ (n >>> 13)) >>> 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

function noise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const v00 = hash2(x0, y0)
  const v10 = hash2(x0 + 1, y0)
  const v01 = hash2(x0, y0 + 1)
  const v11 = hash2(x0 + 1, y0 + 1)
  const a = v00 + (v10 - v00) * sx
  const b = v01 + (v11 - v01) * sx
  return a + (b - a) * sy
}

function fbm(x: number, y: number, octaves = 5): number {
  let v = 0
  let a = 0.5
  let f = 1
  for (let i = 0; i < octaves; i++) {
    v += a * noise(x * f, y * f)
    f *= 2
    a *= 0.5
  }
  return v
}

function canvasFrom(size: number, paint: (img: ImageData, size: number) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponible')
  const img = ctx.createImageData(size, size)
  paint(img, size)
  ctx.putImageData(img, 0, 0)
  return canvas
}

function heightToNormal(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  return canvasFrom(size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const hl = height[y * size + ((x - 1 + size) % size)]!
        const hr = height[y * size + ((x + 1) % size)]!
        const hd = height[((y - 1 + size) % size) * size + x]!
        const hu = height[((y + 1) % size) * size + x]!
        const dx = (hr - hl) * strength
        const dy = (hu - hd) * strength
        const len = Math.hypot(dx, dy, 1)
        const i = (y * size + x) * 4
        img.data[i] = (-dx / len) * 127.5 + 127.5
        img.data[i + 1] = (-dy / len) * 127.5 + 127.5
        img.data[i + 2] = (1 / len) * 127.5 + 127.5
        img.data[i + 3] = 255
      }
    }
  })
}

export type SurfaceMaps = { map: THREE.CanvasTexture; normal: THREE.CanvasTexture }

function maps(albedo: HTMLCanvasElement, normal: HTMLCanvasElement, repeatX = 1, repeatY = 1): SurfaceMaps {
  const map = new THREE.CanvasTexture(albedo)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.repeat.set(repeatX, repeatY)
  map.anisotropy = 8
  const normalMap = new THREE.CanvasTexture(normal)
  normalMap.colorSpace = THREE.NoColorSpace
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  normalMap.repeat.set(repeatX, repeatY)
  normalMap.anisotropy = 8
  return { map, normal: normalMap }
}

export function createAsphalt(): SurfaceMaps {
  const size = 512
  const height = new Float32Array(size * size)
  const albedo = canvasFrom(size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size
        const v = y / size
        const coarse = fbm(x * 0.015, y * 0.015, 4)
        const grit = fbm(x * 0.09, y * 0.09, 3)
        const band =
          Math.exp(-((u - 0.3) ** 2) / 0.0032) + Math.exp(-((u - 0.7) ** 2) / 0.0032)
        const seam = Math.abs((v * 18) % 1 - 0.5) < 0.015 ? 0.4 : 0
        let shade = 0.13 + coarse * 0.08 + grit * 0.07 - band * 0.055 - seam * 0.04
        if (hash2(x, y) > 0.992) shade += 0.09
        height[y * size + x] = shade
        const i = (y * size + x) * 4
        img.data[i] = shade * 255 * 0.95
        img.data[i + 1] = shade * 255 * 0.97
        img.data[i + 2] = shade * 255 * 1.02
        img.data[i + 3] = 255
      }
    }
  })
  return maps(albedo, heightToNormal(height, size, 2.4))
}

export function createGrass(): SurfaceMaps {
  const size = 512
  const height = new Float32Array(size * size)
  const albedo = canvasFrom(size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.02, y * 0.02, 5)
        const tuft = fbm(x * 0.12, y * 0.12, 2)
        const dry = hash2(x * 3, y * 5) > 0.86 ? 0.15 : 0
        height[y * size + x] = n * 0.35 + tuft * 0.2
        const g = 78 + n * 70 + tuft * 28 - dry * 30
        const r = 42 + n * 30 + dry * 40
        const b = 32 + n * 18
        const i = (y * size + x) * 4
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
    }
  })
  return maps(albedo, heightToNormal(height, size, 3.2))
}

export function createGravel(): SurfaceMaps {
  const size = 256
  const height = new Float32Array(size * size)
  const albedo = canvasFrom(size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.08, y * 0.08, 4)
        const stone = hash2(x, y) > 0.94 ? 0.25 : 0
        height[y * size + x] = n + stone
        const shade = 0.42 + n * 0.28 + stone
        const i = (y * size + x) * 4
        img.data[i] = shade * 168
        img.data[i + 1] = shade * 148
        img.data[i + 2] = shade * 112
        img.data[i + 3] = 255
      }
    }
  })
  return maps(albedo, heightToNormal(height, size, 3.5))
}

export function createWaterNormal(): THREE.CanvasTexture {
  const size = 256
  const height = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) height[y * size + x] = fbm(x * 0.05, y * 0.05, 4)
  }
  const normal = new THREE.CanvasTexture(heightToNormal(height, size, 1.6))
  normal.colorSpace = THREE.NoColorSpace
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping
  normal.repeat.set(18, 18)
  return normal
}

export function createChecker(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const cells = 16
  for (let x = 0; x < cells; x++) {
    ctx.fillStyle = x % 2 === 0 ? '#f2f2f2' : '#161616'
    ctx.fillRect((x * canvas.width) / cells, 0, canvas.width / cells + 1, canvas.height)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

export function createLabel(text: string, fg: string, bg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = fg
  ctx.font = '700 68px Oswald, Rajdhani, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

export function createNumberPlate(num: string, fg: string, bg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 128, 128)
  ctx.fillStyle = fg
  ctx.font = '700 78px Rajdhani, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(num, 64, 70)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
