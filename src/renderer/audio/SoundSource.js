import log from 'electron-log/renderer'

const RAMP_SECONDS = 0.15
const LOOP_EPSILON_SECONDS = 0.03
// Matches plugins/editor/audio/PreviewSource.js's live-drag smoothing, so a
// filter change saved in Remix updates an already-playing Mixer sound with
// the same feel as dragging the slider live in the Remix preview itself.
const FILTER_SMOOTHING_SECONDS = 0.01
// Upper bound a Web Audio DelayNode must declare at creation time - well
// above the Remix slider's max (see plugins/editor/index.js) so the delay
// time can never need a value the node wasn't built to hold.
const MAX_ECHO_DELAY_SECONDS = 2.0

// How long a 'waiting'/stalled <audio> element gets before this treats it as
// a real problem rather than normal, brief re-buffering. See the 'waiting'
// listener below for why this exists at all: the sound:// stream (hand-
// rolled HTTP Range serving over fs.createReadStream, see src/main/index.js)
// had zero error handling, and the <audio> element had zero stall/error
// listeners - so a transient I/O hiccup on a long streaming session could
// silently stop a sound with nothing in the app ever noticing, matching a
// user report of playback going quiet then sometimes recovering on its own
// (accidental browser retry behavior, not anything this app did on purpose).
const STALL_RECOVERY_DELAY_MS = 8000
const MAX_RECOVERY_ATTEMPTS = 3

// 'off' is a pseudo-type (not a real BiquadFilterNode type) - see the
// eqNodes comment in the constructor below for why 'allpass' is the right
// stand-in. Shared by both construction and live updates (setFilters) so
// they can't drift.
function eqNodeType(type) {
  return type === 'off' ? 'allpass' : (type ?? 'peaking')
}

export class LocalFileSoundSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume, filters, speed }) {
    this.engine = engine
    this.soundId = soundId
    this.loopStart = loopStart ?? 0
    this.loopEnd = loopEnd ?? null
    this.volume = volume
    this.playing = false
    this._rafId = null
    this._pauseTimeoutId = null
    this._stallTimeoutId = null
    this._recoveryAttempts = 0

    this.audioEl = new Audio()
    this.audioEl.crossOrigin = 'anonymous'
    this.audioEl.preload = 'auto'
    this.audioEl.src = `sound://${soundId}`
    // Speed is the only speed/pitch/reverse control applied to stream mode -
    // playbackRate maps to it directly, and the browser's own default
    // preservesPitch=true keeps this a pure tempo change. Pitch and reverse
    // need real DSP (rubberband/areverse) that only exists on the ffmpeg
    // side (see loopClip.js), so they only take effect once a sound is
    // baked into a buffer-mode clip - a real, documented gap for sounds too
    // long to bake, same category as buffer mode's other seam-smoothness-
    // only advantages over streaming.
    this.speed = speed ?? 1
    this.audioEl.playbackRate = this.speed
    this._bindRecoveryListeners()

    this.sourceNode = engine.context.createMediaElementSource(this.audioEl)

    // Same highpass -> lowpass -> gain chain as the Remix plugin's preview
    // (plugins/editor/audio/PreviewSource.js), so saved filters are audible
    // in the Mixer even for sounds too long to qualify for a baked buffer
    // clip. Loop-clip eligibility only affects seam smoothness, never
    // whether filters apply.
    this.filters = filters ?? {}

    this.highpassNode = engine.context.createBiquadFilter()
    this.highpassNode.type = 'highpass'
    this.highpassNode.frequency.value = this.filters.highpassHz ?? 0

    this.lowpassNode = engine.context.createBiquadFilter()
    this.lowpassNode.type = 'lowpass'
    this.lowpassNode.frequency.value = this.filters.lowpassHz ?? 20000

