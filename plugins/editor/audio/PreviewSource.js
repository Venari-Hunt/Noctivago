const RAMP_SECONDS = 0.15
const LOOP_EPSILON_SECONDS = 0.03
const FILTER_SMOOTHING_SECONDS = 0.01

// Streams a sound for editing preview (same sound://<id> streaming approach
// as core's LocalFileSoundSource, so this works for files of any length)
// with an insertable live filter chain: source -> highpass -> lowpass ->
// gain -> output. Filter params update instantly via BiquadFilterNode/
// GainNode automation, so dragging a slider gives real-time audible
// feedback with no ffmpeg round-trip — ffmpeg only runs once, to bake the
// final values in when the user saves.
export class PreviewSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume }) {
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

    this.highpassNode = engine.context.createBiquadFilter()
    this.highpassNode.type = 'highpass'
    this.highpassNode.frequency.value = 0

    this.lowpassNode = engine.context.createBiquadFilter()
    this.lowpassNode.type = 'lowpass'
    this.lowpassNode.frequency.value = 20000

    this.filterGainNode = engine.context.createGain()
    this.filterGainNode.gain.value = 1

    this.outputGainNode = engine.context.createGain()
    this.outputGainNode.gain.value = 0

    this.sourceNode.connect(this.highpassNode)
    this.highpassNode.connect(this.lowpassNode)
    this.lowpassNode.connect(this.filterGainNode)
    this.filterGainNode.connect(this.outputGainNode)
    this.outputGainNode.connect(engine.masterGain)
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

  setFilters({ highpassHz, lowpassHz, gainDb }) {
    const now = this.engine.context.currentTime
    this.highpassNode.frequency.setTargetAtTime(highpassHz, now, FILTER_SMOOTHING_SECONDS)
    this.lowpassNode.frequency.setTargetAtTime(lowpassHz, now, FILTER_SMOOTHING_SECONDS)
    this.filterGainNode.gain.setTargetAtTime(Math.pow(10, gainDb / 20), now, FILTER_SMOOTHING_SECONDS)
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
    this.outputGainNode.gain.cancelScheduledValues(now)
    this.outputGainNode.gain.setValueAtTime(this.outputGainNode.gain.value, now)
    this.outputGainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this.playing = true
    this._tick()
  }

  pause() {
    if (!this.playing) return
    const now = this.engine.context.currentTime
    this.outputGainNode.gain.cancelScheduledValues(now)
    this.outputGainNode.gain.setValueAtTime(this.outputGainNode.gain.value, now)
    this.outputGainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)
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
      this.outputGainNode.gain.cancelScheduledValues(now)
      this.outputGainNode.gain.linearRampToValueAtTime(volume, now + 0.05)
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
    this.outputGainNode.disconnect()
  }
}
