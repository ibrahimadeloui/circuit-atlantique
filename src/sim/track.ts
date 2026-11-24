import { clamp, wrapAngle } from './math.ts'

export type Sample = {
  dist: number
  x: number
  z: number
  y: number
  tx: number
  tz: number
  rx: number
  rz: number
  curvature: number
  /** Pente dh/ds, positif en montée. */
  grade: number
  /** Inclinaison, positif quand le côté droit est plus haut. */
  bank: number
}

export type Gate = {
  dist: number
  x: number
  z: number
  tx: number
  tz: number
  rx: number
  rz: number
  halfSpan: number
}

export type Track = {
  samples: Sample[]
  length: number
  halfWidth: number
  runoff: number
  wall: number
  checkpoints: Gate[]
  finish: Gate
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export type Projection = {
  index: number
  dist: number
  x: number
  z: number
  tx: number
  tz: number
  rx: number
  rz: number
  curvature: number
  lat: number
  y: number
  grade: number
  bank: number
}

type Corner = { x: number; z: number; r: number }

/** Circuit urbain fermé, dans le sens anti-horaire, en mètres. */
const CORNERS: Corner[] = [
  { x: 0, z: 0, r: 70 },
  { x: 360, z: -2, r: 42 },
  { x: 448, z: 64, r: 32 },
  { x: 468, z: 186, r: 44 },
  { x: 390, z: 292, r: 22 },
  { x: 250, z: 252, r: 36 },
  { x: 110, z: 304, r: 42 },
  { x: 4, z: 220, r: 28 },
  { x: -58, z: 120, r: 32 },
  { x: -46, z: 14, r: 40 },
]

const HALF_WIDTH = 6
const RUNOFF = 4.3
const WALL = HALF_WIDTH + RUNOFF

export function racingOffset(curvature: number): number {
  const mag = Math.abs(curvature)
  if (mag < 0.0025) return 0
  const sharp = clamp(mag * 42, 0, 1)
  return -Math.sign(curvature) * sharp * 3.2
}

export function buildTrack(): Track {
  const raw = filletLoop(CORNERS)
  if (raw.length < 40) throw new Error('Circuit trop court après congés.')
  let samples = samplesFromPolyline(raw)
  samples = recenterOnStraight(samples)
  const length = closeLength(samples)
  applyRelief(samples, length)
  const bounds = computeBounds(samples)
  const minRadius = minCornerRadius(samples)
  const minSep = minSeparation(samples, length)
  const step = maxStep(samples, length)
  const startK = maxCurvatureNear(samples, length, 48)

  if (length < 850 || length > 2600) {
    throw new Error(`Longueur de piste invalide : ${length.toFixed(1)} m`)
  }
  if (minRadius < 15) {
    const worst = samples.reduce((a, b) => (Math.abs(b.curvature) > Math.abs(a.curvature) ? b : a))
    throw new Error(
      `Virage trop serré : rayon ${minRadius.toFixed(1)} m en (${worst.x.toFixed(1)}, ${worst.z.toFixed(1)}) dist ${worst.dist.toFixed(1)}`,
    )
  }
  if (minSep < WALL * 2 + 2) {
    throw new Error(`Le circuit se rapproche trop de lui-même (${minSep.toFixed(1)} m)`)
  }
  if (step > 4) throw new Error(`Échantillonnage irrégulier (${step.toFixed(2)} m)`)
  if (startK > 0.02) {
    throw new Error(`La ligne de départ n'est pas sur une ligne droite (k=${startK.toFixed(4)})`)
  }

  const track: Track = {
    samples,
    length,
    halfWidth: HALF_WIDTH,
    runoff: RUNOFF,
    wall: WALL,
    checkpoints: [],
    finish: gateFromSample(samples[0]!, WALL + 0.4),
    bounds,
  }
  const count = 8
  for (let i = 1; i <= count; i++) {
    const dist = (length * i) / (count + 1)
    track.checkpoints.push(gateFromSample(sampleAlong(track, dist), WALL + 0.4))
  }
  return track
}

export function sampleAlong(track: Track, dist: number): Sample {
  const n = track.samples.length
  const L = track.length
  dist = ((dist % L) + L) % L
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (track.samples[mid]!.dist < dist) lo = mid + 1
    else hi = mid
  }
  const i1 = lo
  const i0 = (i1 - 1 + n) % n
  const a = track.samples[i0]!
  const b = track.samples[i1]!
  let span: number
  let t: number
  if (i1 === 0) {
    span = L - a.dist
    const fromA = dist >= a.dist ? dist - a.dist : dist + (L - a.dist)
    t = span > 1e-6 ? fromA / span : 0
  } else {
    span = b.dist - a.dist
    t = span > 1e-6 ? (dist - a.dist) / span : 0
  }
  t = clamp(t, 0, 1)
  return lerpSample(a, b, t, i1 === 0 ? a.dist + t * (L - a.dist) : a.dist + t * (b.dist - a.dist))
}

