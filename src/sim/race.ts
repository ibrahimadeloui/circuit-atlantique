import { project, sampleAlong, type Track } from './track.ts'
import { resolveWalls, separateCars, stepVehicle, type DriveInput } from './vehicle.ts'
import { aiDrive } from './ai.ts'

export type DriverDef = {
  key: string
  name: string
  color: number
  accent: number
  number: string
  skill: number
  bias: number
  isPlayer: boolean
  row: number
  col: number
}

export const DRIVERS: readonly DriverDef[] = [
  { key: 'player', name: 'Vous', color: 0xf2c200, accent: 0x008751, number: '7', skill: 1, bias: -0.15, isPlayer: true, row: 0, col: 0 },
  { key: 'koffi', name: 'Koffi', color: 0xd10f2b, accent: 0xf4f6f8, number: '3', skill: 0.97, bias: 0.7, isPlayer: false, row: 0, col: 1 },
  { key: 'amina', name: 'Amina', color: 0xf5f6f7, accent: 0xc8102e, number: '11', skill: 0.9, bias: -0.55, isPlayer: false, row: 1, col: 0 },
  { key: 'sena', name: 'Sèna', color: 0x1d4e89, accent: 0xf2c200, number: '21', skill: 0.84, bias: 0.2, isPlayer: false, row: 1, col: 1 },
]

export const RACE_LAPS = 3

export type Car = {
  key: string
  name: string
  color: number
  accent: number
  number: string
  isPlayer: boolean
  skill: number
  bias: number
  row: number
  col: number
  x: number
  z: number
  heading: number
  speed: number
  slip: number
  gear: number
  rpm: number
  yawRate: number
  accel: number
  steer: number
  throttle: number
  brake: number
  handbrake: boolean
  drifting: boolean
  wheelSpin: number
  segHint: number
  aiSteer: number
  lat: number
  roadY: number
  bank: number
  grade: number
  slipAngle: number
  latAccel: number
  wrongWay: boolean
  completedLaps: number
  nextCheckpoint: number
  finished: boolean
  finishTime: number | null
  lapStart: number
  bestLap: number | null
  lapTimes: number[]
  stuckTime: number
  wallHits: number
  respawns: number
  impact: number
}

export type Race = {
  track: Track
  cars: Car[]
  clock: number
}

export type Standing = {
  car: Car
  position: number
  progress: number
  gapMeters: number
}

export function createRace(track: Track): Race {
  const cars = DRIVERS.map((d) => makeCar(track, d))
  return { track, cars, clock: 0 }
}

export function resetRace(race: Race): void {
  race.clock = 0
  for (const driver of DRIVERS) {
    const car = race.cars.find((c) => c.key === driver.key)!
    placeOnGrid(race.track, car, driver)
    clearRaceProgress(car)
  }
}

export function stepRace(race: Race, playerInput: DriveInput, dt: number): void {
  const steps = 2
  const h = dt / steps
  race.clock += dt
  for (let s = 0; s < steps; s++) {
    const snapshot = race.cars.map((c) => ({ x: c.x, z: c.z }))
    for (const car of race.cars) {
      if (!car.isPlayer && !car.finished && car.stuckTime > 2.4) {
        respawnCar(race.track, car)
        car.respawns += 1
      }
    }
    for (const car of race.cars) {
      const input = inputFor(race, car, playerInput, h)
      stepVehicle(car, input, race.track, h)
    }
    separateCars(race.cars)
    for (const car of race.cars) {
      car.impact = resolveWalls(car, race.track)
    }
    for (let i = 0; i < race.cars.length; i++) {
      const car = race.cars[i]!
      const before = snapshot[i]!
      if (Math.hypot(car.x - before.x, car.z - before.z) > 25) {
        continue
      }
      updateGates(race, car, before.x, before.z)
    }
  }
  for (const car of race.cars) {
    const proj = project(race.track, car.x, car.z, car.segHint)
    car.segHint = proj.index
    car.lat = proj.lat
    const along = Math.cos(car.heading) * proj.tx + Math.sin(car.heading) * proj.tz
    car.wrongWay = along < -0.4 && car.speed > 3.5 && !car.finished
    const pushing = car.throttle > 0.55 || car.brake > 0.55
    if (car.speed < 1.7 && pushing) car.stuckTime += dt
    else car.stuckTime = Math.max(0, car.stuckTime - dt * 0.75)
  }
}

export function respawnCar(track: Track, car: Car): void {
  let dist: number
  let lat: number
  if (car.nextCheckpoint <= 0) {
    dist = car.completedLaps === 0 ? track.length - (16 + car.row * 9) : 18
    lat = car.col === 0 ? -2.1 : 2.1
  } else {
    dist = track.checkpoints[car.nextCheckpoint - 1]!.dist + 7
    lat = clampBias(car.bias)
  }
  const s = sampleAlong(track, dist)
  car.x = s.x + s.rx * lat
  car.z = s.z + s.rz * lat
  car.heading = Math.atan2(s.tz, s.tx)
  car.speed = 13
  car.slip = 0
  car.gear = 1
  car.rpm = 2200
  car.stuckTime = 0
  car.yawRate = 0
  car.aiSteer = 0
  car.segHint = 0
  car.drifting = false
}

export function progressMeters(track: Track, car: Car): number {
  const proj = project(track, car.x, car.z, car.segHint)
  let s = proj.dist
  if (car.completedLaps === 0 && car.nextCheckpoint === 0 && s > track.length * 0.5) {
    s -= track.length
  }
  return car.completedLaps * track.length + s
}

