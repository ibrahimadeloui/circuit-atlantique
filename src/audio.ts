export class RaceAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private engineGain: GainNode | null = null
  private oscA: OscillatorNode | null = null
  private oscB: OscillatorNode | null = null
  private filter: BiquadFilterNode | null = null
  private skidGain: GainNode | null = null
  muted = false
  private started = false

  start(): void {
    if (this.started) {
      void this.ctx?.resume()
      return
    }
    const ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)

    const engineGain = ctx.createGain()
    engineGain.gain.value = 0.0001
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420
    filter.Q.value = 0.7
    const shaper = ctx.createWaveShaper()
    shaper.curve = distortCurve(2.2)
    shaper.oversample = '2x'

    const oscA = ctx.createOscillator()
    oscA.type = 'sawtooth'
    const oscB = ctx.createOscillator()
    oscB.type = 'square'
    const mix = ctx.createGain()
    mix.gain.value = 0.55
    oscA.connect(mix)
    const quiet = ctx.createGain()
    quiet.gain.value = 0.18
    oscB.connect(quiet)
    quiet.connect(mix)
    mix.connect(shaper)
    shaper.connect(filter)
    filter.connect(engineGain)
    engineGain.connect(master)
    oscA.start()
    oscB.start()

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer(ctx)
    noise.loop = true
    const skidFilter = ctx.createBiquadFilter()
    skidFilter.type = 'bandpass'
    skidFilter.frequency.value = 900
    skidFilter.Q.value = 0.6
    const skidGain = ctx.createGain()
    skidGain.gain.value = 0
    noise.connect(skidFilter)
    skidFilter.connect(skidGain)
    skidGain.connect(master)
    noise.start()

    this.ctx = ctx
    this.master = master
    this.engineGain = engineGain
    this.oscA = oscA
    this.oscB = oscB
    this.filter = filter
    this.skidGain = skidGain
    this.started = true
    this.applyMute()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyMute()
  }

  private lastGear = 0

  update(rpm: number, throttle: number, slip: number, drifting: boolean, gear = 0, impact = 0): void {
    if (!this.ctx || !this.oscA || !this.oscB || !this.filter || !this.engineGain || !this.skidGain) return
    const now = this.ctx.currentTime
    const clamped = Math.max(800, Math.min(8200, rpm))
    const freq = 30 + (clamped / 8000) * 132
    this.oscA.frequency.setTargetAtTime(freq, now, 0.035)
    this.oscB.frequency.setTargetAtTime(freq * 0.5 + 6, now, 0.04)
    const cutoff = 180 + clamped * 0.28 + throttle * 900
    this.filter.frequency.setTargetAtTime(Math.min(4800, cutoff), now, 0.04)
    const vol = 0.04 + throttle * 0.11 + (clamped / 8000) * 0.06
    this.engineGain.gain.setTargetAtTime(vol, now, 0.05)
    const skid = drifting ? Math.min(0.16, Math.abs(slip) * 0.02 + 0.03) : Math.min(0.07, Math.abs(slip) * 0.008)
    this.skidGain.gain.setTargetAtTime(skid, now, 0.04)
    if (gear !== this.lastGear && this.started) {
      this.beep(180 + gear * 40, 0.05, 0.03)
      this.lastGear = gear
    }
    if (impact > 3) this.beep(90, 0.12, Math.min(0.12, impact * 0.012))
  }

  beep(frequency: number, duration = 0.14, gain = 0.08): void {
    if (!this.ctx || !this.master || this.muted) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = frequency
    g.gain.setValueAtTime(gain, this.ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration)
    osc.connect(g)
    g.connect(this.master)
    osc.start()
    osc.stop(this.ctx.currentTime + duration + 0.02)
  }

  private applyMute(): void {
    if (!this.master || !this.ctx) return
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05)
  }
}

function distortCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount)
  }
  return curve
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}
