// Bounded random-walk modulator - the engine behind the Remix "Fluctuation"
// feature (slow, organic drift of a looping sound's volume and/or pitch:
// wind gusting stronger and weaker, rain swelling and fading, something
// drifting closer and further). Every so often it picks a new target value
// somewhere in [min, max] - biased toward `bias`, where the value sits most
// of the time - and glides there over `transitionSeconds`. How often a new
// target is picked is a random gap in [changeMinSeconds, changeMaxSeconds].
// Purely a playback-time behavior, never baked into a clip.
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

// v0.1.176 - the timing controls are now flat seconds the user reads
// directly (owner feedback: a 0..100% slider "doesn't make any sense... what
// does the percentage represent?"). Older saved configs used `changeRate` /
// `transition` in 0..1; normalizeFluctuationAxis() migrates them below.
//
// changeMinSeconds..changeMaxSeconds: a new target is picked after a random
// gap uniformly in that range. transitionSeconds: the value covers ~95% of
// the distance to a new target in that time (the exponential time constant
// tau is transitionSeconds/3). `fullyRandom` bypasses min/bias/max entirely
// and roams the whole axis uniformly (owner: "there's no fully random volume
// nor fully random pitch - there should be").
export const FLUCTUATION_PITCH_RANGE = 6

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}

// Resolves an axis's timing fields to the current flat-seconds shape,
// accepting either the new fields, the pre-v0.1.176 `changeRate`/`transition`
// (0..1), or nothing. gainEnvelope.js keeps its own copy of this mapping (the
// main process can't import from src/renderer/) - keep the two in sync.
export function resolveFluctuationTiming(axis) {
  if (Number.isFinite(axis?.changeMinSeconds) || Number.isFinite(axis?.transitionSeconds)) {
    const lo = clampNum(axis.changeMinSeconds, 0.2, 300, 6)
    const hi = clampNum(axis.changeMaxSeconds, 0.2, 300, 14)
    return {
      changeMinSeconds: Math.min(lo, hi),
      changeMaxSeconds: Math.max(lo, hi),
      transitionSeconds: clampNum(axis.transitionSeconds, 0.2, 120, 8)
    }
  }
  if (Number.isFinite(axis?.changeRate) || Number.isFinite(axis?.transition)) {
    const r = Number.isFinite(axis.changeRate) ? axis.changeRate : 0.5
    const t = Number.isFinite(axis.transition) ? axis.transition : 0.5
    const centre = lerp(20, 1.5, r) // old intervalSeconds
    const tau = lerp(9, 0.15, t) // old time constant
    return {
      changeMinSeconds: Math.round(centre * 0.6 * 10) / 10,
      changeMaxSeconds: Math.round(centre * 1.4 * 10) / 10,
      transitionSeconds: Math.round(tau * 3 * 10) / 10
    }
  }
  return { changeMinSeconds: 6, changeMaxSeconds: 14, transitionSeconds: 8 }
}

// Picks a value in [min, max], skewed toward `bias` - the same "sits near
// bias most of the time, wanders out toward the extremes only occasionally"
// shape Fluctuation's own drift target uses (see _pickTarget below), pulled
// out standalone so ScatterSoundSource.js's per-shot pitch/gap randomization
// (Board backlog: a "bias" value competing with a plain min/max random pick)
// can reuse the exact same, already-tuned math instead of a second copy with
// its own feel to calibrate. `bias` must already be within [min, max].
export function pickBiasedValue(min, max, bias) {
  const lower = bias - min
  const upper = max - bias
  const span = lower + upper
  if (span <= 0) return bias
  const goUp = Math.random() < upper / span
  const t = Math.pow(Math.random(), 1.7)
  return goUp ? bias + t * upper : bias - t * lower
}

export class Modulator {
  constructor({ onValue, neutral = 1, rangeMin = neutral, rangeMax = neutral }) {
    this.onValue = onValue
    this.neutral = neutral
    this.rangeMin = Math.min(rangeMin, rangeMax)
    this.rangeMax = Math.max(rangeMin, rangeMax)
    this.enabled = false
    this.fullyRandom = false
    this.running = false
    this._timerId = null
    this._lastTick = 0
    this._nextChangeAt = 0

    this.min = neutral
    this.max = neutral
    this.bias = neutral
    this.changeMinSeconds = 6
    this.changeMaxSeconds = 14
    this.tau = 3

    this.value = neutral
    this.target = neutral
  }

  configure({ enabled, fullyRandom, min, max, bias, changeMinSeconds, changeMaxSeconds, transitionSeconds }) {
    this.enabled = Boolean(enabled)
    this.fullyRandom = Boolean(fullyRandom)
    if (this.fullyRandom) {
      this.min = this.rangeMin
      this.max = this.rangeMax
      this.bias = (this.rangeMin + this.rangeMax) / 2
    } else {
      this.min = Math.min(min, max)
      this.max = Math.max(min, max)
      this.bias = Math.min(this.max, Math.max(this.min, bias))
    }
    this.changeMinSeconds = Math.max(0.1, Math.min(changeMinSeconds, changeMaxSeconds))
    this.changeMaxSeconds = Math.max(this.changeMinSeconds, changeMinSeconds, changeMaxSeconds)
    this.tau = Math.max(0.05, transitionSeconds / 3)
    // Keep an in-flight target inside any freshly narrowed bounds.
    this.target = Math.min(this.max, Math.max(this.min, this.target))
  }

  _nextIntervalMs() {
    return (this.changeMinSeconds + Math.random() * (this.changeMaxSeconds - this.changeMinSeconds)) * 1000
  }

  // Value sits near `bias` most of the time, wandering out toward the
  // extremes only occasionally - and toward whichever side has more room, so
  // an off-center bias still reaches both ends. Math.pow(random, 1.7) skews
  // the pick toward small deviations from the bias. `fullyRandom` drops all
  // of that and picks uniformly across the whole axis.
  _pickTarget() {
    if (this.fullyRandom) {
      return this.min + Math.random() * (this.max - this.min)
    }
    return pickBiasedValue(this.min, this.max, this.bias)
  }

  start() {
    if (this.running || !this.enabled) return
    this.running = true
    this.value = this.bias
    this.target = this.bias
    this._lastTick = performance.now()
    this._nextChangeAt = this._lastTick + this._nextIntervalMs()
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
      this._nextChangeAt = now + this._nextIntervalMs()
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
// feature), a pre-v0.1.176 percentage-based object, and an explicit
// disabled/neutral object must all round-trip to a stable shape.
export function normalizeFluctuationAxis(axis, neutral) {
  const timing = resolveFluctuationTiming(axis)
  return {
    enabled: Boolean(axis?.enabled),
    fullyRandom: Boolean(axis?.fullyRandom),
    min: Number.isFinite(axis?.min) ? axis.min : neutral,
    max: Number.isFinite(axis?.max) ? axis.max : neutral,
    bias: Number.isFinite(axis?.bias) ? axis.bias : neutral,
    changeMinSeconds: timing.changeMinSeconds,
    changeMaxSeconds: timing.changeMaxSeconds,
    transitionSeconds: timing.transitionSeconds
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
    this.volMod = new Modulator({ onValue: onVolume, neutral: 1, rangeMin: 0, rangeMax: 1 })
    this.pitchMod = new Modulator({
      onValue: onPitch,
      neutral: 0,
      rangeMin: -FLUCTUATION_PITCH_RANGE,
      rangeMax: FLUCTUATION_PITCH_RANGE
    })
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
