const RAMP_SECONDS = 0.15
const LOOP_EPSILON_SECONDS = 0.03
const FILTER_SMOOTHING_SECONDS = 0.01
// Matches src/renderer/audio/SoundSource.js's core-playback copy of this
// same echo design - see that file for the full rationale (feedback delay
// tapped off the dry signal, one knob driving both send and feedback gain).
const MAX_ECHO_DELAY_SECONDS = 2.0

// One playback "voice": its own <audio> element and full filter chain, so
// two voices can play simultaneously and be crossfaded against each other -
// see PreviewSource's _tick()/_startCrossfade() for how they're driven.
// Each voice has its own crossfadeGain, separate from PreviewSource's
// shared outputGainNode (which only ever handles the overall Play/Pause
// envelope) - that separation is what lets two voices overlap smoothly at
// a loop seam without fighting the volume ramp.
function createVoice(engine, soundId) {
  const audioEl = new Audio()
  audioEl.crossOrigin = 'anonymous'
  audioEl.preload = 'auto'
  audioEl.src = `sound://${soundId}`

  const sourceNode = engine.context.createMediaElementSource(audioEl)

  const highpassNode = engine.context.createBiquadFilter()
  highpassNode.type = 'highpass'
  highpassNode.frequency.value = 0

  const lowpassNode = engine.context.createBiquadFilter()
  lowpassNode.type = 'lowpass'
  lowpassNode.frequency.value = 20000

  const filterGainNode = engine.context.createGain()
  filterGainNode.gain.value = 1

  const echoDelayNode = engine.context.createDelay(MAX_ECHO_DELAY_SECONDS)
  echoDelayNode.delayTime.value = 0

  const echoSendGain = engine.context.createGain()
  echoSendGain.gain.value = 0

  const echoFeedbackGain = engine.context.createGain()
  echoFeedbackGain.gain.value = 0

  const crossfadeGain = engine.context.createGain()
  crossfadeGain.gain.value = 0

  sourceNode.connect(highpassNode)
  highpassNode.connect(lowpassNode)
  lowpassNode.connect(filterGainNode)
  filterGainNode.connect(crossfadeGain)

  filterGainNode.connect(echoSendGain)
  echoSendGain.connect(echoDelayNode)
  echoDelayNode.connect(echoFeedbackGain)
  echoFeedbackGain.connect(echoDelayNode)
  echoDelayNode.connect(crossfadeGain)

  return { audioEl, sourceNode, highpassNode, lowpassNode, filterGainNode, echoDelayNode, echoSendGain, echoFeedbackGain, crossfadeGain }
}

function applyFiltersToVoice(voice, context, { highpassHz, lowpassHz, gainDb, echoDelayMs = 0, echoDecay = 0 }) {
  const now = context.currentTime
  voice.highpassNode.frequency.setTargetAtTime(highpassHz, now, FILTER_SMOOTHING_SECONDS)
  voice.lowpassNode.frequency.setTargetAtTime(lowpassHz, now, FILTER_SMOOTHING_SECONDS)
  voice.filterGainNode.gain.setTargetAtTime(Math.pow(10, gainDb / 20), now, FILTER_SMOOTHING_SECONDS)
  voice.echoDelayNode.delayTime.setTargetAtTime(echoDelayMs / 1000, now, FILTER_SMOOTHING_SECONDS)
  voice.echoSendGain.gain.setTargetAtTime(echoDecay, now, FILTER_SMOOTHING_SECONDS)
  voice.echoFeedbackGain.gain.setTargetAtTime(echoDecay, now, FILTER_SMOOTHING_SECONDS)
}

function disposeVoice(voice) {
  voice.audioEl.pause()
  voice.audioEl.removeAttribute('src')
  voice.audioEl.load()
  voice.sourceNode.disconnect()
  voice.highpassNode.disconnect()
  voice.lowpassNode.disconnect()
  voice.filterGainNode.disconnect()
  voice.echoDelayNode.disconnect()
  voice.echoSendGain.disconnect()
  voice.echoFeedbackGain.disconnect()
  voice.crossfadeGain.disconnect()
}

// Streams a sound for editing preview (same sound://<id> streaming approach
// as core's LocalFileSoundSource, so this works for files of any length)
// with an insertable live filter chain per voice: source -> highpass ->
// lowpass -> gain -> output. Filter params update instantly via
// BiquadFilterNode/GainNode automation, so dragging a slider gives
// real-time audible feedback with no ffmpeg round-trip - ffmpeg only runs
// once, to bake the final values in when the user saves.
//
// Simulates the loop-boundary crossfade the ffmpeg bake applies (see
// src/main/ffmpeg/loopClip.js) by ping-ponging between two identical voices:
// as the active voice nears loopEnd, the other voice starts playing from
// loopStart and both are cross-faded via their own crossfadeGain nodes,
// so dragging the crossfade slider is audible immediately instead of
// requiring a bake-then-listen round trip. This is only an approximation of
// the baked result - <audio> elements aren't sample-accurate the way the
// ffmpeg render or a decoded AudioBuffer are (same caveat stream-mode
// playback has everywhere else in this app) - good enough to judge "does
// this duration sound right," not a substitute for the real bake.
export class PreviewSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume, looping = true, crossfadeSeconds = 0 }) {
    this.engine = engine
    this.loopStart = loopStart ?? 0
    this.loopEnd = loopEnd ?? null
    this.volume = volume
    this.looping = looping
    this.crossfadeSeconds = crossfadeSeconds
    this.playing = false
    this._rafId = null
    this._pauseTimeoutId = null
    this._crossfading = false

