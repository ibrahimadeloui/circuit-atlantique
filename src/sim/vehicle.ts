import { clamp, wrapAngle } from './math.ts'
import { project, surfaceAt, type Track } from './track.ts'
import type { Car } from './race.ts'

export type DriveInput = {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
}

const MASS = 1280
const WHEELBASE = 2.62
const LF = 1.22
const LR = WHEELBASE - LF
const YAW_INERTIA = 1650
const WHEEL_R = 0.34
const GEAR_RATIOS = [3.36, 2.2, 1.64, 1.29, 1.05, 0.86]
const FINAL = 3.2
const IDLE = 950
const LIMIT = 7900

export function revInPlace(car: Car, throttle: number, dt: number): void {
  const target = 980 + clamp(throttle, 0, 1) * 6500
  car.rpm += (target - car.rpm) * (1 - Math.exp(-6 * dt))
  car.throttle = clamp(throttle, 0, 1)
  car.brake = 0
  car.speed = 0
  car.gear = 0
  car.drifting = false
  car.slip = 0
}

export function stepVehicle(car: Car, input: DriveInput, track: Track, dt: number): void {
  const throttle = clamp(input.throttle, 0, 1)
  const brake = clamp(input.brake, 0, 1)
  const steer = clamp(input.steer, -1, 1)
  car.throttle = throttle
  car.brake = brake
  car.steer = steer
  car.handbrake = input.handbrake

  const proj = project(track, car.x, car.z, car.segHint)
  car.segHint = proj.index
  car.lat = proj.lat
  const surface = surfaceAt(track, proj.lat)

  const drivenRpm = wheelRpm(car.speed, car.gear)
  let displayRpm = Math.max(IDLE, Math.min(LIMIT, drivenRpm))
  if (throttle > 0.08 && car.speed < 11 && car.speed > -0.4) {
    const flare = IDLE + throttle * 6100
    const couple = clamp(Math.abs(car.speed) / 11, 0, 1)
    displayRpm = Math.max(displayRpm, flare * (1 - couple) + displayRpm * couple)
  }
  if (displayRpm > LIMIT - 80 && throttle > 0.85) {
    displayRpm = LIMIT - 220 * (0.5 + 0.5 * Math.sin(car.wheelSpin * 3))
  }
  car.rpm = displayRpm

  let force = 0
  const wantsReverse = brake > 0.55 && throttle < 0.12 && car.speed < 2.4
  if (throttle > 0.04 && car.speed > -0.4 && !wantsReverse) {
    let trpm = drivenRpm
    if (car.speed < 9) trpm = Math.max(trpm, 3000 + throttle * 2200)
    let tq = torqueMul(Math.min(Math.max(trpm, IDLE), 7600))
    if (drivenRpm > LIMIT && throttle > 0.4) tq *= 0.12
    force += throttle * tq * GEAR_RATIOS[car.gear]! * 4900
  }
  if (wantsReverse) force -= 4600 * brake
  else if (brake > 0.03 && car.speed > 0.2) force -= brake * 17500

  if (throttle < 0.08 && !wantsReverse && car.speed > 2.5) {
    force -= 900 + (5 - car.gear) * 320
  }

  force -= 0.36 * surface.drag * car.speed * Math.abs(car.speed)
  force -= 6.4 * surface.drag * car.speed
  force -= MASS * 9.81 * proj.grade

  if (input.handbrake && Math.abs(car.speed) > 4) {
    force -= Math.sign(car.speed) * 6400
  }

  const accel = force / MASS
  car.accel = accel
  car.speed = clamp(car.speed + accel * dt, -8.5, 72)

  const speedAbs = Math.abs(car.speed)
  const lock = 0.46 + (0.11 - 0.46) * clamp(speedAbs / 58, 0, 1)
  const delta = -steer * lock
  const vx = car.speed
  let vy = -car.slip
  let yaw = car.yawRate
  const frontShare = clamp(0.46 - clamp(accel / 9.81, -0.28, 0.28) * 0.42, 0.32, 0.68)
  const fzFront = MASS * 9.81 * frontShare
  const fzRear = MASS * 9.81 * (1 - frontShare)
  const muFront = surface.mu * 0.94
  const muRear = surface.mu * (input.handbrake ? 0.4 : 1.08)
  const steps = 4
  const h = dt / steps
  let alphaF = 0
  let alphaR = 0
  let latAcc = 0
  for (let i = 0; i < steps; i++) {
    alphaF = Math.atan2(vy + LF * yaw, Math.max(Math.abs(vx), 2.4)) - delta
    alphaR = Math.atan2(vy - LR * yaw, Math.max(Math.abs(vx), 2.4))
    const fyFront = -pacejka(alphaF, fzFront, muFront)
    const fyRear = -pacejka(alphaR, fzRear, muRear)
    const yawAcc = (LF * fyFront - LR * fyRear) / YAW_INERTIA - yaw * 1.35
    latAcc = (fyFront + fyRear) / MASS
    vy += (latAcc - vx * yaw + Math.sin(proj.bank) * 9.81) * h
    yaw += yawAcc * h
  }
  if (speedAbs < 3.2) {
    const blend = clamp((3.2 - speedAbs) / 3.2, 0, 1)
    const kinematic = -(vx / WHEELBASE) * Math.tan(-delta)
    yaw = yaw * (1 - blend) + kinematic * blend
    vy *= 1 - blend * 0.7
  }
  yaw = clamp(yaw, -1.8, 1.8)
  vy = clamp(vy, -12, 12)
  car.heading = wrapAngle(car.heading + yaw * dt)
  car.yawRate = yaw
  car.slip = clamp(-vy, -14, 14)
  car.slipAngle = (Math.abs(alphaF) + Math.abs(alphaR)) * 0.5
  car.latAccel = latAcc
  car.drifting = car.slipAngle > 0.18 || (input.handbrake && speedAbs > 8)
  car.roadY = proj.y
  car.bank = proj.bank
  car.grade = proj.grade

  const fx = Math.cos(car.heading)
  const fz = Math.sin(car.heading)
  const rx = Math.sin(car.heading)
  const rz = -Math.cos(car.heading)
  car.x += (fx * vx - rx * vy) * dt
  car.z += (fz * vx - rz * vy) * dt
  car.wheelSpin += (car.speed / WHEEL_R) * dt

  if (car.speed >= 0.4) {
    const wr = wheelRpm(car.speed, car.gear)
    if (wr > 7450 && car.gear < GEAR_RATIOS.length - 1) car.gear += 1
    else if (wr < 2900 && car.gear > 0) car.gear -= 1
  } else if (car.speed >= 0 && car.gear > 1 && speedAbs < 4) {
    car.gear = 1
  }
}

