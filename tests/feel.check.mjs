import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8744
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

async function ready(page) {
  if (!LIVE) {
    await page.waitForFunction(() => window.__game && window.__game.build === 'visual-v8', null, { timeout: 90000 })
    return
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await page.waitForFunction(() => window.__game && window.__game.build === 'visual-v8', null, { timeout: 30000 })
      await page.waitForTimeout(1500)
      if ((await page.evaluate(() => window.__game && window.__game.build)) === 'visual-v8') return
    } catch {
      /* rechargement du service worker */
    }
  }
}

async function exercise(page, label, shots) {
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.addInitScript(() => localStorage.setItem('circuit-atlantique-quality', 'bas'))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await ready(page)
  if (shots) await page.screenshot({ path: `/opt/cursor/artifacts/title_${label.replace(/\s/g, '_')}.png` })
  const selection = await page.evaluate(() => {
    const button = document.querySelector('[data-play]')
    const style = getComputedStyle(button)
    return {
      userSelect: style.userSelect || style.webkitUserSelect,
      callout: style.webkitTouchCallout,
      text: window.getSelection() ? window.getSelection().toString() : '',
    }
  })
  assert(selection.userSelect === 'none', `${label}: le texte reste sélectionnable (${selection.userSelect})`)
  assert(!selection.text, `${label}: une sélection est active`)
  await page.evaluate(() => window.__game.skipToRace())
  await page.locator('[data-ctl="throttle"]').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
  const before = await page.evaluate(() => window.__game.frames)
  const need = label === 'desktop' ? 5 : 20
  try {
    await page.waitForFunction(
      ({ start, count }) => window.__game.frames - start >= count,
      { start: before, count: need },
      { timeout: 8000 },
    )
  } catch (error) {
    const snap = await page.evaluate(() => ({ frames: window.__game.frames, build: window.__game.build }))
    throw new Error(`${label} fps ${JSON.stringify(snap)} ${errors.join(' | ')} (${error.message})`)
  }
  const gas = await page.locator('[data-ctl="throttle"]')
  if (await gas.isVisible()) {
    const box = await gas.boundingBox()
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
    })
    await page.waitForTimeout(700)
    const held = await page.evaluate(() => (window.getSelection() ? window.getSelection().toString() : ''))
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    assert(!held, `${label}: l'appui long sélectionne « ${held} »`)
  }
  console.log(`${label}: sélection bloquée, images fluides`)
  assert(errors.length === 0, `${label}: ${errors.join(' | ')}`)
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
    const context = await browser.newContext({ ...devices[name], hasTouch: true })
    const page = await context.newPage()
    await exercise(page, name, SHOTS)
    await context.close()
  }
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await desktop.newPage()
  await exercise(page, 'desktop', SHOTS)
  if (SHOTS && !LIVE) {
    await page.evaluate(() => window.__gp && window.__gp.fastForward(220))
    await page.waitForTimeout(400)
    await page.screenshot({ path: '/opt/cursor/artifacts/results_desktop.png' })
  }
  await desktop.close()
} finally {
  await browser?.close()
  server?.child.kill('SIGTERM')
}

console.log(LIVE ? 'feel live ok' : 'feel check ok')
