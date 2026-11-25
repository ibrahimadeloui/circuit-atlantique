import '@fontsource/orbitron/700.css'
import '@fontsource/oswald/600.css'
import '@fontsource/oswald/700.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import './style.css'
import { RaceAudio } from './audio.ts'
import { createInput } from './input.ts'
import { createWorld, type Phase, type Quality, type ViewState } from './render/world.ts'
import { aiDrive } from './sim/ai.ts'
import { RACE_LAPS, createRace, resetRace, respawnCar, standings, stepRace } from './sim/race.ts'
import { buildTrack } from './sim/track.ts'
import { revInPlace, type DriveInput } from './sim/vehicle.ts'
import { setupPwa } from './pwa.ts'
import { formatTime, mountUi, type HudModel } from './ui.ts'

const BEST_KEY = 'circuit-atlantique-best'

function loadBest(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function loadQuality(): Quality {
  try {
    const raw = localStorage.getItem('circuit-atlantique-quality')
    if (raw === 'bas' || raw === 'moyen' || raw === 'eleve') return raw
  } catch {
    /* ignore */
  }
  return 'moyen'
}

function saveBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value))
  } catch {
    /* stockage indisponible */
  }
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const uiRoot = document.querySelector<HTMLElement>('#ui')

if (!canvas || !uiRoot) {
  throw new Error('Structure de page incomplète')
}

uiRoot.innerHTML = '<p class="loading">Préparation du circuit…</p>'

const track = buildTrack()
const race = createRace(track)
const audio = new RaceAudio()

let phase: Phase = 'menu'
let showHelp = false
let cameraMode: 'chase' | 'hood' = 'chase'
let menuDist = 0
let countdown = 0
let goBanner = 0
let flash = ''
let flashTime = 0
let record = loadBest()
let quality: Quality = loadQuality()
let pixelRatio = ratioFor(quality)
let slowFrames = 0
let fastFrames = 0

function startCountdown(): void {
  resetRace(race)
  phase = 'countdown'
  showHelp = false
  countdown = 0
  goBanner = 0
  flash = ''
  flashTime = 0
  cameraMode = 'chase'
  try {
    audio.start()
  } catch (error) {
    console.error(error)
  }
}

const ui = mountUi(uiRoot, {
  onPlay: () => startCountdown(),
  onHelp: () => {
    showHelp = true
  },
  onCloseHelp: () => {
    showHelp = false
  },
  onResume: () => {
    if (phase === 'paused') phase = 'racing'
  },
  onRestart: () => startCountdown(),
  onMenu: () => {
    phase = 'menu'
    showHelp = false
    resetRace(race)
  },
  onMute: () => {
    audio.start()
    audio.setMuted(!audio.muted)
  },
  onQuality: (next) => {
    quality = next
    pixelRatio = ratioFor(next)
    world.setQuality(next)
    resize()
    try {
      localStorage.setItem('circuit-atlantique-quality', next)
    } catch {
      /* ignore */
    }
  },
})

ui.setTrack(track.samples.filter((_, index) => index % 2 === 0).map((sample) => ({ x: sample.x, z: sample.z })))
menuDist = track.length - 150
const input = createInput(uiRoot)

const world = await createWorld(canvas, race)
if (import.meta.env.DEV) {
  Object.assign(globalThis, {
    __circuit: {
      input,
      race,
      skipToRace() {
        phase = 'racing'
        race.clock = 0
      },
      heading: () => race.cars[0]!.heading,
      speed: () => race.cars[0]!.speed * 3.6,
      resetSteerStep() {
        input.debug()
      },
    },
  })
}
world.setQuality(quality)

function resize(): void {
  world.setSize(window.innerWidth, window.innerHeight, pixelRatio)
}

window.addEventListener('resize', resize)
resize()

document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'racing') phase = 'paused'
})

if (import.meta.env.DEV) {
  Object.assign(globalThis, {
    __gp: {
      race,
      fastForward(seconds: number) {
        const dt = 1 / 60
        const player = race.cars[0]!
        player.skill = 1.05
        if (phase !== 'racing' && phase !== 'finished') {
          phase = 'racing'
          race.clock = 0
          for (const car of race.cars) car.lapStart = 0
        }
        for (let t = 0; t < seconds; t += dt) {
          const drive: DriveInput = player.finished
            ? { throttle: 0, brake: 0.25, steer: 0, handbrake: false }
            : aiDrive(track, player, race.cars, dt)
          stepRace(race, drive, dt)
          if (race.cars.every((car) => car.finished)) break
        }
        if (player.finished) phase = 'finished'
        if (player.bestLap !== null && (record === null || player.bestLap < record)) {
          record = player.bestLap
          saveBest(record)
        }
      },
      setCamera(mode: 'chase' | 'hood') {
        cameraMode = mode
      },
      drift(seconds = 1.4) {
        const player = race.cars[0]!
        phase = 'racing'
        player.speed = Math.max(player.speed, 26)
        const dt = 1 / 60
        const frames = Math.round(seconds / dt)
        for (let i = 0; i < frames; i++) {
          stepRace(race, { throttle: 0.35, brake: 0, steer: 1, handbrake: true }, dt)
        }
      },
    },
  })
}

