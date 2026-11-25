import type { DriveInput } from './sim/vehicle.ts'

export type EdgeInput = {
  camera: boolean
  respawn: boolean
  pause: boolean
  start: boolean
  mute: boolean
}

export type Input = {
  read: (dt?: number) => DriveInput
  consume: () => EdgeInput
  debug: () => {
    throttle: number
    brake: number
    steer: number
    nitro: boolean
    handbrake: boolean
    maxSteerStep: number
    joy: { x: number; y: number }
  }
}

export function createInput(root: HTMLElement): Input {
  const keys = new Set<string>()
  const edges = { camera: false, respawn: false, pause: false, start: false, mute: false }
  const pointers = new Map<number, { kind: string; x: number; y: number; cx: number; cy: number; max: number; button: HTMLElement | null }>()
  let aimX = 0
  let aimY = 0
  let joyX = 0
  let joyY = 0
  let visX = 0
  let visY = 0
  let throttle = 0
  let brake = 0
  let steer = 0
  let maxSteerStep = 0

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
  window.addEventListener('blur', () => {
    keys.clear()
    pointers.clear()
    aimX = 0
    aimY = 0
  })

  const joystick = () => root.querySelector<HTMLElement>('[data-joystick]')
  const nub = () => root.querySelector<HTMLElement>('[data-nub]')

  const heldKind = (kind: string) => {
    for (const pointer of pointers.values()) if (pointer.kind === kind) return true
    return false
  }

  const buzz = (ms: number) => {
    navigator.vibrate?.(ms)
  }

  const ease = (current: number, target: number, lambda: number, dt: number) =>
    current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)))

  const centerOf = () => {
    const el = joystick()
    if (!el) return { cx: 0, cy: 0, max: 46 }
    const rect = el.getBoundingClientRect()
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, max: rect.width * 0.42 }
  }

  const updateJoy = (pointer: { x: number; y: number; cx: number; cy: number; max: number }) => {
    const dx = pointer.x - pointer.cx
    const dy = pointer.y - pointer.cy
    const max = pointer.max || 46
    const mag = Math.hypot(dx, dy)
    const clamped = Math.min(mag, max)
    const nx = mag > 0 ? (dx / mag) * (clamped / max) : 0
    const ny = mag > 0 ? -((dy / mag) * (clamped / max)) : 0
    const strength = Math.hypot(nx, ny)
    const dead = 0.08
    if (strength < dead) {
      aimX = 0
      aimY = 0
    } else {
      const t = (strength - dead) / (1 - dead)
    const curved = t * (0.55 + 0.45 * t)
      aimX = (nx / strength) * curved
      aimY = (ny / strength) * curved
    }
    visX = nx * max
    visY = -ny * max
    const knob = nub()
    if (knob) knob.style.transform = `translate(${visX.toFixed(1)}px, ${visY.toFixed(1)}px)`
    joystick()?.classList.add('active')
  }

  const kindOf = (target: EventTarget | null) => {
    const el = target as HTMLElement | null
    if (!el?.closest) return null
    if (el.closest('[data-joystick]')) return 'joy'
    return el.closest<HTMLElement>('[data-ctl]')?.dataset.ctl ?? null
  }

  const kindAt = (target: EventTarget | null, x: number, y: number) =>
    kindOf(target) ?? kindOf(document.elementFromPoint(x, y))

  const buttonAt = (target: EventTarget | null, x: number, y: number) => {
    const fromTarget = (target as HTMLElement | null)?.closest?.('button') ?? null
    if (fromTarget) return fromTarget
    return (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.('button') ?? null
  }

  const resetJoy = () => {
    aimX = 0
    aimY = 0
    visX = 0
    visY = 0
    const knob = nub()
    if (knob) knob.style.transform = 'translate(0px, 0px)'
    joystick()?.classList.remove('active')
  }

  const release = (id: number) => {
    const pointer = pointers.get(id)
    if (!pointer) return
    pointers.delete(id)
    pointer.button?.classList.remove('pressed')
    if (pointer.kind === 'joy' && ![...pointers.values()].some((item) => item.kind === 'joy')) resetJoy()
  }

  const begin = (id: number, target: EventTarget | null, x: number, y: number) => {
    const kind = kindAt(target, x, y)
    if (!kind) return false
    if (kind === 'camera') {
      edges.camera = true
      buzz(8)
      return true
    }
    const button = kind === 'joy' ? null : buttonAt(target, x, y)
    button?.classList.add('pressed')
    if (button) buzz(10)
    const origin = kind === 'joy' ? centerOf() : { cx: x, cy: y, max: 46 }
    const record = { kind, x, y, cx: origin.cx, cy: origin.cy, max: origin.max, button }
    pointers.set(id, record)
    if (kind === 'joy') updateJoy(record)
    return true
  }

  const moveJoy = (id: number, x: number, y: number) => {
    const pointer = pointers.get(id)
    if (!pointer || pointer.kind !== 'joy') return false
    pointer.x = x
    pointer.y = y
    updateJoy(pointer)
    return true
  }

  const moveAnyJoy = (x: number, y: number) => {
    const joys = [...pointers.entries()].filter(([, pointer]) => pointer.kind === 'joy')
    const hit = joys.length === 1 ? joys[0] : undefined
    if (!hit) return
    moveJoy(hit[0], x, y)
  }

  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') return
    if (!begin(event.pointerId, event.target, event.clientX, event.clientY)) return
    event.preventDefault()
  }, { passive: false })
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return
    if (!pointers.has(event.pointerId)) return
    event.preventDefault()
    moveJoy(event.pointerId, event.clientX, event.clientY)
  }, { passive: false })
  const endPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    release(event.pointerId)
  }
  window.addEventListener('pointerup', endPointer)
  window.addEventListener('pointercancel', endPointer)

  window.addEventListener('touchstart', (event) => {
    let used = false
    for (const touch of Array.from(event.changedTouches)) {
      if (begin(touch.identifier, touch.target, touch.clientX, touch.clientY)) used = true
    }
    if (used) event.preventDefault()
  }, { passive: false })
  window.addEventListener('touchmove', (event) => {
    let used = false
    for (const touch of Array.from(event.changedTouches)) {
      if (pointers.has(touch.identifier)) {
        const pointer = pointers.get(touch.identifier)!
        pointer.x = touch.clientX
        pointer.y = touch.clientY
        if (pointer.kind === 'joy') updateJoy(pointer)
        used = true
      } else {
        const before = aimX
        moveAnyJoy(touch.clientX, touch.clientY)
        if (aimX !== before) used = true
      }
    }
    if (used || pointers.size > 0) event.preventDefault()
  }, { passive: false })
  const endTouch = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) release(touch.identifier)
  }
  window.addEventListener('touchend', endTouch)
  window.addEventListener('touchcancel', endTouch)
  window.addEventListener('contextmenu', (event) => event.preventDefault())
  window.addEventListener('selectstart', (event) => event.preventDefault())
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    window.addEventListener(name, (event) => event.preventDefault())
  }
  root.querySelectorAll<HTMLElement>('button, [data-joystick]').forEach((el) => {
    el.setAttribute('draggable', 'false')
  })

  return {
    read: (dt = 1 / 60) => {
      const step = Math.min(0.05, Math.max(0, dt))
      joyX = ease(joyX, aimX, 12, step)
      joyY = ease(joyY, aimY, 12, step)
      // Écran : haut = clientY plus petit. updateJoy inverse ce Y, donc joyY > 0 = stick vers le haut = avancer.
      const gas = keys.has('arrowup') || keys.has('w') || keys.has('z') || heldKind('throttle') || joyY > 0.12
      const stop = keys.has('arrowdown') || keys.has('s') || heldKind('brake') || joyY < -0.12
      const gasTarget = gas ? (heldKind('throttle') || keys.has('arrowup') || keys.has('w') || keys.has('z') ? 1 : Math.max(0.35, joyY)) : 0
      const brakeTarget = stop ? (heldKind('brake') || keys.has('arrowdown') || keys.has('s') ? 1 : Math.max(0.35, -joyY)) : 0
      throttle = ease(throttle, brakeTarget > gasTarget ? 0 : gasTarget, 9, step)
      brake = ease(brake, brakeTarget > gasTarget ? brakeTarget : stop && !gas ? brakeTarget : 0, 11, step)
      if (throttle < 0.02) throttle = 0
      if (brake < 0.02) brake = 0
      let target = 0
      if (keys.has('arrowleft') || keys.has('q') || keys.has('a') || heldKind('left')) target -= 1
      if (keys.has('arrowright') || keys.has('d') || heldKind('right')) target += 1
      target += joyX
      target = Math.max(-1, Math.min(1, target))
      const maxDelta = Math.min(0.16, 10 * step)
      const next = steer + Math.max(-maxDelta, Math.min(maxDelta, target - steer))
      maxSteerStep = Math.max(maxSteerStep, Math.abs(next - steer))
      steer = Math.abs(next) < 0.01 && target === 0 ? 0 : next
      const handbrake = keys.has(' ') || heldKind('handbrake')
      const nitro = keys.has('shift') || heldKind('nitro')
      root.querySelectorAll<HTMLElement>('[data-ctl]').forEach((el) => {
        const name = el.dataset.ctl
        if (!name || name === 'camera') return
        el.classList.toggle('pressed', heldKind(name))
      })
      return { throttle, brake, steer, handbrake, nitro }
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
    debug: () => ({
      throttle,
      brake,
      steer,
      nitro: keys.has('shift') || heldKind('nitro'),
      handbrake: keys.has(' ') || heldKind('handbrake'),
      maxSteerStep,
      joy: { x: visX, y: visY },
      pressed: [...keys],
    }),
  }
}
