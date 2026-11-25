import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8743
const URL = process.env.GAME_URL || `http://127.0.0.1:${PORT}`
const LIVE = Boolean(process.env.GAME_URL)
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome'
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

async function boot(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  if (LIVE) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await page.waitForFunction(() => window.__game && window.__game.build === 'touch-v11', null, { timeout: 30000 })
        await page.waitForTimeout(2000)
        const build = await page.evaluate(() => window.__game && window.__game.build)
        if (build === 'touch-v11') break
      } catch {
        /* rechargement du service worker */
      }
    }
  } else {
    await page.waitForFunction(() => window.__circuit && window.__game, null, { timeout: 90000 })
  }
  await page.evaluate(() => (window.__circuit ? window.__circuit.skipToRace() : window.__game.skipToRace()))
  await page.locator('[data-ctl="throttle"]').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('[data-ctl="left"]').waitFor({ state: 'visible', timeout: 5000 })
}

async function turn(page, label, side, mode) {
  await boot(page)
  const client = await page.context().newCDPSession(page)
  const gas = await page.locator('[data-ctl="throttle"]').boundingBox()
  const joy = await page.locator('[data-joystick]').boundingBox()
  const button = await page.locator(side === 'left' ? '[data-ctl="left"]' : '[data-ctl="right"]').boundingBox()
  assert(gas && joy && button, `${label}: contrôles manquants`)
  const gx = gas.x + gas.width / 2
  const gy = gas.y + gas.height / 2
  const cx = joy.x + joy.width / 2
  const cy = joy.y + joy.height / 2
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: gx, y: gy, id: 1 }],
  })
  await page.waitForFunction(() => window.__game.speed > 6, null, { timeout: 15000 })
  if (SHOTS && side === 'right' && mode === 'button') {
    await page.waitForTimeout(200)
    await page.screenshot({ path: `/opt/cursor/artifacts/drive_straight_${label.replace(/\s/g, '_')}.png` })
  }
  const start = await page.evaluate(() => ({ heading: window.__game.heading, clock: window.__game.clock }))
  const steerPoint = {
    x: mode === 'stick' ? cx + (side === 'left' ? -58 : 58) : button.x + button.width / 2,
    y: mode === 'stick' ? cy : button.y + button.height / 2,
    id: 2,
  }
  if (mode === 'stick') {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: gx, y: gy, id: 1 }, { x: cx, y: cy, id: 2 }],
    })
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: gx, y: gy, id: 1 }, steerPoint],
    })
  } else {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: gx, y: gy, id: 1 }, steerPoint],
    })
  }
  if (SHOTS && side === 'left' && mode === 'button') {
    await page.waitForFunction((origin) => {
      const now = window.__game.heading
      const delta = Math.atan2(Math.sin(now - origin), Math.cos(now - origin))
      return Math.abs(delta) > 0.4
    }, start.heading, { timeout: 20000 })
    await page.waitForTimeout(150)
    await page.screenshot({ path: `/opt/cursor/artifacts/drive_turn_${label.replace(/\s/g, '_')}.png` })
  }
  await page.waitForFunction((t0) => window.__game.clock - t0 >= 1.5, start.clock, { timeout: 20000 })
  const snap = await page.evaluate((origin) => {
    const now = window.__game
    const delta = Math.atan2(Math.sin(now.heading - origin), Math.cos(now.heading - origin))
    const input = window.__circuit ? window.__circuit.input.debug() : null
    return { delta, speed: now.speed, steer: input && input.steer }
  }, start.heading)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const sign = side === 'left' ? -1 : 1
  assert(sign * snap.delta > 0.45, `${label} ${mode} ${side}: cap ${snap.delta.toFixed(3)} ${JSON.stringify(snap)}`)
  console.log(`${label} ${mode} ${side}: ${snap.delta.toFixed(2)} rad`)
}

const server = LIVE ? null : startServer()
let browser
try {
  if (server) await server.ready
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  for (const name of ['iPhone 14', 'Pixel 7']) {
    const device = devices[name]
    assert(device, name)
    const context = await browser.newContext({ ...device, hasTouch: true })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    for (const mode of ['stick', 'button']) {
      for (const side of ['left', 'right']) {
        await turn(page, name, side, mode)
      }
    }
    assert(errors.length === 0, `${name}: ${errors.join(' | ')}`)
    await context.close()
  }
} finally {
  await browser?.close()
  server?.child.kill('SIGTERM')
}

console.log(LIVE ? 'steer live ok' : 'steer check ok')