let last = performance.now()

let frameCount = 0

function frame(now: number): void {
  frameCount += 1
  try {
    step(now)
  } catch (error) {
    console.error(error)
  }
  requestAnimationFrame(frame)
}

function step(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  const edges = input.consume()
  const drive = input.read(dt)
  if (edges.mute) {
    audio.start()
    audio.setMuted(!audio.muted)
  }
  if (edges.start && phase === 'menu' && !showHelp) startCountdown()
  if (edges.start && phase === 'paused') phase = 'racing'
  if (edges.pause) {
    if (showHelp) showHelp = false
    else if (phase === 'racing') phase = 'paused'
    else if (phase === 'paused') phase = 'racing'
    else if (phase === 'countdown') {
      phase = 'menu'
      resetRace(race)
    }
  }
  if (edges.camera && (phase === 'racing' || phase === 'countdown' || phase === 'paused')) {
    cameraMode = cameraMode === 'chase' ? 'hood' : 'chase'
  }
  if (edges.respawn && phase === 'racing') respawnCar(track, race.cars[0]!)

  if (phase === 'menu') {
    menuDist = (menuDist + dt * 42) % track.length
    audio.update(980, 0, 0, false)
  } else if (phase === 'countdown') {
    const prev = countdown
    countdown += dt
    revInPlace(race.cars[0]!, drive.throttle, dt)
    const cues = [0, 0.85, 1.7, 2.55]
    for (let i = 0; i < cues.length; i++) {
      const mark = cues[i]!
      if (prev < mark && countdown >= mark) audio.beep(i === 3 ? 1240 : 640, i === 3 ? 0.2 : 0.11, 0.07)
    }
    if (prev < 2.55 && countdown >= 2.55) {
      phase = 'racing'
      goBanner = 0.9
      race.clock = 0
      for (const car of race.cars) car.lapStart = 0
    }
    audio.update(race.cars[0]!.rpm, drive.throttle, 0, false, 0, 0)
  } else if (phase === 'racing') {
    const player = race.cars[0]!
    const lapsBefore = player.completedLaps
    const bestBefore = player.bestLap
    stepRace(race, drive, dt)
    if (player.completedLaps > lapsBefore && !player.finished) {
      flash = `Tour ${player.completedLaps + 1} / ${RACE_LAPS}`
      flashTime = 1.45
    }
    if (player.bestLap !== null && player.bestLap !== bestBefore && (record === null || player.bestLap < record)) {
      record = player.bestLap
      saveBest(record)
      flash = 'Meilleur tour'
      flashTime = 1.6
    }
    if (player.finished) {
      phase = 'finished'
      flash = 'Arrivée'
      flashTime = 1.8
    }
    audio.update(player.rpm, player.throttle, player.slipAngle, player.drifting, player.gear, player.impact)
  } else if (phase === 'paused') {
    audio.update(980, 0, 0, false)
  } else if (phase === 'finished') {
    const player = race.cars[0]!
    const limit = (player.finishTime ?? race.clock) + 18
    if (race.cars.some((car) => !car.finished) && race.clock < limit) {
      stepRace(race, { throttle: 0, brake: 0, steer: 0, handbrake: false }, dt)
    }
    audio.update(Math.max(900, player.rpm * 0.4), 0, 0, false)
  }

  if (goBanner > 0) goBanner = Math.max(0, goBanner - dt)
  flashTime = Math.max(0, flashTime - dt)

  world.update(race, view(), dt)
  publishGameState()
  ui.setModel(model())
  adaptQuality(dt)
}

const BUILD = 'touch-v10'

function publishGameState(): void {
  const player = race.cars[0]!
  const fx = Math.cos(player.heading)
  const fz = Math.sin(player.heading)
  const nose = (globalThis as { __nose?: { x: number; z: number } }).__nose
  const hook = globalThis as {
    __game?: {
      build: string
      x: number
      z: number
      speed: number
      heading: number
      throttle: number
      brake: number
      clock: number
      frames: number
      forward: { x: number; z: number }
    nose: { x: number; z: number } | null
    skipToRace: () => void
  }
}
  hook.__game = {
    build: BUILD,
    x: player.x,
    z: player.z,
    speed: player.speed,
    heading: player.heading,
    throttle: player.throttle,
    brake: player.brake,
    clock: race.clock,
    frames: frameCount,
    forward: { x: fx, z: fz },
    nose: nose ?? null,
    skipToRace() {
      phase = 'racing'
      race.clock = 0
    },
  }
}