export function resolveWalls(car: Car, track: Track): number {
  const proj = project(track, car.x, car.z, car.segHint)
  car.segHint = proj.index
  car.lat = proj.lat
  const limit = track.wall
  if (Math.abs(proj.lat) <= limit) return 0
  const sign = Math.sign(proj.lat)
  const pen = Math.abs(proj.lat) - limit
  car.x -= proj.rx * sign * pen
  car.z -= proj.rz * sign * pen

  const nx = proj.rx * sign
  const nz = proj.rz * sign
  const fx = Math.cos(car.heading)
  const fz = Math.sin(car.heading)
  const rx = Math.sin(car.heading)
  const rz = -Math.cos(car.heading)
  let vx = fx * car.speed + rx * car.slip
  let vz = fz * car.speed + rz * car.slip
  const into = vx * nx + vz * nz
  if (into > 0) {
    vx -= into * nx * 1.2
    vz -= into * nz * 1.2
    car.speed = vx * fx + vz * fz
    car.slip = clamp(vx * rx + vz * rz, -16, 16)
    if (into > 6) car.speed *= 0.72
    else if (into > 2) car.speed *= 0.88
    car.wallHits += 1
    return into
  }
  return 0
}

export function separateCars(cars: readonly Car[]): void {
  const radius = 1.02
  const min = radius * 2
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i]!
        const b = cars[j]!
        const aPts = axlePoints(a)
        const bPts = axlePoints(b)
        for (const pa of aPts) {
          for (const pb of bPts) {
            let dx = pb[0] - pa[0]
            let dz = pb[1] - pa[1]
            let d = Math.hypot(dx, dz)
            if (d >= min) continue
            if (d < 1e-4) {
              dx = 1
              dz = 0
              d = 1
            }
            const nx = dx / d
            const nz = dz / d
            const push = (min - d) * 0.5
            a.x -= nx * push
            a.z -= nz * push
            b.x += nx * push
            b.z += nz * push
            const rel = carVelocity(a, nx, nz) - carVelocity(b, nx, nz)
            if (rel < 0) {
              const impulse = -rel * 0.42
              addVelocity(a, nx * impulse, nz * impulse)
              addVelocity(b, -nx * impulse, -nz * impulse)
              if (min - d > 0.35) {
                a.speed *= 0.97
                b.speed *= 0.97
              }
            }
          }
        }
      }
    }
  }
}

function axlePoints(car: Car): [number, number][] {
  const fx = Math.cos(car.heading)
  const fz = Math.sin(car.heading)
  return [
    [car.x + fx * 1.2, car.z + fz * 1.2],
    [car.x - fx * 1.15, car.z - fz * 1.15],
  ]
}

function carVelocity(car: Car, nx: number, nz: number): number {
  const fx = Math.cos(car.heading)
  const fz = Math.sin(car.heading)
  const rx = Math.sin(car.heading)
  const rz = -Math.cos(car.heading)
  const vx = fx * car.speed + rx * car.slip
  const vz = fz * car.speed + rz * car.slip
  return vx * nx + vz * nz
}

function addVelocity(car: Car, dvx: number, dvz: number): void {
  const fx = Math.cos(car.heading)
  const fz = Math.sin(car.heading)
  const rx = Math.sin(car.heading)
  const rz = -Math.cos(car.heading)
  const vx = fx * car.speed + rx * car.slip + dvx
  const vz = fz * car.speed + rz * car.slip + dvz
  car.speed = vx * fx + vz * fz
  car.slip = clamp(vx * rx + vz * rz, -16, 16)
}

function wheelRpm(speed: number, gear: number): number {
  const wheel = (Math.abs(speed) / WHEEL_R) * (60 / (2 * Math.PI))
  return wheel * GEAR_RATIOS[gear]! * FINAL
}

function pacejka(alpha: number, fz: number, mu: number): number {
  const limited = clamp(alpha, -0.55, 0.55)
  const x = 4.6 * limited
  const peak = mu * fz
  return peak * Math.sin(1.35 * Math.atan(x - 0.12 * (x - Math.atan(x))))
}

function torqueMul(rpm: number): number {
  const x = clamp((rpm - 900) / 6800, 0, 1)
  const wave = Math.sin(Math.pow(x, 0.82) * Math.PI)
  return 0.2 + 0.8 * Math.max(0, wave)
}
