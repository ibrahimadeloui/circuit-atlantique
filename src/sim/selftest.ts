import { aiDrive } from './ai.ts'
import { buildTrack, project, sampleAlong } from './track.ts'
import { createRace, crossedGate, progressMeters, RACE_LAPS, respawnCar, stepRace, type Race } from './race.ts'
import type { DriveInput } from './vehicle.ts'

function fail(message: string): never {
  throw new Error(message)
}

function assert(cond: boolean, message: string): void {
  if (!cond) fail(message)
}

function finiteCar(race: Race): void {
  for (const car of race.cars) {
    for (const value of [car.x, car.z, car.heading, car.speed, car.slip, car.rpm]) {
      if (!Number.isFinite(value)) fail(`Valeur non finie pour ${car.name}`)
    }
  }
}

const track = buildTrack()
console.log(
  `Circuit ${track.length.toFixed(1)} m, ${track.samples.length} échantillons, ` +
    `${track.checkpoints.length} points de contrôle, mur à ${track.wall.toFixed(1)} m`,
)

const straight = track.samples.filter((s) => {
  const d = Math.min(s.dist, track.length - s.dist)
  return d < 40
})
const straightK = Math.max(...straight.map((s) => Math.abs(s.curvature)))
console.log(`Courbure max près du départ : ${straightK.toFixed(5)}`)

{
  const race = createRace(track)
  const player = race.cars[0]!
  const before = progressMeters(track, player)
  for (let i = 0; i < 120; i++) stepRace(race, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60)
  const after = progressMeters(track, player)
  finiteCar(race)
  assert(after > before + 12, `La voiture n'avance pas (${before.toFixed(1)} → ${after.toFixed(1)})`)
  assert(player.speed > 12, `Accélération trop faible (${player.speed.toFixed(1)} m/s)`)
  console.log(`Départ : +${(after - before).toFixed(1)} m en 2 s, ${ (player.speed * 3.6).toFixed(0)} km/h, rapport ${player.gear + 1}`)
}

{
  const race = createRace(track)
  const player = race.cars[0]!
  const s = sampleAlong(track, track.length * 0.25)
  player.x = s.x + s.rx * (track.wall + 6)
  player.z = s.z + s.rz * (track.wall + 6)
  player.heading = Math.atan2(s.rz, s.rx)
  player.speed = 25
  for (let i = 0; i < 40; i++) stepRace(race, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60)
  const proj = project(track, player.x, player.z, player.segHint)
  assert(Math.abs(proj.lat) <= track.wall + 0.25, `Le mur ne retient pas la voiture (lat ${proj.lat.toFixed(2)})`)
  console.log(`Mur : retenu à ${proj.lat.toFixed(2)} m, chocs ${player.wallHits}`)
}

{
  const race = createRace(track)
  const player = race.cars[0]!
  const s = sampleAlong(track, track.length - 6)
  player.x = s.x
  player.z = s.z
  player.heading = Math.atan2(s.tz, s.tx)
  player.speed = 45
  player.nextCheckpoint = 0
  for (let i = 0; i < 20; i++) stepRace(race, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60)
  assert(player.completedLaps === 0, 'Un raccourci a été compté comme un tour')
  console.log('Raccourci refusé')
}

{
  const race = createRace(track)
  const player = race.cars[0]!
  player.nextCheckpoint = track.checkpoints.length
  player.lapStart = -40
  const s = sampleAlong(track, track.length - 5)
  player.x = s.x
  player.z = s.z
  player.heading = Math.atan2(s.tz, s.tx)
  player.speed = 40
  race.clock = 0
  for (let i = 0; i < 20; i++) stepRace(race, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60)
  assert(player.completedLaps === 1, 'Le franchissement légal de la ligne n\'a pas compté le tour')
  assert(player.nextCheckpoint === 0, 'Les points de contrôle ne sont pas réinitialisés')
  console.log(`Tour valide compté en ${player.lapTimes[0]!.toFixed(2)} s de chrono relatif`)
}

{
  const race = createRace(track)
  const player = race.cars[0]!
  const gate = track.checkpoints[0]!
  const back = sampleAlong(track, gate.dist - 4)
  player.x = back.x
  player.z = back.z
  const ahead = sampleAlong(track, gate.dist + 4)
  assert(
    crossedGate(back.x, back.z, ahead.x, ahead.z, gate, true),
    'Le test de franchissement manque un point de contrôle',
  )
}

const race = createRace(track)
race.cars[0]!.skill = 1.08
const dt = 1 / 60
let elapsed = 0
const limit = 320
let topSpeed = 0
while (elapsed < limit && race.cars.some((c) => !c.finished)) {
  const player = race.cars[0]!
  let input: DriveInput
  if (player.finished) input = { throttle: 0, brake: 0.2, steer: 0, handbrake: false }
  else input = aiDrive(track, player, race.cars, dt)
  stepRace(race, input, dt)
  elapsed += dt
  for (const car of race.cars) topSpeed = Math.max(topSpeed, car.speed)
  if (Math.floor(elapsed) !== Math.floor(elapsed - dt) && Math.floor(elapsed) % 20 === 0) {
    const bits = race.cars
      .map((c) => `${c.name}:${c.completedLaps}/${c.nextCheckpoint} ${Math.round(c.speed * 3.6)}`)
      .join('  ')
    console.log(`t=${elapsed.toFixed(0)}s  ${bits}`)
  }
  finiteCar(race)
}

console.log(`Vitesse de pointe simulée : ${(topSpeed * 3.6).toFixed(0)} km/h`)
for (const car of race.cars) {
  const time = car.finishTime === null ? 'DNF' : `${car.finishTime.toFixed(2)} s`
  const best = car.bestLap === null ? '—' : `${car.bestLap.toFixed(2)} s`
  console.log(
    `${car.name.padEnd(6)} tours ${car.completedLaps}/${RACE_LAPS}  total ${time}  meilleur ${best}  ` +
      `murs ${car.wallHits}  replac. ${car.respawns}`,
  )
}

for (const car of race.cars) {
  assert(car.finished, `${car.name} n'a pas terminé les ${RACE_LAPS} tours`)
  assert(car.lapTimes.length === RACE_LAPS, `${car.name} n'a pas ${RACE_LAPS} temps au tour`)
  assert(car.respawns < 8, `${car.name} a été replacé trop souvent (${car.respawns})`)
}

const player = race.cars[0]!
respawnCar(track, player)
assert(Number.isFinite(player.x + player.z), 'Respawn invalide')

console.log('COURSE COMPLÈTE OK')