export function standings(race: Race): Standing[] {
  const rows = race.cars.map((car) => ({
    car,
    progress: car.finished ? car.completedLaps * race.track.length + 2 : progressMeters(race.track, car),
  }))
  rows.sort((a, b) => {
    if (a.car.finished && b.car.finished) return (a.car.finishTime ?? 0) - (b.car.finishTime ?? 0)
    if (a.car.finished) return -1
    if (b.car.finished) return 1
    return b.progress - a.progress
  })
  return rows.map((row, i) => ({
    car: row.car,
    position: i + 1,
    progress: row.progress,
    gapMeters: i === 0 ? 0 : Math.max(0, rows[i - 1]!.progress - row.progress),
  }))
}

export function crossedGate(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  gate: Track['finish'],
  forward: boolean,
): boolean {
  const prevL = (x0 - gate.x) * gate.tx + (z0 - gate.z) * gate.tz
  const currL = (x1 - gate.x) * gate.tx + (z1 - gate.z) * gate.tz
  const ok = forward ? prevL < -0.02 && currL >= -0.02 : prevL > 0.02 && currL <= 0.02
  if (!ok) return false
  const denom = prevL - currL
  const t = Math.abs(denom) < 1e-6 ? 0 : prevL / denom
  const cx = x0 + (x1 - x0) * t
  const cz = z0 + (z1 - z0) * t
  const lat = (cx - gate.x) * gate.rx + (cz - gate.z) * gate.rz
  return Math.abs(lat) <= gate.halfSpan
}

function inputFor(race: Race, car: Car, playerInput: DriveInput, dt: number): DriveInput {
  if (car.finished) return coastInput(race.track, car)
  if (car.isPlayer) return playerInput
  return aiDrive(race.track, car, race.cars, dt)
}

function coastInput(track: Track, car: Car): DriveInput {
  const proj = project(track, car.x, car.z, car.segHint)
  const targetLat = 4.3
  const steer = clampBias((targetLat - proj.lat) * 0.45)
  const brake = car.speed > 16 ? 0.55 : car.speed > 6 ? 0.22 : 0
  const throttle = car.speed < 5 ? 0.25 : 0
  return { throttle, brake, steer, handbrake: false }
}

function updateGates(race: Race, car: Car, x0: number, z0: number): void {
  if (car.finished) return
  const gates = race.track.checkpoints
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i]!
    if (crossedGate(x0, z0, car.x, car.z, gate, true)) {
      if (i === car.nextCheckpoint) car.nextCheckpoint += 1
    } else if (crossedGate(x0, z0, car.x, car.z, gate, false)) {
      if (i === car.nextCheckpoint - 1) car.nextCheckpoint = i
    }
  }
  if (!crossedGate(x0, z0, car.x, car.z, race.track.finish, true)) return
  if (car.nextCheckpoint < gates.length) return
  const lapTime = race.clock - car.lapStart
  const minLap = race.track.length / 100
  if (lapTime < minLap) return
  car.completedLaps += 1
  car.lapTimes.push(lapTime)
  if (car.bestLap === null || lapTime < car.bestLap) car.bestLap = lapTime
  car.lapStart = race.clock
  car.nextCheckpoint = 0
  if (car.completedLaps >= RACE_LAPS) {
    car.finished = true
    car.finishTime = race.clock
  }
}

function makeCar(track: Track, driver: DriverDef): Car {
  const car: Car = {
    key: driver.key,
    name: driver.name,
    color: driver.color,
    accent: driver.accent,
    number: driver.number,
    isPlayer: driver.isPlayer,
    skill: driver.skill,
    bias: driver.bias,
    row: driver.row,
    col: driver.col,
    x: 0,
    z: 0,
    heading: 0,
    speed: 0,
    slip: 0,
    gear: 0,
    rpm: 950,
    yawRate: 0,
    accel: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    drifting: false,
    wheelSpin: 0,
    segHint: 0,
    aiSteer: 0,
    lat: 0,
    roadY: 0,
    bank: 0,
    grade: 0,
    slipAngle: 0,
    latAccel: 0,
    wrongWay: false,
    completedLaps: 0,
    nextCheckpoint: 0,
    finished: false,
    finishTime: null,
    lapStart: 0,
    bestLap: null,
    lapTimes: [],
    stuckTime: 0,
    wallHits: 0,
    respawns: 0,
    impact: 0,
  }
  placeOnGrid(track, car, driver)
  return car
}

function placeOnGrid(track: Track, car: Car, driver: DriverDef): void {
  const back = 16 + driver.row * 9
  const dist = track.length - back
  const lat = driver.col === 0 ? -2.15 : 2.15
  const s = sampleAlong(track, dist)
  car.x = s.x + s.rx * lat
  car.z = s.z + s.rz * lat
  car.heading = Math.atan2(s.tz, s.tx)
  car.speed = 0
  car.slip = 0
  car.gear = 0
  car.rpm = 950
  car.yawRate = 0
  car.accel = 0
  car.steer = 0
  car.throttle = 0
  car.brake = 0
  car.handbrake = false
  car.drifting = false
  car.wheelSpin = 0
  car.segHint = 0
  car.aiSteer = 0
  car.lat = lat
  car.roadY = s.y + lat * Math.sin(s.bank)
  car.bank = s.bank
  car.grade = s.grade
  car.slipAngle = 0
  car.latAccel = 0
  car.wrongWay = false
  car.stuckTime = 0
  car.impact = 0
}

function clearRaceProgress(car: Car): void {
  car.completedLaps = 0
  car.nextCheckpoint = 0
  car.finished = false
  car.finishTime = null
  car.lapStart = 0
  car.bestLap = null
  car.lapTimes = []
  car.wallHits = 0
  car.respawns = 0
}

function clampBias(v: number): number {
  return Math.max(-1, Math.min(1, v))
}