function view(): ViewState {
  return { phase, camera: cameraMode, menuDist, countdown, shake: 0 }
}

function model(): HudModel {
  const player = race.cars[0]!
  const rows = standings(race)
  const place = rows.find((row) => row.car.isPlayer)?.position ?? 1
  let hint: string | null = null
  if (phase === 'racing' && player.stuckTime > 1.15 && Math.abs(player.speed) < 2.4) {
    hint = 'R pour vous replacer sur la piste'
  }
  const lapNumber = player.finished ? player.completedLaps : player.completedLaps + 1
  return {
    phase,
    showHelp,
    countdown: countdownText(),
    speed: player.speed * 3.6,
    gear: gearLabel(),
    rpm: player.rpm,
    position: place,
    lapText: `${Math.min(RACE_LAPS, Math.max(1, lapNumber))} / ${RACE_LAPS}`,
    currentLap: player.finished ? (player.lapTimes.at(-1) ?? 0) : Math.max(0, race.clock - player.lapStart),
    bestLap: player.bestLap ?? record,
    totalTime: player.finished ? (player.finishTime ?? race.clock) : race.clock,
    wrongWay: phase === 'racing' && player.wrongWay,
    hint,
    flash: flashTime > 0 ? flash : null,
    cameraLabel: cameraMode === 'hood' ? 'Capot' : 'Poursuite',
    muted: audio.muted,
    standings: rows.map((row, index) => ({
      name: row.car.name,
      color: cssColor(row.car.color),
      isPlayer: row.car.isPlayer,
      gap: gapText(rows, index),
      x: row.car.x,
      z: row.car.z,
      heading: row.car.heading,
    })),
    results: rows.map((row) => ({
      position: row.position,
      name: row.car.name,
      isPlayer: row.car.isPlayer,
      time: row.car.finished && row.car.finishTime !== null ? formatTime(row.car.finishTime) : 'en piste',
      best: row.car.bestLap === null ? '—' : formatTime(row.car.bestLap),
      detail: '',
    })),
    record,
    quality,
  }
}

function ratioFor(next: Quality): number {
  const mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820
  const device = window.devicePixelRatio || 1
  if (next === 'bas') return 1
  if (mobile) return Math.min(device, 1.5)
  if (next === 'moyen') return Math.min(device, 1.25)
  return Math.min(device, 1.5)
}

function gapText(rows: ReturnType<typeof standings>, index: number): string {
  if (index === 0) return ''
  const row = rows[index]!
  const ahead = rows[index - 1]!
  if (row.car.finished && ahead.car.finished && row.car.finishTime !== null && ahead.car.finishTime !== null) {
    return `+${(row.car.finishTime - ahead.car.finishTime).toFixed(1)} s`
  }
  if (row.gapMeters > track.length * 0.72) return '+1 tour'
  if (row.gapMeters < 1.2) return ''
  const speed = Math.max(24, row.car.speed, ahead.car.speed)
  return `+${(row.gapMeters / speed).toFixed(1)} s`
}

function gearLabel(): string {
  const player = race.cars[0]!
  if (phase === 'countdown' || phase === 'menu') return 'N'
  if (player.speed < -0.5) return 'R'
  if (player.speed < 0.7 && player.throttle < 0.15) return 'N'
  return String(player.gear + 1)
}

function countdownText(): string | null {
  if (phase === 'countdown') {
    if (countdown < 0.85) return '3'
    if (countdown < 1.7) return '2'
    return '1'
  }
  if (goBanner > 0) return 'Partez !'
  return null
}

function adaptQuality(dt: number): void {
  const cap = ratioFor(quality)
  if (dt > 0.022) {
    slowFrames += 1
    fastFrames = 0
  } else if (dt < 0.014) {
    fastFrames += 1
    slowFrames = 0
  }
  if (slowFrames > 45 && pixelRatio > 0.85) {
    pixelRatio = Math.max(0.85, pixelRatio - 0.15)
    slowFrames = 0
    resize()
  } else if (fastFrames > 180 && pixelRatio < cap - 0.05) {
    pixelRatio = Math.min(cap, pixelRatio + 0.1)
    fastFrames = 0
    resize()
  }
}

const playerNote = () => {
  const player = race.cars[0]!
  if (!player.finished) return
  const laps = player.lapTimes.map((time) => formatTime(time)).join(' · ')
  const place = standings(race).find((row) => row.car.isPlayer)?.position ?? 1
  const label = place === 1 ? '1er' : `${place}e`
  const note = uiRoot.querySelector('[data-finish-note]')
  if (note) note.textContent = `Vous finissez ${label}. Tours : ${laps}`
}

const originalSet = ui.setModel
ui.setModel = (data) => {
  originalSet(data)
  if (data.phase === 'finished') playerNote()
}

setupPwa()
requestAnimationFrame(frame)
