// Bounded random-walk modulator - the engine behind the Remix "Fluctuation"
// feature (slow, organic drift of a looping sound's volume and/or pitch:
// wind gusting stronger and weaker, rain swelling and fading, something
// drifting closer and further). Every so often it picks a new target value
// somewhere in [min, max] - biased toward `bias`, where the value sits most
// of the time - and glides there over a time set by `transition`. How often
// a new target is picked is set by `changeRate`. Purely a playback-time
// behavior, never baked into a clip.
//
// Researched first (see the ranked backlog / CLAUDE.md): this is the
// game-audio "random modulator" / "LFO with a random shape" pattern (Wwise
// LFO ShareSets, FMOD's random modulation, Bitwig's Random LFO) - a
// smoothed, bounded random signal driving a parameter, rather than a fixed
// oscillator.
//
// Drives a single scalar via an onValue callback. Runs on setInterval (not
// requestAnimationFrame) so it keeps drifting - just more coarsely - when
// the window is minimized to tray with playback still going
// (backgroundThrottling clamps both, but a paused rAF freezes the value
// outright, which would leave a minimized rain sound stuck quiet). The
// exponential-approach math uses the real elapsed dt each tick, so a coarse
// 1s background step converges to the same place a smooth 60ms foreground
// step does, just in bigger hops.
const TICK_MS = 60

// changeRate 0..1 -> seconds between target changes (before per-change
// jitter). transition 0..1 -> the exponential-approach time constant in
// seconds (value covers ~63% of the remaining distance per tau, ~95% in
// 3*tau). Both deliberately span "barely moving / very slow" to "restless /
// snappy" rather than a tight musical range - this is ambience drift, not
// vibrato.
function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

export class Modulator {
  constructor({ onValue, neutral = 1 }) {
    this.onValue = onValue
    this.neutral = neutral
    this.enabled = false
    this.running = false
    this._timerId = null
    this._lastTick = 0
    this._nextChangeAt = 0

    this.min = neutral
    this.max = neutral
    this.bias = neutral
    this.intervalSeconds = 10
    this.tau = 3

    this.value = neutral
    this.target = neutral
  }

  configure({ enabled, min, max, bias, changeRate, transition }) {
    this.enabled = Boolean(enabled)
    this.min = Math.min(min, max)
    this.max = Math.max(min, max)
    this.bias = Math.min(this.max, Math.max(this.min, bias))
    this.intervalSeconds = lerp(20, 1.5, changeRate)
    this.tau = lerp(9, 0.15, transition)
    // Keep an in-flight target inside any freshly narrowed bounds.
    this.target = Math.min(this.max, Math.max(this.min, this.target))
  }

  _jitteredIntervalMs() {
    // +/-40% so the drift never falls into an audible metronome.
    return this.intervalSeconds * (0.6 + Math.random() * 0.8) * 1000
  }

  // Value sits near `bias` most of the time, wandering out toward the
  // extremes only occasionally - and toward whichever side has more room, so
  // an off-center bias still reaches both ends. Math.pow(random, 1.7) skews
  // the pick toward small deviations from the bias.
  _pickTarget() {
    const lower = this.bias - this.min
    const upper = this.max - this.bias
    const span = lower + upper
    if (span <= 0) return this.bias
    const goUp = Math.random() < upper / span
    const t = Math.pow(Math.random(), 1.7)
    return goUp ? this.bias + t * upper : this.bias - t * lower
  }

  start() {
    if (this.running || !this.enabled) return
    this.running = true
    this.value = this.bias
    this.target = this.bias
    this._lastTick = performance.now()
    this._nextChangeAt = this._lastTick + this._jitteredIntervalMs()
    this.onValue(this.value)
    this._timerId = setInterval(() => this._tick(), TICK_MS)
  }

  _tick() {
    if (!this.running) return
    const now = performance.now()
    const dt = Math.min(1.5, (now - this._lastTick) / 1000)
    this._lastTick = now
    if (now >= this._nextChangeAt) {
      this.target = this._pickTarget()
      this._nextChangeAt = now + this._jitteredIntervalMs()
    }
    const k = 1 - Math.exp(-dt / this.tau)
    this.value += (this.target - this.value) * k
    this.onValue(this.value)
  }

  stop({ resetToNeutral = true } = {}) {
    if (!this.running) return
    this.running = false
    if (this._timerId) clearInterval(this._timerId)
    this._timerId = null
    if (resetToNeutral) this.onValue(this.neutral)
  }

  dispose() {
    this.stop({ resetToNeutral: false })
    this.onValue = () => {}
  }
}

// Shared normalization for the fluctuation config bag - one axis (volume or
// pitch). Used by library.js's defaults, the Mixer's live-source reconcile
// staleness check, and the Remix plugin. `undefined` (a sound predating this
// feature) and an explicit disabled/neutral object must compare equal.
export function normalizeFluctuationAxis(axis, neutral) {
  return {
    enabled: Boolean(axis?.enabled),
    min: Number.isFinite(axis?.min) ? axis.min : neutral,
    max: Number.isFinite(axis?.max) ? axis.max : neutral,
    bias: Number.isFinite(axis?.bias) ? axis.bias : neutral,
    changeRate: Number.isFinite(axis?.changeRate) ? axis.changeRate : 0.5,
    transition: Number.isFinite(axis?.transition) ? axis.transition : 0.5
  }
}

// Stable fingerprint of a whole fluctuation config - the Mixer's live-source
// reconcile compares this against the running source's own to decide whether
// setFluctuation() needs calling, exactly like hasFilters/hasSpeed.
export function fluctuationKey(fluctuation) {
  return JSON.stringify({
    vol: normalizeFluctuationAxis(fluctuation?.volume, 1),
    pit: normalizeFluctuationAxis(fluctuation?.pitch, 0)
  })
}

// Owns the volume + pitch Modulator pair for one playing sound (or one
// preview voice-set). The caller supplies how each axis actually reaches the
// audio graph: onVolume(0..1 multiplier) and onPitch(semitone offset).
// Shared by src/renderer/audio/SoundSource.js and BufferSoundSource.js (and,
// duplicated per the plugin's bundle-your-own rule, the Remix PreviewSource).
export class SoundFluctuation {
  constructor({ onVolume, onPitch }) {
    this.volMod = new Modulator({ onValue: onVolume, neutral: 1 })
    this.pitchMod = new Modulator({ onValue: onPitch, neutral: 0 })
    this.key = fluctuationKey(null)
  }

  configure(fluctuation) {
    this.key = fluctuationKey(fluctuation)
    this.volMod.configure(normalizeFluctuationAxis(fluctuation?.volume, 1))
    this.pitchMod.configure(normalizeFluctuationAxis(fluctuation?.pitch, 0))
  }

  // Brings each modulator's running state in line with whether the sound is
  // actually playing right now - called from play()/pause() and from a live
  // setFluctuation() while already playing (enabling an axis mid-playback
  // should start it; disabling should stop and neutralize it).
  sync(playing) {
    for (const mod of [this.volMod, this.pitchMod]) {
      if (playing && mod.enabled && !mod.running) mod.start()
      else if ((!playing || !mod.enabled) && mod.running) mod.stop()
    }
  }

  stop() {
    this.volMod.stop()
    this.pitchMod.stop()
  }

  dispose() {
    this.volMod.dispose()
    this.pitchMod.dispose()
  }
}
