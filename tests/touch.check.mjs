import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8741
const URL = `http://127.0.0.1:${PORT}`
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome'

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

async function exercise(page, label) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__circuit && window.__circuit.race, null, { timeout: 90000 })
  await page.evaluate(() => window.__circuit.skipToRace())
  await page.waitForTimeout(400)
  const layout = await page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      if (s.display === 'none' || r.width < 2) return null
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }
    const hit = (a, b) => Boolean(a && b && a.x < b.x + b.w - 2 && a.x + a.w > b.x + 2 && a.y < b.y + b.h - 2 && a.y + a.h > b.y + 2)
    const joy = read('[data-joystick]')
    const gas = read('[data-ctl="throttle"]')
    const brake = read('[data-ctl="brake"]')
    const nitro = read('[data-ctl="nitro"]')
    const hand = read('[data-ctl="handbrake"]')
    const speedo = read('.speedo')
    const standings = read('.standings')
    return {
      joy,
      gas,
      brake,
      nitro,
      hand,
      overlaps: [hit(joy, gas), hit(joy, brake), hit(gas, speedo), hit(brake, speedo), hit(joy, standings), hit(gas, standings), hit(nitro, speedo), hit(hand, speedo)],
    }
  })
  assert(layout.joy, `${label}: joystick invisible`)
  assert(layout.gas && layout.brake && layout.nitro && layout.hand, `${label}: pédales manquantes`)
  assert(Math.abs(layout.gas.w - 58) < 8 && Math.abs(layout.gas.h - 58) < 8, `${label}: Gaz n'est pas ~58 px (${layout.gas.w}×${layout.gas.h})`)
  assert(!layout.overlaps.some(Boolean), `${label}: les contrôles recouvrent le HUD ou se chevauchent`)

  const origin = layout.joy
  const client = await page.context().newCDPSession(page)
  const cx = origin.x + origin.w / 2
  const cy = origin.y + origin.h / 2
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 3 }] })
  let prev = await page.evaluate(() => window.__circuit.input.debug().joy)
  let maxJump = 0
  for (let i = 1; i <= 6; i += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: cx + i * 8, y: cy, id: 3 }],
    })
    await page.waitForTimeout(40)
    const joy = await page.evaluate(() => window.__circuit.input.debug().joy)
    maxJump = Math.max(maxJump, Math.hypot(joy.x - prev.x, joy.y - prev.y))
    prev = joy
  }
  const base = await page.locator('[data-joystick]').boundingBox()
  assert(base && Math.abs(base.x - origin.x) < 1.5 && Math.abs(base.y - origin.y) < 1.5, `${label}: le joystick quitte son origine`)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert(maxJump < 28, `${label}: le nub saute (${maxJump.toFixed(1)} px)`)

  const gasBox = await page.locator('[data-ctl="throttle"]').boundingBox()
  assert(gasBox, `${label}: Gaz`)
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: gasBox.x + gasBox.width / 2, y: gasBox.y + gasBox.height / 2, id: 1 }],
  })
  try {
    await page.waitForFunction(() => window.__circuit.speed() > 12, null, { timeout: 20000 })
  } catch (error) {
    const snap = await page.evaluate(() => ({
      speed: window.__circuit.speed(),
      debug: window.__circuit.input.debug(),
      hidden: document.querySelector('[data-touch]')?.hidden,
    }))
    throw new Error(`${label}: ${JSON.stringify(snap)} (${error.message})`)
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const before = await page.evaluate(() => window.__circuit.heading())
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx + 48, y: cy, id: 4 }],
  })
  await page.waitForFunction((start) => Math.abs(window.__circuit.heading() - start) > 0.02, before, { timeout: 8000 })
  const after = await page.evaluate(() => window.__circuit.input.debug().maxSteerStep)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert(after < 0.2, `${label}: le braquage dépasse le plafond par frame (${after.toFixed(3)})`)
}

const server = startServer()
let browser
try {
  await server.ready
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  for (const name of ['iPhone 14', 'Pixel 7']) {
    const device = devices[name]
    assert(device, `appareil Playwright introuvable : ${name}`)
    const context = await browser.newContext({ ...device, hasTouch: true })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    await exercise(page, name)
    assert(errors.length === 0, `${name} erreurs page : ${errors.join(' | ')}`)
    await context.close()
    console.log('contrôles ok', name)
  }
} finally {
  await browser?.close()
  server.child.kill('SIGTERM')
}

console.log('touch check ok')