    // Parametric EQ: a fixed chain of BiquadFilterNodes, one per saved band
    // (see library.js's defaultEqBands), each independently one of Web
    // Audio's native filter types - a lucky architecture fit, since
    // BiquadFilterNode's own type set (lowpass/highpass/bandpass/lowshelf/
    // highshelf/peaking/notch/allpass) already covers 7 of the real FL
    // Studio "Fruity Parametric EQ 2" reference's 8 shapes directly. 'off'
    // (the 8th, a pseudo-type - see eqNodeType) maps to 'allpass', which
    // leaves the amplitude spectrum completely unchanged - a true no-op for
    // tone-shaping without needing to dynamically rewire this fixed chain
    // per band. A peaking/lowshelf/highshelf band left at its default
    // gainDb:0 is also a true no-op regardless of type, matching every
    // other 0/neutral-means-off control here - but lowpass/highpass/
    // bandpass/notch have no gain parameter at all and always shape the
    // signal whenever selected, they're never "neutral." Inserted between
    // lowpass and the overall filter gain, same position ffmpeg's bake
    // applies them (see loopClip.js's buildFilterChain) so live playback
    // and the baked clip agree.
    this.eqNodes = (this.filters.eq ?? []).map((band) => {
      const node = engine.context.createBiquadFilter()
      node.type = eqNodeType(band.type)
      node.frequency.value = band.freqHz
      node.Q.value = band.q
      node.gain.value = band.gainDb
      return node
    })

    this.filterGainNode = engine.context.createGain()
    this.filterGainNode.gain.value = this.filters.gainDb ? Math.pow(10, this.filters.gainDb / 20) : 1

    // Echo: a feedback delay line tapped in parallel off the filtered (dry)
    // signal. echoSendGain controls how much signal enters the delay loop
    // at all (0 = no echo, matching how highpassHz=0 means "off" for that
    // band); echoFeedbackGain attenuates each pass back through the delay,
    // so a single (delayMs, decay) pair naturally produces a decaying train
    // of repeats rather than one fixed echo - tied to the same value as
    // echoSendGain so "how loud the echo enters" and "how long it persists"
    // scale together from one user-facing knob (see the Remix preset UI).
    this.echoDelayNode = engine.context.createDelay(MAX_ECHO_DELAY_SECONDS)
    this.echoDelayNode.delayTime.value = (this.filters.echoDelayMs ?? 0) / 1000

    this.echoSendGain = engine.context.createGain()
    this.echoSendGain.gain.value = this.filters.echoDecay ?? 0

    this.echoFeedbackGain = engine.context.createGain()
    this.echoFeedbackGain.gain.value = this.filters.echoDecay ?? 0

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0

    this.sourceNode.connect(this.highpassNode)
    this.highpassNode.connect(this.lowpassNode)
    const eqChainEnd = this.eqNodes.reduce((prev, node) => {
      prev.connect(node)
      return node
    }, this.lowpassNode)
    eqChainEnd.connect(this.filterGainNode)
    this.filterGainNode.connect(this.gainNode)

    this.filterGainNode.connect(this.echoSendGain)
    this.echoSendGain.connect(this.echoDelayNode)
    this.echoDelayNode.connect(this.echoFeedbackGain)
    this.echoFeedbackGain.connect(this.echoDelayNode)
    this.echoDelayNode.connect(this.gainNode)