export function project(track: Track, x: number, z: number, hint = 0): Projection {
  const n = track.samples.length
  const local = search(track, x, z, hint, 70)
  if (local.dist2 <= 144) return local.proj
  return search(track, x, z, 0, Math.ceil(n / 2)).proj
}

export function surfaceAt(track: Track, lat: number): { mu: number; drag: number } {
  const a = Math.abs(lat)
  if (a <= track.halfWidth - 0.2) return { mu: 1.12, drag: 1 }
  if (a <= track.halfWidth + 0.85) return { mu: 0.78, drag: 1.25 }
  const t = clamp((a - track.halfWidth) / track.runoff, 0, 1)
  return { mu: 0.48 + (0.32 - 0.48) * t, drag: 2.1 + (4.6 - 2.1) * t }
}

function gateFromSample(s: Sample, halfSpan: number): Gate {
  return {
    dist: s.dist,
    x: s.x,
    z: s.z,
    tx: s.tx,
    tz: s.tz,
    rx: s.rx,
    rz: s.rz,
    halfSpan,
  }
}

function search(
  track: Track,
  x: number,
  z: number,
  hint: number,
  radius: number,
): { proj: Projection; dist2: number } {
  const samples = track.samples
  const n = samples.length
  const hintI = ((hint % n) + n) % n
  let best = Infinity
  let bestProj: Projection | null = null
  for (let k = -radius; k <= radius; k++) {
    const i = (hintI + k + n * 4) % n
    const j = (i + 1) % n
    const a = samples[i]!
    const b = samples[j]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const len2 = abx * abx + abz * abz
    let t = len2 > 1e-8 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0
    t = clamp(t, 0, 1)
    const fx = a.x + abx * t
    const fz = a.z + abz * t
    const dx = x - fx
    const dz = z - fz
    const dist2 = dx * dx + dz * dz
    if (dist2 < best) {
      best = dist2
      let tx = a.tx + (b.tx - a.tx) * t
      let tz = a.tz + (b.tz - a.tz) * t
      const mag = Math.hypot(tx, tz) || 1
      tx /= mag
      tz /= mag
      const rx = tz
      const rz = -tx
      const segLen = Math.hypot(abx, abz)
      let dist = a.dist + t * segLen
      if (dist >= track.length) dist -= track.length
      const curvature = a.curvature + (b.curvature - a.curvature) * t
      const bank = a.bank + (b.bank - a.bank) * t
      bestProj = {
        index: i,
        dist,
        x: fx,
        z: fz,
        tx,
        tz,
        rx,
        rz,
        curvature,
        lat: dx * rx + dz * rz,
        y: a.y + (b.y - a.y) * t + (dx * rx + dz * rz) * Math.sin(bank),
        grade: a.grade + (b.grade - a.grade) * t,
        bank,
      }
    }
  }
  return { proj: bestProj!, dist2: best }
}

function lerpSample(a: Sample, b: Sample, t: number, dist: number): Sample {
  let tx = a.tx + (b.tx - a.tx) * t
  let tz = a.tz + (b.tz - a.tz) * t
  const mag = Math.hypot(tx, tz) || 1
  tx /= mag
  tz /= mag
  return {
    dist,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    tx,
    tz,
    rx: tz,
    rz: -tx,
    curvature: a.curvature + (b.curvature - a.curvature) * t,
    y: a.y + (b.y - a.y) * t,
    grade: a.grade + (b.grade - a.grade) * t,
    bank: a.bank + (b.bank - a.bank) * t,
  }
}

