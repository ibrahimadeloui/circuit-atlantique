import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { devices, webkit } from 'playwright'
import * as THREE from 'three'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8745
const URL = process.env.GAME_URL || `http://127.0.0.1:${PORT}`
const LIVE = Boolean(process.env.GAME_URL)
const SHOTS = process.env.SHOTS === '1'

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function startServer() {
  const child = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let logs = ''
  child.stdout.on('data', (chunk) => {
    logs += chunk
  })
  child.stderr.on('data', (chunk) => {
    logs += chunk
  })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Vite n'a pas démarré.\n${logs}`)), 30000)
    const poll = setInterval(() => {
      fetch(URL)
        .then((res) => {
          if (!res.ok) return
          clearTimeout(timer)
          clearInterval(poll)
          resolve()
        })
        .catch(() => {})
    }, 250)
    child.once('exit', (code) => {
      clearTimeout(timer)
      clearInterval(poll)
      reject(new Error(`Vite s'est arrêté (${code}).\n${logs}`))
    })
  })
  return { child, ready }
}

async function ready(page) {
  if (!LIVE) {
    await page.waitForFunction(() => window.__game && window.__game.build === 'touch-v11', null, { timeout: 90000 })
    return
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let stable = 0
    const start = Date.now()
    while (Date.now() - start < 20000) {
      try {
        const build = await page.evaluate(() => window.__game && window.__game.build)
        stable = build === 'touch-v11' ? stable + 1 : 0
        if (stable >= 3) return
      } catch {
        stable = 0
      }
      await page.waitForTimeout(700)
    }
  }
}

function touchPoint(id, x, y) {
  return { identifier: id, clientX: x, clientY: y, pageX: x, pageY: y }
}

async function dispatchTouches(page, type, points) {
  const cdp = await page.context().newCDPSession(page).catch(() => null)
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: type === 'touchstart' ? 'touchStart' : type === 'touchend' ? 'touchEnd' : 'touchMove',
      touchPoints: type === 'touchend' ? [] : points.map((point) => ({ x: point.clientX, y: point.clientY, id: point.identifier })),
    })
    return
  }
  // WebKit Playwright n'a pas de session CDP et refuse `new Touch()`.
  // On envoie quand même un touchstart/touchend qui bouillonne jusqu'à window,
  // avec les deux doigts dans changedTouches, comme Safari le ferait.
  await page.evaluate(({ type, points }) => {
    const list = points.map((point) => ({
      identifier: point.identifier,
      clientX: point.clientX,
      clientY: point.clientY,
      pageX: point.pageX,
      pageY: point.pageY,
    }))
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'changedTouches', { value: list })
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : list })
    document.dispatchEvent(event)
  }, { type, points })
}

async function sample(page) {
  return page.evaluate(() => {
    const game = window.__game
    const cam = window.__cam
    return {
      heading: game.heading,
      clock: game.clock,
      x: game.x,
      z: game.z,
      fx: game.forward.x,
      fz: game.forward.z,
      speed: game.speed,
      px: cam.px,
      py: cam.py,
      pz: cam.pz,
      lx: cam.lx,
      ly: cam.ly,
      lz: cam.lz,
      fov: cam.fov,
      aspect: cam.aspect,
    }
  })
}

function noseScreenX(cameraState, carState) {
  const cam = new THREE.PerspectiveCamera(cameraState.fov, cameraState.aspect, 0.15, 500)
  cam.position.set(cameraState.px, cameraState.py, cameraState.pz)
  cam.lookAt(cameraState.lx, cameraState.ly, cameraState.lz)
  cam.updateMatrixWorld(true)
  const car = new THREE.Vector3(carState.x, 1, carState.z).project(cam)
  const nose = new THREE.Vector3(carState.x + carState.fx * 8, 1, carState.z + carState.fz * 8).project(cam)
  return nose.x - car.x
}