    this.gainNode.connect(engine.masterGain)
  }

  // 'waiting' fires whenever playback runs out of buffered data - this is
  // completely normal for a second or two while streaming catches up, so
  // this only acts if it's still stalled after STALL_RECOVERY_DELAY_MS with
  // no 'playing' event cancelling the timer in between. 'error' recovers
  // immediately, no delay - a real media error isn't going to resolve itself
  // by waiting.
  _bindRecoveryListeners() {
    this.audioEl.addEventListener('waiting', () => {
      if (!this.playing || this._stallTimeoutId) return
      this._stallTimeoutId = setTimeout(() => {
        this._stallTimeoutId = null
        log.warn(`Sound ${this.soundId} stalled for ${STALL_RECOVERY_DELAY_MS}ms, attempting recovery`)
        this._recover()
      }, STALL_RECOVERY_DELAY_MS)
    })

    this.audioEl.addEventListener('playing', () => {
      if (this._stallTimeoutId) {
        clearTimeout(this._stallTimeoutId)
        this._stallTimeoutId = null
      }
      // A sustained resume is a good sign the stream is healthy again -
      // don't let one bad patch permanently eat into the retry budget for
      // an otherwise long, mostly-fine listening session.
      this._recoveryAttempts = 0
    })

    this.audioEl.addEventListener('error', () => {
      log.error(`Sound ${this.soundId} audio element error`, this.audioEl.error)
      if (this.playing) this._recover()
    })
  }

  async _recover() {
    if (!this.playing) return
    if (this._recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      log.error(`Sound ${this.soundId} gave up after ${MAX_RECOVERY_ATTEMPTS} recovery attempts`)
      return
    }
    this._recoveryAttempts += 1
    const resumeAt = this.audioEl.currentTime
    log.info(`Sound ${this.soundId} recovery attempt ${this._recoveryAttempts}, resuming at ${resumeAt.toFixed(2)}s`)
    try {
      this.audioEl.load()
      this.audioEl.currentTime = resumeAt
      await this.audioEl.play()
      log.info(`Sound ${this.soundId} recovery attempt ${this._recoveryAttempts} succeeded`)
    } catch (err) {
      log.error(`Sound ${this.soundId} recovery attempt ${this._recoveryAttempts} failed`, err)
    }
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

  hasLoopPoints(loopStart, loopEnd) {
    return this.loopStart === loopStart && this.loopEnd === loopEnd
  }

  // Bug fix: an already-playing sound's filters were only ever set once, at
  // construction time - saving new filters in the Remix plugin updated the
  // library entry, and the Mixer's onShow refresh picked up the new value
  // into state.library, but the already-created LocalFileSoundSource for a
  // sound already in the mix (playing OR just paused - getOrCreateSource
  // reuses any cached source regardless of pause state) kept its original,
  // now-stale filter nodes forever, since nothing ever called back into it.
  // This is the live-update counterpart to that construction-time setup,
  // called from the Mixer's refresh reconciliation once it detects the
  // entry's filters no longer match what this source is actually playing.
  setFilters(filters) {
    this.filters = filters ?? {}
    const now = this.engine.context.currentTime
    this.highpassNode.frequency.setTargetAtTime(this.filters.highpassHz ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.lowpassNode.frequency.setTargetAtTime(this.filters.lowpassHz ?? 20000, now, FILTER_SMOOTHING_SECONDS)
    this.filterGainNode.gain.setTargetAtTime(this.filters.gainDb ? Math.pow(10, this.filters.gainDb / 20) : 1, now, FILTER_SMOOTHING_SECONDS)
    this.echoDelayNode.delayTime.setTargetAtTime((this.filters.echoDelayMs ?? 0) / 1000, now, FILTER_SMOOTHING_SECONDS)
    this.echoSendGain.gain.setTargetAtTime(this.filters.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.echoFeedbackGain.gain.setTargetAtTime(this.filters.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)
    // The EQ chain's node count is fixed at construction time (one per band
    // in the filters this source was built with) - only ever updated in
    // place here, never resized, since every sound always has the same
    // fixed band count (see library.js's defaultEqBands).
    const eq = this.filters.eq ?? []
    this.eqNodes.forEach((node, i) => {
      const band = eq[i]
      if (!band) return
      // .type isn't an AudioParam - a plain property, so it can't be smoothed
      // like the others below. Only actually reassigned when it changes,
      // since setting it unconditionally every call would reset the filter's
      // internal state (a small click) even when nothing changed.
      const newType = eqNodeType(band.type)
      if (node.type !== newType) node.type = newType
      node.frequency.setTargetAtTime(band.freqHz, now, FILTER_SMOOTHING_SECONDS)
      node.Q.setTargetAtTime(band.q, now, FILTER_SMOOTHING_SECONDS)
      node.gain.setTargetAtTime(band.gainDb, now, FILTER_SMOOTHING_SECONDS)
    })
  }

  hasFilters(filters) {
    return JSON.stringify(this.filters ?? {}) === JSON.stringify(filters ?? {})
  }

  setSpeed(speed) {
    this.speed = speed ?? 1
    this.audioEl.playbackRate = this.speed
  }

  hasSpeed(speed) {
    return this.speed === (speed ?? 1)
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
    if (this._stallTimeoutId) {
      clearTimeout(this._stallTimeoutId)
      this._stallTimeoutId = null
    }
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
    if (this._stallTimeoutId) clearTimeout(this._stallTimeoutId)
    this.audioEl.pause()
    this.audioEl.removeAttribute('src')
    this.audioEl.load()
    this.sourceNode.disconnect()
    this.highpassNode.disconnect()
    this.lowpassNode.disconnect()
    for (const node of this.eqNodes) node.disconnect()
    this.filterGainNode.disconnect()
    this.echoDelayNode.disconnect()
    this.echoSendGain.disconnect()
    this.echoFeedbackGain.disconnect()
    this.gainNode.disconnect()
  }
}