function applyRelief(samples: Sample[], length: number): void {
  const n = samples.length
  let minY = Infinity
  for (const s of samples) {
    const d = s.dist
    s.y =
      6.2 * Math.sin(d * 0.0036) +
      2.6 * Math.sin(d * 0.0084 + 0.8) +
      0.8 * Math.sin(d * 0.017 + 2.1)
    s.bank = clamp(s.curvature * 2.6, -0.1, 0.1)
    if (s.y < minY) minY = s.y
  }
  for (const s of samples) s.y = s.y - minY + 0.35
  for (let i = 0; i < n; i++) {
    const prev = samples[(i - 1 + n) % n]!
    const next = samples[(i + 1) % n]!
    let ds = next.dist - prev.dist
    if (ds <= 0) ds = next.dist + (length - prev.dist)
    samples[i]!.grade = ds > 0.2 ? (next.y - prev.y) / ds : 0
  }
}

function filletLoop(corners: Corner[]): { x: number; z: number }[] {
  const n = corners.length
  const edge: { x: number; z: number; len: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % n]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 8) throw new Error(`Arête de circuit trop courte (${len.toFixed(1)} m)`)
    edge.push({ x: dx / len, z: dz / len, len })
  }

  type Fillet = {
    t1x: number
    t1z: number
    t2x: number
    t2z: number
    cx: number
    cz: number
    r: number
    delta: number
    a0: number
  }
  const deflection: number[] = []
  const tanHalf: number[] = []
  const setback: number[] = []
  const radius: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const incoming = edge[prev]!
    const outgoing = edge[i]!
    const cross = incoming.x * outgoing.z - incoming.z * outgoing.x
    const dot = clamp(incoming.x * outgoing.x + incoming.z * outgoing.z, -1, 1)
    let turn = Math.atan2(cross, dot)
    if (Math.abs(turn) < 0.04) turn = 0.04 * Math.sign(turn || 1)
    deflection.push(turn)
    const th = Math.tan(Math.abs(turn) / 2)
    tanHalf.push(th)
    radius.push(corners[i]!.r)
    setback.push(corners[i]!.r * th)
  }
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) {
      const avail = edge[i]!.len * 0.9
      const next = (i + 1) % n
      const need = setback[i]! + setback[next]!
      if (need > avail && need > 1e-4) {
        const scale = avail / need
        setback[i] = setback[i]! * scale
        setback[next] = setback[next]! * scale
        radius[i] = setback[i]! / tanHalf[i]!
        radius[next] = setback[next]! / tanHalf[next]!
      }
    }
  }

  const fillets: Fillet[] = []
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const incoming = edge[prev]!
    const outgoing = edge[i]!
    const sb = setback[i]!
    const rad = radius[i]!
    const B = corners[i]!
    const t1x = B.x - incoming.x * sb
    const t1z = B.z - incoming.z * sb
    const t2x = B.x + outgoing.x * sb
    const t2z = B.z + outgoing.z * sb
    const turn = deflection[i]!
    const left = turn > 0 ? 1 : -1
    const px = -incoming.z
    const pz = incoming.x
    const cx = t1x + px * rad * left
    const cz = t1z + pz * rad * left
    const a0 = Math.atan2(t1z - cz, t1x - cx)
    const a1 = Math.atan2(t2z - cz, t2x - cx)
    let delta = wrapAngle(a1 - a0)
    if (delta * turn < 0) delta += Math.sign(turn) * Math.PI * 2
    fillets.push({ t1x, t1z, t2x, t2z, cx, cz, r: rad, delta, a0 })
  }

  const pts: { x: number; z: number }[] = []
  const spacing = 2
  for (let i = 0; i < n; i++) {
    const from = fillets[i]!
    const to = fillets[(i + 1) % n]!
    const slen = Math.hypot(to.t1x - from.t2x, to.t1z - from.t2z)
    if (slen >= 0.6) {
      const steps = Math.max(1, Math.ceil(slen / spacing))
      for (let s = 0; s < steps; s++) {
        const t = s / steps
        pts.push({
          x: from.t2x + (to.t1x - from.t2x) * t,
          z: from.t2z + (to.t1z - from.t2z) * t,
        })
      }
    }
    const arcLen = Math.abs(to.delta) * to.r
    const steps = Math.max(2, Math.ceil(arcLen / spacing))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const ang = to.a0 + to.delta * t
      pts.push({
        x: to.cx + Math.cos(ang) * to.r,
        z: to.cz + Math.sin(ang) * to.r,
      })
    }
  }
  return pts
}

