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

  const controlOf = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null
    return target?.closest<HTMLElement>('[data-ctl]') ?? null
  }
  const pointerDown = (event: PointerEvent) => {
    const button = controlOf(event)
    const ctl = button?.dataset.ctl
    if (!ctl || !button) return
    event.preventDefault()
    if (ctl === 'camera') {
      edges.camera = true
      return
    }
    holds.set(event.pointerId, ctl)
    try {
      button.setPointerCapture(event.pointerId)
    } catch {
      /* le pointeur n'est pas capturable */
    }
  }
  const pointerUp = (event: PointerEvent) => {
    holds.delete(event.pointerId)
  }
  layer?.addEventListener('pointerdown', pointerDown)
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
      if (keys.has('arrowleft') || keys.has('q') || keys.has('a') || held('left')) steer -= 1
      if (keys.has('arrowright') || keys.has('d') || held('right')) steer += 1
      steer = Math.max(-1, Math.min(1, steer))
      const handbrake = keys.has(' ') || held('handbrake')
      root.querySelectorAll<HTMLElement>('[data-ctl]').forEach((el) => {
        const name = el.dataset.ctl
        if (!name || name === 'camera') return
        el.classList.toggle('pressed', held(name))
      })
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