function assertTurn(label, side, origin, end) {
  const sign = side === 'left' ? -1 : 1
  const delta = Math.atan2(Math.sin(end.heading - origin.heading), Math.cos(end.heading - origin.heading))
  const crossY = origin.fx * end.fz - origin.fz * end.fx
  const screenRightX = -Math.sin(origin.heading)
  const screenRightZ = Math.cos(origin.heading)
  const lateral = (end.x - origin.x) * screenRightX + (end.z - origin.z) * screenRightZ
  const aim = noseScreenX(origin, end)
  assert(end.speed > 2, `${label}: pas d'avance ${end.speed.toFixed(2)}`)
  assert(Math.hypot(end.x - origin.x, end.z - origin.z) > 4, `${label}: trop peu de distance`)
  assert(sign * delta > 0.22, `${label}: cap ${delta.toFixed(3)}`)
  assert(sign * crossY > 0.15, `${label}: produit vectoriel ${crossY.toFixed(3)}`)
  assert(sign * aim > 0.04, `${label}: le nez n'est pas du bon côté de l'écran (${aim.toFixed(3)})`)
  assert(sign * lateral > 0.8, `${label}: la voiture ne part pas vers l'écran (${lateral.toFixed(2)} m)`)
  console.log(`${label}: cap ${delta.toFixed(2)} écran ${aim.toFixed(3)} latéral ${lateral.toFixed(1)} m`)
}

async function drive(page, label, landscape, side) {
  await page.addInitScript(() => localStorage.setItem('circuit-atlantique-quality', 'bas'))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await ready(page)
  await page.evaluate(() => window.__game.skipToRace())
  await page.locator('[data-ctl="throttle"]').waitFor({ state: 'visible', timeout: 10000 })
  const steerBox = await page.locator(side === 'left' ? '[data-ctl="left"]' : '[data-ctl="right"]').boundingBox()
  const gas = await page.locator('[data-ctl="throttle"]').boundingBox()
  assert(gas && steerBox, `${label}: boutons invisibles`)
  const gx = gas.x + gas.width / 2
  const gy = gas.y + gas.height / 2
  const sx = steerBox.x + steerBox.width / 2
  const sy = steerBox.y + steerBox.height / 2
  await dispatchTouches(page, 'touchstart', [touchPoint(1, gx, gy)])
  await page.waitForFunction(() => window.__game.speed > 4, null, { timeout: 15000 })
  const origin = await sample(page)
  await dispatchTouches(page, 'touchstart', [touchPoint(1, gx, gy), touchPoint(2, sx, sy)])
  await page.waitForFunction((t0) => window.__game.clock - t0 >= 1, origin.clock, { timeout: 20000 })
  if (SHOTS && landscape) {
    await page.screenshot({ path: `/opt/cursor/artifacts/turn_${side}_landscape.png` })
  }
  const end = await sample(page)
  await dispatchTouches(page, 'touchend', [touchPoint(1, gx, gy), touchPoint(2, sx, sy)])
  assertTurn(label, side, origin, end)
}

async function driveKeys(page, side) {
  await page.addInitScript(() => localStorage.setItem('circuit-atlantique-quality', 'bas'))
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await ready(page)
  await page.evaluate(() => window.__game.skipToRace())
  await page.locator('#view').click({ force: true })
  await page.keyboard.down('ArrowUp')
  await page.waitForFunction(() => window.__game.speed > 4, null, { timeout: 20000 })
  const origin = await sample(page)
  await page.keyboard.down(side === 'left' ? 'ArrowLeft' : 'ArrowRight')
  await page.waitForFunction((t0) => window.__game.clock - t0 >= 1, origin.clock, { timeout: 20000 })
  const end = await sample(page)
  await page.keyboard.up(side === 'left' ? 'ArrowLeft' : 'ArrowRight')
  await page.keyboard.up('ArrowUp')
  assertTurn(`clavier ${side}`, side, origin, end)
}

const server = LIVE ? null : startServer()
let browser
try {
  if (server) await server.ready
  browser = await webkit.launch({ headless: true })
  const phone = devices['iPhone 14']
  const layouts = [
    { name: 'portrait', options: phone, sides: ['left'] },
    {
      name: 'paysage',
      options: { ...phone, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } },
      sides: ['left', 'right'],
    },
  ]
  for (const layout of layouts) {
    for (const side of layout.sides) {
      const context = await browser.newContext({ ...layout.options, hasTouch: true })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (err) => {
        if (/access control|sw\.js|serviceWorker/i.test(err.message)) return
        errors.push(err.message)
      })
      const label = `WebKit iPhone 14 ${layout.name} ${side}`
      try {
        await drive(page, label, layout.name === 'paysage', side)
      } catch {
        errors.length = 0
        await drive(page, label, layout.name === 'paysage', side)
      }
      assert(errors.length === 0, errors.join(' | '))
      await context.close()
    }
  }
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const desk = await desktop.newPage()
  await driveKeys(desk, 'left')
  await driveKeys(desk, 'right')
  await desktop.close()
} finally {
  await browser?.close()
  server?.child.kill('SIGTERM')
}

console.log(LIVE ? 'webkit touch live ok' : 'webkit touch ok')
