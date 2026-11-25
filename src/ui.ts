import type { Phase } from './render/world.ts'

export type HudStanding = {
  name: string
  color: string
  isPlayer: boolean
  gap: string
  x: number
  z: number
  heading: number
}

export type ResultRow = {
  position: number
  name: string
  isPlayer: boolean
  time: string
  best: string
  detail: string
}

export type GraphicsQuality = 'bas' | 'moyen' | 'eleve'

export type HudModel = {
  phase: Phase
  showHelp: boolean
  countdown: string | null
  speed: number
  gear: string
  rpm: number
  position: number
  lapText: string
  currentLap: number
  bestLap: number | null
  totalTime: number
  wrongWay: boolean
  hint: string | null
  flash: string | null
  cameraLabel: string
  muted: boolean
  standings: HudStanding[]
  results: ResultRow[]
  record: number | null
  quality: GraphicsQuality
}

type MapPoint = { x: number; z: number }

export type UiHandlers = {
  onPlay: () => void
  onHelp: () => void
  onCloseHelp: () => void
  onResume: () => void
  onRestart: () => void
  onMenu: () => void
  onMute: () => void
  onQuality: (quality: GraphicsQuality) => void
}

export type Ui = {
  setTrack: (points: MapPoint[]) => void
  setModel: (model: HudModel) => void
}

