import { clamp, wrapAngle } from './math.ts'
import { project, racingOffset, sampleAlong, type Track } from './track.ts'
import type { DriveInput } from './vehicle.ts'
import type { Car } from './race.ts'

export function aiDrive(track: Track, car: Car, others: readonly Car[], dt: number): DriveInput {
  const proj = project(track, car.x, car.z, car.segHint)
  car.segHint = proj.index
  const speed = car.speed
  const look = clamp(10 + Math.max(speed, 0) * 0.5, 12, 36)
  const aim = sampleAlong(track, proj.dist + look)
  const aimLat = racingOffset(aim.curvature) + car.bias
  const aimX = aim.x + aim.rx * aimLat
  const aimZ = aim.z + aim.rz * aimLat

  const fx = Math.cos(car.heading)
  const fz = Math.sin(car.heading)
  const rx = Math.sin(car.heading)
  const rz = -Math.cos(car.heading)
  const dx = aimX - car.x
  const dz = aimZ - car.z
  const fwd = dx * fx + dz * fz
  const right = dx * rx + dz * rz

  let steer: number
  if (fwd < 1.5) {
    const diff = wrapAngle(Math.atan2(proj.tz, proj.tx) - car.heading)
    steer = clamp(-diff * 1.7, -1, 1)
  } else {
    steer = clamp((right / Math.max(7, fwd)) * 2.4, -1, 1)
  }

  const wantLat = racingOffset(proj.curvature) + car.bias
  steer += clamp((wantLat - proj.lat) * 0.16, -0.4, 0.4)
  if (Math.abs(proj.lat) > track.halfWidth + 0.4) {
    steer += clamp(-Math.sign(proj.lat) * 0.55, -0.7, 0.7)
  }
  steer = clamp(steer, -1, 1)

  const skill = car.skill
  const latA = 6.5 + skill * 2.4
  const brakeA = 6.2 + skill * 3.2
  const vMax = 62 + skill * 10
  const scan = clamp(20 + Math.max(speed, 0) * 2.55, 28, 190)
  const step = 5
  let vLimit = vMax
  const start = Math.ceil(scan / step) * step
  for (let d = start; d >= 0; d -= step) {
    const s = sampleAlong(track, proj.dist + d)
    const k = Math.max(Math.abs(s.curvature), 0.0011)
    const vCorner = Math.min(vMax, Math.sqrt(latA / k))
    vLimit = Math.min(vLimit, vCorner)
    if (d > 0) vLimit = Math.min(vMax, Math.sqrt(vLimit * vLimit + 2 * brakeA * step))
  }

  let throttle = 0
  let brake = 0
  const err = vLimit - speed
  if (speed < 3 && err > 0) throttle = 1
  else if (err > 1.2) throttle = clamp(0.42 + err / 9, 0.4, 1)
  else if (err < -1.6) brake = clamp(-err / 12, 0.12, 1)
  else throttle = 0.5

  const align = fx * proj.tx + fz * proj.tz
  if (align < 0.45 && speed > 7) {
    brake = Math.max(brake, align < 0 ? 0.9 : 0.45)
    throttle = Math.min(throttle, 0.2)
  }

  for (const other of others) {
    if (other === car) continue
    const odx = other.x - car.x
    const odz = other.z - car.z
    const of = odx * fx + odz * fz
    const oright = odx * rx + odz * rz
    if (of > 0.4 && of < 11 && Math.abs(oright) < 2.05) {
      steer = clamp(steer + (oright >= 0 ? -0.55 : 0.55), -1, 1)
      if (of < 4.2 && other.speed <= speed + 1) brake = Math.max(brake, 0.35)
    }
  }

  if (Math.abs(proj.lat) > track.halfWidth + 0.8 && speed > 18) {
    brake = Math.max(brake, 0.38)
    throttle *= 0.4
  }
  if (brake > 0.25) throttle = Math.min(throttle, 0.12)

  const blend = 1 - Math.exp(-9 * dt)
  car.aiSteer += (steer - car.aiSteer) * blend

  return {
    throttle,
    brake,
    steer: clamp(car.aiSteer, -1, 1),
    handbrake: false,
  }
}
