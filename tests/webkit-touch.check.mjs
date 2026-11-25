import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { devices, webkit } from 'playwright'

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
    await page.waitForFunction(() => window.__game && window.__game.build === 'touch-v9', null, { timeout: 90000 })
    return
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await page.waitForFunction(() => window.__game && window.__game.build === 'touch-v9', null, { timeout: 30000 })
      await page.waitForTimeout(1500)
      if ((await page.evaluate(() => window.__game && window.__game.build)) === 'touch-v9') return
    } catch {
      /* rechargement du service worker */
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

async function drive(page, label, landscape) {
  await page.addInitScript(() => localStorage.setItem('circuit-atlantique-quality', 'bas'))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await ready(page)
  await page.evaluate(() => window.__game.skipToRace())
  await page.locator('[data-ctl="throttle"]').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('[data-ctl="left"]').waitFor({ state: 'visible', timeout: 5000 })
  const gas = await page.locator('[data-ctl="throttle"]').boundingBox()
  const left = await page.locator('[data-ctl="left"]').boundingBox()
  assert(gas && left, `${label}: boutons invisibles`)
  const speedo = await page.locator('.speedo').boundingBox()
  const view = page.viewportSize()
  if (speedo && view) {
    const centerTop = view.height * 0.45
    assert(speedo.y + speedo.height < centerTop, `${label}: le compteur couvre la voiture (${Math.round(speedo.y + speedo.height)}px)`)
  }
  if (SHOTS && landscape) await page.screenshot({ path: '/opt/cursor/artifacts/hud_landscape_iphone.png' })
  const gx = gas.x + gas.width / 2
  const gy = gas.y + gas.height / 2
  await dispatchTouches(page, 'touchstart', [touchPoint(1, gx, gy)])
  await page.waitForFunction(() => window.__game.speed > 4, null, { timeout: 15000 })
  if (SHOTS && landscape) await page.screenshot({ path: '/opt/cursor/artifacts/drive_straight_landscape.png' })
  const origin = await page.evaluate(() => ({ heading: window.__game.heading, clock: window.__game.clock, x: window.__game.x, z: window.__game.z }))
  await dispatchTouches(page, 'touchstart', [
    touchPoint(1, gx, gy),
    touchPoint(2, left.x + left.width / 2, left.y + left.height / 2),
  ])
  await page.waitForFunction((t0) => window.__game.clock - t0 >= 1.2, origin.clock, { timeout: 20000 })
  const end = await page.evaluate((start) => {
    const now = window.__game
    const delta = Math.atan2(Math.sin(now.heading - start.heading), Math.cos(now.heading - start.heading))
    const moved = Math.hypot(now.x - start.x, now.z - start.z)
    const input = window.__circuit ? window.__circuit.input.debug() : null
    return { delta, moved, speed: now.speed, steer: input && input.steer, throttle: input && input.throttle }
  }, origin)
  if (SHOTS && landscape) await page.screenshot({ path: '/opt/cursor/artifacts/drive_turn_landscape.png' })
  await dispatchTouches(page, 'touchend', [touchPoint(1, gx, gy), touchPoint(2, left.x + left.width / 2, left.y + left.height / 2)])
  assert(end.speed > 2, `${label}: la voiture n'avance pas (${end.speed.toFixed(2)} m/s) ${JSON.stringify(end)}`)
  assert(end.moved > 4, `${label}: déplacement trop faible (${end.moved.toFixed(2)} m)`)
  assert(end.delta > 0.28, `${label}: pas de virage à gauche (${end.delta.toFixed(3)} rad) ${JSON.stringify(end)}`)
  console.log(`${label}: +${end.moved.toFixed(1)} m, cap ${end.delta.toFixed(2)} rad`)
}

const server = LIVE ? null : startServer()
let browser
try {
  if (server) await server.ready
  browser = await webkit.launch({ headless: true })
  const phone = devices['iPhone 14']
  const layouts = [
    { name: 'portrait', options: phone },
    {
      name: 'paysage',
      options: { ...phone, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } },
    },
  ]
  for (const layout of layouts) {
    const context = await browser.newContext({ ...layout.options, hasTouch: true })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    await drive(page, `WebKit iPhone 14 ${layout.name}`, layout.name === 'paysage')
    assert(errors.length === 0, errors.join(' | '))
    await context.close()
  }
} finally {
  await browser?.close()
  server?.child.kill('SIGTERM')
}

console.log(LIVE ? 'webkit touch live ok' : 'webkit touch ok')