function samplesFromPolyline(pts: { x: number; z: number }[]): Sample[] {
  const n = pts.length
  const headings = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!
    const next = pts[(i + 1) % n]!
    headings[i] = Math.atan2(next.z - prev.z, next.x - prev.x)
  }
  const samples: Sample[] = []
  let dist = 0
  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const next = pts[(i + 1) % n]!
    const h = headings[i]!
    const tx = Math.cos(h)
    const tz = Math.sin(h)
    const seg = Math.hypot(next.x - p.x, next.z - p.z)
    const dh = wrapAngle(headings[(i + 1) % n]! - h)
    const curvature = seg > 1e-4 ? dh / seg : 0
    samples.push({
      dist,
      x: p.x,
      z: p.z,
      tx,
      tz,
      rx: tz,
      rz: -tx,
      curvature,
      y: 0,
      grade: 0,
      bank: 0,
    })
    dist += seg
  }
  smoothCurvature(samples)
  return samples
}

function smoothCurvature(samples: Sample[]): void {
  const n = samples.length
  const next = samples.map((s) => s.curvature)
  for (let i = 0; i < n; i++) {
    const a = samples[(i - 2 + n) % n]!.curvature
    const b = samples[(i - 1 + n) % n]!.curvature
    const c = samples[i]!.curvature
    const d = samples[(i + 1) % n]!.curvature
    const e = samples[(i + 2) % n]!.curvature
    next[i] = (a + 2 * b + 4 * c + 2 * d + e) / 10
  }
  for (let i = 0; i < n; i++) samples[i]!.curvature = next[i]!
}

function recenterOnStraight(samples: Sample[]): Sample[] {
  const n = samples.length
  const straight = samples.map((s) => Math.abs(s.curvature) < 0.005)
  let bestLen = 0
  let bestStart = 0
  let cur = 0
  let start = 0
  for (let k = 0; k < n * 2; k++) {
    const idx = k % n
    if (straight[idx]) {
      if (cur === 0) start = idx
      cur++
      if (cur > bestLen && cur <= n) {
        bestLen = cur
        bestStart = start
      }
    } else {
      cur = 0
    }
  }
  if (bestLen < 20) throw new Error('Aucune ligne droite assez longue pour la grille de départ.')
  const center = (bestStart + Math.floor(bestLen / 2)) % n
  const rotated = samples.slice(center).concat(samples.slice(0, center))
  let dist = 0
  for (let i = 0; i < n; i++) {
    const a = rotated[i]!
    const b = rotated[(i + 1) % n]!
    a.dist = dist
    dist += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return rotated
}

function closeLength(samples: Sample[]): number {
  const n = samples.length
  const a = samples[n - 1]!
  const b = samples[0]!
  return a.dist + Math.hypot(b.x - a.x, b.z - a.z)
}

function computeBounds(samples: Sample[]): Track['bounds'] {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const s of samples) {
    minX = Math.min(minX, s.x)
    maxX = Math.max(maxX, s.x)
    minZ = Math.min(minZ, s.z)
    maxZ = Math.max(maxZ, s.z)
  }
  return { minX, maxX, minZ, maxZ }
}

function minCornerRadius(samples: Sample[]): number {
  let minR = Infinity
  for (const s of samples) {
    const k = Math.abs(s.curvature)
    if (k > 0.004) minR = Math.min(minR, 1 / k)
  }
  return minR
}

function minSeparation(samples: Sample[], length: number): number {
  let minSep = Infinity
  const stride = 3
  for (let i = 0; i < samples.length; i += stride) {
    for (let j = i + stride; j < samples.length; j += stride) {
      let arc = Math.abs(samples[i]!.dist - samples[j]!.dist)
      arc = Math.min(arc, length - arc)
      if (arc < 70) continue
      const d = Math.hypot(samples[i]!.x - samples[j]!.x, samples[i]!.z - samples[j]!.z)
      if (d < minSep) minSep = d
    }
  }
  return minSep
}

function maxStep(samples: Sample[], length: number): number {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!
    const b = samples[(i + 1) % samples.length]!
    const seg = i === samples.length - 1 ? length - a.dist : b.dist - a.dist
    if (seg > max) max = seg
  }
  return max
}

function maxCurvatureNear(samples: Sample[], length: number, window: number): number {
  let maxK = 0
  for (const s of samples) {
    const d = Math.min(s.dist, length - s.dist)
    if (d <= window) maxK = Math.max(maxK, Math.abs(s.curvature))
  }
  return maxK
}