export function mountUi(root: HTMLElement, handlers: UiHandlers): Ui {
  root.innerHTML = `
    <div class="hud" data-hud>
      <div class="panel standings">
        <div class="pos" data-pos></div>
        <div class="lap" data-lap></div>
        <canvas class="minimap" data-map width="180" height="180"></canvas>
        <ol data-board></ol>
      </div>
      <div class="panel times">
        <span>Tour</span><strong data-current>—</strong>
        <span>Meilleur</span><strong data-best>—</strong>
        <span>Temps</span><strong data-total>0:00.000</strong>
        <button type="button" class="ghost" data-mute>Son</button>
      </div>
      <div class="speedo">
        <svg class="gauge" viewBox="0 0 160 108" aria-hidden="true">
          <path class="gauge-track" d="M22 92 A 58 58 0 1 1 138 92" />
          <path data-arc class="gauge-value" d="M22 92 A 58 58 0 1 1 138 92" />
        </svg>
        <div class="speed" data-speed>0</div>
        <div class="unit">km/h</div>
        <div class="gear" data-gear>N</div>
        <div class="rpm" data-rpm></div>
        <div class="cam" data-cam>Poursuite</div>
      </div>
      <div class="banner wrong" data-wrong hidden>Mauvais sens</div>
      <div class="banner hint" data-hint hidden></div>
      <div class="flash" data-flash hidden></div>
      <div class="countdown" data-count hidden></div>
    </div>
    <section class="menu" data-menu>
      <p class="eyebrow">Grand Prix de Cotonou</p>
      <h1>Circuit Atlantique</h1>
      <p class="lead">Trois tours sur le circuit du littoral. Gardez la trajectoire, les murs ne pardonnent pas.</p>
      <div class="quality" aria-label="Qualité graphique">
        <span>Graphismes</span>
        <button type="button" data-quality-pick="bas">Bas</button>
        <button type="button" data-quality-pick="moyen">Moyen</button>
        <button type="button" data-quality-pick="eleve">Élevé</button>
      </div>
      <div class="actions">
        <button type="button" class="primary" data-play>Jouer</button>
        <button type="button" class="secondary" data-help>Commandes</button>
      </div>
      <p class="record" data-record></p>
      <p class="fine">ZQSD ou WASD · flèches · écran tactile</p>
    </section>
    <section class="overlay help" data-help-panel hidden>
      <div class="sheet">
        <h2>Commandes</h2>
        <ul>
          <li><b>Z · W · ↑</b> Accélérer</li>
          <li><b>S · ↓</b> Freiner (maintenir à l'arrêt pour reculer)</li>
          <li><b>Q · A · D · ← →</b> Diriger</li>
          <li><b>Espace</b> Frein à main</li>
          <li><b>C</b> Caméra poursuite / capot</li>
          <li><b>R</b> Replacer après le dernier point de contrôle</li>
          <li><b>Échap</b> Pause</li>
          <li><b>M</b> Couper le son</li>
        </ul>
        <p>Sur écran tactile : flèches ou joystick à gauche, Gaz et Frein à droite. Les points de contrôle empêchent de couper le circuit.</p>
        <button type="button" class="primary" data-close-help>Fermer</button>
      </div>
    </section>
    <section class="overlay pause" data-pause hidden>
      <div class="sheet">
        <h2>Pause</h2>
        <div class="actions column">
          <button type="button" class="primary" data-resume>Reprendre</button>
          <button type="button" class="secondary" data-restart>Recommencer</button>
          <button type="button" class="secondary" data-help-pause>Commandes</button>
          <div class="quality">
            <span>Graphismes</span>
            <button type="button" data-quality-pick="bas">Bas</button>
            <button type="button" data-quality-pick="moyen">Moyen</button>
            <button type="button" data-quality-pick="eleve">Élevé</button>
          </div>
          <button type="button" class="secondary" data-steer-mode>Joystick</button>
          <button type="button" class="secondary" data-to-menu>Menu</button>
        </div>
      </div>
    </section>
    <section class="overlay finish" data-finish hidden>
      <div class="sheet wide">
        <p class="eyebrow">Circuit Atlantique</p>
        <h2>Course terminée</h2>
        <table>
          <thead><tr><th>Pos.</th><th>Pilote</th><th>Temps</th><th>Meilleur tour</th></tr></thead>
          <tbody data-results></tbody>
        </table>
        <p class="record" data-finish-note></p>
        <div class="actions">
          <button type="button" class="primary" data-replay>Rejouer</button>
          <button type="button" class="secondary" data-menu-finish>Menu</button>
        </div>
      </div>
    </section>
    <div class="touch" data-touch hidden>
      <div class="steer-col">
        <div class="steer-buttons">
          <button type="button" data-ctl="left" aria-label="Gauche"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 L7 12 L15 20" /></svg></button>
          <button type="button" data-ctl="right" aria-label="Droite"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 L17 12 L9 20" /></svg></button>
        </div>
        <div class="joystick" data-joystick aria-label="Direction">
          <div class="nub" data-nub></div>
        </div>
      </div>
      <div class="touch-side">
        <div class="touch-util">
          <button type="button" data-ctl="handbrake" aria-label="Frein à main"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 14 V7 M8 7 h6 a4 4 0 0 1 0 8 H8" /></svg></button>
          <button type="button" data-ctl="nitro" aria-label="Nitro"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 L6 13 h6 l-1 8 8-12 h-6 z" /></svg></button>
          <button type="button" data-ctl="camera" aria-label="Caméra"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M4 9 h3 l2-2 h6 l2 2 h3 v9 H4 z" /></svg></button>
        </div>
        <div class="touch-pad">
          <button type="button" class="brake" data-ctl="brake" aria-label="Freiner"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6 h10 v12 H7 z" /></svg></button>
          <button type="button" class="gas" data-ctl="throttle" aria-label="Accélérer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 L20 18 H4 z" /></svg></button>
        </div>
      </div>
    </div>
  `

  const arc = root.querySelector<SVGPathElement>('[data-arc]')!
  const arcLen = arc.getTotalLength()
  arc.style.strokeDasharray = `${arcLen}`
  arc.style.strokeDashoffset = `${arcLen}`
  const rpmHost = root.querySelector<HTMLElement>('[data-rpm]')!
  const segments = Array.from({ length: 16 }, (_, index) => {
    const seg = document.createElement('i')
    if (index >= 13) seg.classList.add('hot')
    else if (index >= 10) seg.classList.add('warm')
    rpmHost.append(seg)
    return seg
  })

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!
  q<HTMLButtonElement>('[data-play]').addEventListener('click', handlers.onPlay)
  q<HTMLButtonElement>('[data-help]').addEventListener('click', handlers.onHelp)
  q<HTMLButtonElement>('[data-help-pause]').addEventListener('click', handlers.onHelp)
  q<HTMLButtonElement>('[data-close-help]').addEventListener('click', handlers.onCloseHelp)
  q<HTMLButtonElement>('[data-resume]').addEventListener('click', handlers.onResume)
  q<HTMLButtonElement>('[data-restart]').addEventListener('click', handlers.onRestart)
  q<HTMLButtonElement>('[data-replay]').addEventListener('click', handlers.onRestart)
  q<HTMLButtonElement>('[data-to-menu]').addEventListener('click', handlers.onMenu)
  q<HTMLButtonElement>('[data-menu-finish]').addEventListener('click', handlers.onMenu)
  q<HTMLButtonElement>('[data-mute]').addEventListener('click', handlers.onMute)
  q<HTMLButtonElement>('[data-steer-mode]').addEventListener('click', (event) => {
    const touch = root.querySelector<HTMLElement>('[data-touch]')
    touch?.classList.toggle('zones')
    ;(event.currentTarget as HTMLButtonElement).classList.toggle('active', !touch?.classList.contains('zones'))
  })
  root.querySelectorAll<HTMLButtonElement>('[data-quality-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      const pick = button.dataset.qualityPick
      if (pick === 'bas' || pick === 'moyen' || pick === 'eleve') handlers.onQuality(pick)
    })
  })
  const map = q<HTMLCanvasElement>('[data-map]')
  const mapCtx = map.getContext('2d')!
  let mapReady: { points: MapPoint[]; minX: number; minZ: number; sx: number; sy: number } | null = null
  const staticMap = document.createElement('canvas')
  staticMap.width = 180
  staticMap.height = 180

  return {
    setTrack: (points) => {
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const p of points) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
      }
      const pad = 14
      const sx = (180 - pad * 2) / Math.max(1, maxX - minX)
      const sy = (180 - pad * 2) / Math.max(1, maxZ - minZ)
      const scale = Math.min(sx, sy)
      mapReady = { points, minX, minZ, sx: scale, sy: scale }
      const ctx = staticMap.getContext('2d')!
      ctx.clearRect(0, 0, 180, 180)
      ctx.strokeStyle = '#d7d2c6'
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.beginPath()
      points.forEach((p, i) => {
        const x = pad + (p.x - minX) * scale
        const y = pad + (p.z - minZ) * scale
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.stroke()
      const start = points[0]
      if (start) {
        ctx.fillStyle = '#f2c200'
        ctx.fillRect(pad + (start.x - minX) * scale - 3, pad + (start.z - minZ) * scale - 3, 6, 6)
      }
    },
    setModel: (model) => {
      q('[data-menu]').hidden = model.phase !== 'menu'
      root.querySelectorAll<HTMLButtonElement>('[data-quality-pick]').forEach((button) => {
        button.classList.toggle('active', button.dataset.qualityPick === model.quality)
      })
      q('[data-hud]').hidden = model.phase === 'menu'
      q('[data-help-panel]').hidden = !model.showHelp
      q('[data-pause]').hidden = model.phase !== 'paused' || model.showHelp
      q('[data-finish]').hidden = model.phase !== 'finished'
      q<HTMLButtonElement>('[data-mute]').textContent = model.muted ? 'Son coupé' : 'Son'
      const touch = root.querySelector<HTMLElement>('[data-touch]')!
      const coarse = window.matchMedia('(pointer: coarse), (hover: none)').matches
      touch.hidden = !(coarse && (model.phase === 'racing' || model.phase === 'countdown'))

      if (model.phase === 'menu') {
        q('[data-record]').textContent = model.record === null ? 'Aucun meilleur tour enregistré.' : `Meilleur tour : ${formatTime(model.record)}`
        return
      }

      setOrdinal(q('[data-pos]'), model.position)
      q('[data-lap]').textContent = `Tour ${model.lapText}`
      q('[data-speed]').textContent = String(Math.round(Math.abs(model.speed)))
      const speedT = Math.max(0, Math.min(1, Math.abs(model.speed) / 280))
      arc.style.strokeDashoffset = `${arcLen * (1 - speedT)}`
      q('[data-gear]').textContent = model.gear
      q('[data-current]').textContent = formatTime(model.currentLap)
      q('[data-best]').textContent = model.bestLap === null ? '—:—.—' : formatTime(model.bestLap)
      q('[data-total]').textContent = formatTime(model.totalTime)
      q('[data-cam]').textContent = model.cameraLabel
      const lit = Math.round((model.rpm / 8000) * segments.length)
      segments.forEach((seg, i) => seg.classList.toggle('on', i < lit))

      const wrong = q<HTMLElement>('[data-wrong]')
      wrong.hidden = !model.wrongWay
      const hint = q<HTMLElement>('[data-hint]')
      hint.hidden = !model.hint
      hint.textContent = model.hint ?? ''
      const flash = q<HTMLElement>('[data-flash]')
      flash.hidden = !model.flash
      flash.textContent = model.flash ?? ''
      const count = q<HTMLElement>('[data-count]')
      count.hidden = !model.countdown
      count.textContent = model.countdown ?? ''
      count.classList.toggle('go', model.countdown === 'Partez !')

      const board = q<HTMLOListElement>('[data-board]')
      board.replaceChildren(
        ...model.standings.map((row, index) => {
          const li = document.createElement('li')
          if (row.isPlayer) li.classList.add('me')
          const swatch = document.createElement('i')
          swatch.style.background = row.color
          const name = document.createElement('span')
          name.textContent = `${ordinal(index + 1)}  ${row.name}`
          const gap = document.createElement('em')
          gap.textContent = row.gap
          li.append(swatch, name, gap)
          return li
        }),
      )

      if (mapReady) {
        mapCtx.fillStyle = '#12161c'
        mapCtx.fillRect(0, 0, 180, 180)
        mapCtx.drawImage(staticMap, 0, 0)
        const pad = 14
        for (const car of model.standings) {
          const x = pad + (car.x - mapReady.minX) * mapReady.sx
          const y = pad + (car.z - mapReady.minZ) * mapReady.sy
          mapCtx.beginPath()
          mapCtx.arc(x, y, car.isPlayer ? 4.5 : 3.2, 0, Math.PI * 2)
          mapCtx.fillStyle = car.color
          mapCtx.fill()
          mapCtx.lineWidth = car.isPlayer ? 1.6 : 1
          mapCtx.strokeStyle = car.isPlayer ? '#ffffff' : 'rgba(0,0,0,0.55)'
          mapCtx.stroke()
        }
      }

      if (model.phase === 'finished') {
        const body = q<HTMLElement>('[data-results]')
        body.replaceChildren(
          ...model.results.map((row) => {
            const tr = document.createElement('tr')
            if (row.isPlayer) tr.classList.add('me')
            for (const text of [ordinal(row.position), row.name, row.time, row.best]) {
              const td = document.createElement('td')
              td.textContent = text
              tr.append(td)
            }
            return tr
          }),
        )
        const player = model.results.find((row) => row.isPlayer)
        q('[data-finish-note]').textContent = player ? player.detail : ''
      }
    },
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—:—.—'
  const min = Math.floor(seconds / 60)
  const sec = seconds - min * 60
  const whole = Math.floor(sec)
  const ms = Math.floor((sec - whole) * 1000)
  return `${min}:${whole.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}

function ordinal(n: number): string {
  return n === 1 ? '1er' : `${n}e`
}

function setOrdinal(el: HTMLElement, n: number): void {
  el.replaceChildren()
  el.append(document.createTextNode(String(n)))
  const sup = document.createElement('sup')
  sup.textContent = n === 1 ? 'er' : 'e'
  el.append(sup)
}
