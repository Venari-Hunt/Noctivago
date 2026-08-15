const RAMP_SECONDS = 0.15
const LOOP_EPSILON_SECONDS = 0.03

export class LocalFileSoundSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume, filters }) {
    this.engine = engine
    this.loopStart = loopStart ?? 0
    this.loopEnd = loopEnd ?? null
    this.volume = volume
    this.playing = false
    this._rafId = null
    this._pauseTimeoutId = null

    this.audioEl = new Audio()
    this.audioEl.crossOrigin = 'anonymous'
    this.audioEl.preload = 'auto'
    this.audioEl.src = `sound://${soundId}`

    this.sourceNode = engine.context.createMediaElementSource(this.audioEl)

    // Same highpass -> lowpass -> gain chain as the Remix plugin's preview
    // (plugins/editor/audio/PreviewSource.js), so saved filters are audible
    // in the Mixer even for sounds too long to qualify for a baked buffer
    // clip. Loop-clip eligibility only affects seam smoothness, never
    // whether filters apply.
    this.highpassNode = engine.context.createBiquadFilter()
    this.highpassNode.type = 'highpass'
    this.highpassNode.frequency.value = filters?.highpassHz ?? 0

    this.lowpassNode = engine.context.createBiquadFilter()
    this.lowpassNode.type = 'lowpass'
    this.lowpassNode.frequency.value = filters?.lowpassHz ?? 20000

    this.filterGainNode = engine.context.createGain()
    this.filterGainNode.gain.value = filters?.gainDb ? Math.pow(10, filters.gainDb / 20) : 1

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0

    this.sourceNode.connect(this.highpassNode)
    this.highpassNode.connect(this.lowpassNode)
    this.lowpassNode.connect(this.filterGainNode)
    this.filterGainNode.connect(this.gainNode)
    this.gainNode.connect(engine.masterGain)
  }

  waitForMetadata() {
    if (this.audioEl.readyState >= 1) return Promise.resolve(this.audioEl.duration)
    return new Promise((resolve) => {
      this.audioEl.addEventListener('loadedmetadata', () => resolve(this.audioEl.duration), { once: true })
    })
  }

  setLoopPoints(loopStart, loopEnd) {
    this.loopStart = loopStart
    this.loopEnd = loopEnd
  }

  _loopEnd() {
    return this.loopEnd ?? this.audioEl.duration
  }

  _tick() {
    if (!this.playing) return
    const end = this._loopEnd()
    if (Number.isFinite(end) && this.audioEl.currentTime >= end - LOOP_EPSILON_SECONDS) {
      this.audioEl.currentTime = this.loopStart
    }
    this._rafId = requestAnimationFrame(() => this._tick())
  }

  async play() {
    if (this.playing) return
    if (this._pauseTimeoutId) {
      clearTimeout(this._pauseTimeoutId)
      this._pauseTimeoutId = null
    }
    const end = this._loopEnd()
    if (this.audioEl.currentTime < this.loopStart || (Number.isFinite(end) && this.audioEl.currentTime >= end)) {
      this.audioEl.currentTime = this.loopStart
    }
    await this.audioEl.play()
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this.playing = true
    this._tick()
  }

  pause() {
    if (!this.playing) return
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)
    this.playing = false
    if (this._rafId) cancelAnimationFrame(this._rafId)
    if (this._pauseTimeoutId) clearTimeout(this._pauseTimeoutId)
    this._pauseTimeoutId = setTimeout(() => {
      this._pauseTimeoutId = null
      this.audioEl.pause()
    }, RAMP_SECONDS * 1000 + 20)
  }

  setVolume(volume) {
    this.volume = volume
    if (this.playing) {
      const now = this.engine.context.currentTime
      this.gainNode.gain.cancelScheduledValues(now)
      this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.05)
    }
  }

  dispose() {
    this.playing = false
    if (this._rafId) cancelAnimationFrame(this._rafId)
    if (this._pauseTimeoutId) clearTimeout(this._pauseTimeoutId)
    this.audioEl.pause()
    this.audioEl.removeAttribute('src')
    this.audioEl.load()
    this.sourceNode.disconnect()
    this.highpassNode.disconnect()
    this.lowpassNode.disconnect()
    this.filterGainNode.disconnect()
    this.gainNode.disconnect()
  }
}