    this.voices = [createVoice(engine, soundId), createVoice(engine, soundId)]
    this.activeIndex = 0
    this.voices[0].crossfadeGain.gain.value = 1

    this.outputGainNode = engine.context.createGain()
    this.outputGainNode.gain.value = 0
    for (const voice of this.voices) voice.crossfadeGain.connect(this.outputGainNode)
    this.outputGainNode.connect(engine.masterGain)
  }

  // LoopEditor's playhead tracking and manual currentTime pokes only ever
  // touch whichever voice is currently active - this getter (rather than
  // renaming every external caller) keeps PreviewSource a drop-in
  // replacement for the single-<audio> version it replaced.
  get audioEl() {
    return this.voices[this.activeIndex].audioEl
  }

  _inactiveVoice() {
    return this.voices[1 - this.activeIndex]
  }

  waitForMetadata() {
    const el = this.voices[0].audioEl
    if (el.readyState >= 1) return Promise.resolve(el.duration)
    return new Promise((resolve) => {
      el.addEventListener('loadedmetadata', () => resolve(el.duration), { once: true })
    })
  }

  setLoopPoints(loopStart, loopEnd) {
    this.loopStart = loopStart
    this.loopEnd = loopEnd
    this._resetToSingleVoice()
  }

  setLooping(looping) {
    this.looping = looping
    if (!looping) this._resetToSingleVoice()
  }

  setCrossfadeSeconds(seconds) {
    this.crossfadeSeconds = seconds
  }

  setFilters(filters) {
    for (const voice of this.voices) applyFiltersToVoice(voice, this.engine.context, filters)
  }

  // Cancels any in-progress crossfade and collapses back to a single active
  // voice - used whenever loop points change or scrubbing happens, since
  // resuming a crossfade against a moved boundary (or a manually-moved
  // playhead) has no sensible meaning.
  _resetToSingleVoice() {
    const now = this.engine.context.currentTime
    const active = this.voices[this.activeIndex]
    const inactive = this._inactiveVoice()
    active.crossfadeGain.gain.cancelScheduledValues(now)
    active.crossfadeGain.gain.setValueAtTime(1, now)
    inactive.crossfadeGain.gain.cancelScheduledValues(now)
    inactive.crossfadeGain.gain.setValueAtTime(0, now)
    if (this._crossfading) inactive.audioEl.pause()
    this._crossfading = false
  }

  scrubTo(t) {
    this._resetToSingleVoice()
    this.voices[this.activeIndex].audioEl.currentTime = t
  }

  _loopEnd() {
    return this.loopEnd ?? this.voices[0].audioEl.duration
  }

  _effectiveCrossfade() {
    const duration = this._loopEnd() - this.loopStart
    if (!Number.isFinite(duration) || duration <= 0) return 0
    return Math.max(0, Math.min(this.crossfadeSeconds, duration / 4))
  }

  _tick() {
    if (!this.playing) return
    const active = this.voices[this.activeIndex]
    const end = this._loopEnd()
    const fade = this.looping ? this._effectiveCrossfade() : 0

    if (!this.looping) {
      if (Number.isFinite(end) && active.audioEl.currentTime >= end - LOOP_EPSILON_SECONDS) {
        this.pause()
        this.onEnded?.()
        return
      }
    } else if (fade <= 0) {
      // No usable crossfade window (disabled, or too short a loop) - same
      // hard seek-back every other playback mode in this app falls back to.
      if (Number.isFinite(end) && active.audioEl.currentTime >= end - LOOP_EPSILON_SECONDS) {
        active.audioEl.currentTime = this.loopStart
      }
    } else if (!this._crossfading) {
      if (Number.isFinite(end) && active.audioEl.currentTime >= end - fade) {
        this._startCrossfade(fade)
      }
    } else if (Number.isFinite(end) && active.audioEl.currentTime >= end - LOOP_EPSILON_SECONDS) {
      this._finishCrossfade()
    }

    this._rafId = requestAnimationFrame(() => this._tick())
  }

  _startCrossfade(fade) {
    const active = this.voices[this.activeIndex]
    const incoming = this._inactiveVoice()
    const now = this.engine.context.currentTime

    incoming.audioEl.currentTime = this.loopStart
    incoming.audioEl.play().catch(() => {})

    active.crossfadeGain.gain.cancelScheduledValues(now)
    active.crossfadeGain.gain.setValueAtTime(1, now)
    active.crossfadeGain.gain.linearRampToValueAtTime(0, now + fade)

    incoming.crossfadeGain.gain.cancelScheduledValues(now)
    incoming.crossfadeGain.gain.setValueAtTime(0, now)
    incoming.crossfadeGain.gain.linearRampToValueAtTime(1, now + fade)

    this._crossfading = true
  }

  _finishCrossfade() {
    const outgoing = this.voices[this.activeIndex]
    outgoing.audioEl.pause()
    this.activeIndex = 1 - this.activeIndex
    this._crossfading = false
  }

  async play() {
    if (this.playing) return
    if (this._pauseTimeoutId) {
      clearTimeout(this._pauseTimeoutId)
      this._pauseTimeoutId = null
    }
    const active = this.voices[this.activeIndex]
    const end = this._loopEnd()
    if (active.audioEl.currentTime < this.loopStart || (Number.isFinite(end) && active.audioEl.currentTime >= end)) {
      active.audioEl.currentTime = this.loopStart
    }
    active.crossfadeGain.gain.setValueAtTime(1, this.engine.context.currentTime)
    await active.audioEl.play()
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
      for (const voice of this.voices) voice.audioEl.pause()
      this._resetToSingleVoice()
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
    for (const voice of this.voices) disposeVoice(voice)
    this.outputGainNode.disconnect()
  }
}
