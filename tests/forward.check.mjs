import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8742
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

async function state(page) {
  return page.evaluate(() => window.__game)
}

async function ready(page, touch) {
  if (LIVE) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await page.waitForFunction(() => window.__game && window.__game.build === 'visual-v8', null, { timeout: 30000 })
        await page.waitForTimeout(2500)
        const build = await page.evaluate(() => window.__game && window.__game.build)
        if (build === 'visual-v8') break
      } catch {
        /* le service worker recharge la page une fois */
      }
    }
    await page.waitForFunction(() => window.__game && window.__game.build === 'visual-v8', null, { timeout: 30000 })
    await page.evaluate(() => window.__game.skipToRace())
  } else {
    await page.waitForFunction(() => window.__circuit && window.__game, null, { timeout: 90000 })
    await page.evaluate(() => window.__circuit.skipToRace())
  }
  if (touch) await page.locator('[data-joystick]').waitFor({ state: 'visible', timeout: 10000 })
  else await page.waitForTimeout(200)
}

function along(from, to) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  return dx * from.forward.x + dz * from.forward.z
}

async function holdUntilForward(page, label) {
  const start = await state(page)
  assert(start && start.forward, `${label}: état __game absent`)
  if (start.nose) {
    const nx = start.nose.x - start.x
    const nz = start.nose.z - start.z
    const facing = nx * start.forward.x + nz * start.forward.z
    assert(facing > 0.4, `${label}: le nez ne regarde pas vers l'avant (${facing.toFixed(2)})`)
  }
  await page.waitForFunction(
    (origin) => {
      const now = window.__game
      if (!now) return false
      const dx = now.x - origin.x
      const dz = now.z - origin.z
      const dot = dx * origin.forward.x + dz * origin.forward.z
      return now.speed > 4 && dot > 6
    },
    start,
    { timeout: 20000 },
  )
  const end = await state(page)
  const dot = along(start, end)
  assert(end.speed > 4, `${label}: vitesse ${end.speed.toFixed(1)}`)
  assert(dot > 6, `${label}: déplacement à l'envers ou nul (${dot.toFixed(2)} m)`)
  assert(end.throttle > 0.4, `${label}: le gaz n'est pas enfoncé`)
  return { start, end, dot }
}

async function exerciseTouch(page, label, mode) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await ready(page, true)
  if (SHOTS && mode === 'gaz') await page.screenshot({ path: `/opt/cursor/artifacts/gaz_t0_${label.replace(/\s/g, '_')}.png` })
  const client = await page.context().newCDPSession(page)
  if (mode === 'gaz') {
    const gas = await page.locator('[data-ctl="throttle"]').boundingBox()
    assert(gas, `${label}: bouton Gaz invisible`)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: gas.x + gas.width / 2, y: gas.y + gas.height / 2, id: 1 }],
    })
  } else {
    const joy = await page.locator('[data-joystick]').boundingBox()
    assert(joy, `${label}: joystick invisible`)
    const cx = joy.x + joy.width / 2
    const cy = joy.y + joy.height / 2
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy - 48, id: 1 }],
    })
  }
  const result = await holdUntilForward(page, `${label} ${mode}`)
  if (SHOTS && mode === 'gaz') await page.screenshot({ path: `/opt/cursor/artifacts/gaz_t2_${label.replace(/\s/g, '_')}.png` })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  console.log(`${label} ${mode}: +${result.dot.toFixed(1)} m, ${result.end.speed.toFixed(0)} m/s`)
}

async function exerciseKeys(page) {
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.addInitScript(() => localStorage.setItem('circuit-atlantique-quality', 'bas'))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await ready(page, false)
  await page.locator('#view').click({ force: true })
  await page.keyboard.down('ArrowUp')
  const result = await holdUntilForward(page, 'bureau ArrowUp')
  await page.keyboard.up('ArrowUp')
  console.log(`bureau ArrowUp: +${result.dot.toFixed(1)} m, ${result.end.speed.toFixed(0)} m/s`)
  await page.keyboard.down('ArrowDown')
  await page.waitForTimeout(400)
  await page.keyboard.up('ArrowDown')
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
  const phones = process.env.ONLY === 'desk' ? [] : ['iPhone 14', 'Pixel 7']
  for (const name of phones) {
    const device = devices[name]
    assert(device, name)
    const context = await browser.newContext({ ...device, hasTouch: true })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    await exerciseTouch(page, name, 'gaz')
    await exerciseTouch(page, name, 'stick')
    assert(errors.length === 0, `${name}: ${errors.join(' | ')}`)
    await context.close()
  }
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await desk.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await exerciseKeys(page)
  assert(errors.length === 0, `bureau: ${errors.join(' | ')}`)
  await desk.close()
} finally {
  await browser?.close()
  server?.child.kill('SIGTERM')
}

console.log(LIVE ? 'forward live ok' : 'forward check ok')
