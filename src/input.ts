import type { DriveInput } from './sim/vehicle.ts'

export type EdgeInput = {
  camera: boolean
  respawn: boolean
  pause: boolean
  start: boolean
  mute: boolean
}

export type Input = {
  read: () => DriveInput
  consume: () => EdgeInput
}

export function createInput(root: HTMLElement): Input {
  const keys = new Set<string>()
  const edges = { camera: false, respawn: false, pause: false, start: false, mute: false }
  const stick = { id: -1, dx: 0 }
  const holds = new Map<number, string>()

  const down = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault()
    keys.add(key)
    if (event.repeat) return
    if (key === 'c') edges.camera = true
    if (key === 'r') edges.respawn = true
    if (key === 'escape') edges.pause = true
    if (key === 'enter') edges.start = true
    if (key === 'm') edges.mute = true
  }
  const up = (event: KeyboardEvent) => {
    keys.delete(event.key.toLowerCase())
  }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', () => keys.clear())

  const layer = root.querySelector<HTMLElement>('[data-touch]')
  const nub = root.querySelector<HTMLElement>('[data-nub]')

  const pointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null
    const ctl = target?.closest<HTMLElement>('[data-ctl]')?.dataset.ctl
    if (!ctl) return
    event.preventDefault()
    if (ctl === 'camera') {
      edges.camera = true
      return
    }
    if (ctl === 'steer') {
      stick.id = event.pointerId
      stick.dx = 0
    } else {
      holds.set(event.pointerId, ctl)
    }
    target?.setPointerCapture?.(event.pointerId)
  }
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== stick.id) return
    const origin = root.querySelector<HTMLElement>('[data-ctl="steer"]')
    if (!origin) return
    const rect = origin.getBoundingClientRect()
    stick.dx = event.clientX - (rect.left + rect.width / 2)
    if (nub) nub.style.transform = `translate(${Math.max(-42, Math.min(42, stick.dx))}px, 0)`
  }
  const pointerUp = (event: PointerEvent) => {
    holds.delete(event.pointerId)
    if (event.pointerId === stick.id) {
      stick.id = -1
      stick.dx = 0
      if (nub) nub.style.transform = 'translate(0, 0)'
    }
  }
  layer?.addEventListener('pointerdown', pointerDown)
  window.addEventListener('pointermove', pointerMove)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', pointerUp)

  const held = (name: string) => {
    for (const value of holds.values()) if (value === name) return true
    return false
  }

  return {
    read: () => {
      const throttle = keys.has('arrowup') || keys.has('w') || keys.has('z') || held('throttle') ? 1 : 0
      const brake = keys.has('arrowdown') || keys.has('s') || held('brake') ? 1 : 0
      let steer = 0
      if (keys.has('arrowleft') || keys.has('q') || keys.has('a')) steer -= 1
      if (keys.has('arrowright') || keys.has('d')) steer += 1
      steer += Math.max(-1, Math.min(1, stick.dx / 46))
      steer = Math.max(-1, Math.min(1, steer))
      const handbrake = keys.has(' ') || held('handbrake')
      return { throttle, brake, steer, handbrake }
    },
    consume: () => {
      const snapshot = { ...edges }
      edges.camera = false
      edges.respawn = false
      edges.pause = false
      edges.start = false
      edges.mute = false
      return snapshot
    },
  }
}
