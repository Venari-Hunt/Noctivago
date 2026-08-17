import log from 'electron-log/renderer'

const RAMP_SECONDS = 0.15
// Matches the Remix plugin's Pitch slider range (plugins/editor/index.js) -
// reused here as the "roll anywhere in the normal range" default for the
// explicit "both bounds at 0 means fully random, not disabled" case (see
// scatter config below), so a freshly-enabled scatter sound with untouched
// pitch controls sounds obviously varied rather than silently doing nothing.
const DEFAULT_PITCH_RANGE_SEMITONES = 12
const DEFAULT_MIN_GAP_SECONDS = 5
const DEFAULT_MAX_GAP_SECONDS = 35

// Game-engine "scattered ambience emitter" pattern (Wwise Random Container /
// FMOD Scatterer Instrument / Unity Audio Random Container) - re-triggers a
// short clip on a randomized gap instead of looping it back-to-back, with a
// randomized pitch each time. Shared by both scatter source variants below.
function randomGapSeconds(scatter) {
  const min = Math.max(0, scatter?.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS)
  const max = Math.max(min, scatter?.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS)
  return min + Math.random() * (max - min)
}

function randomPitchSemitones(scatter) {
  let min = scatter?.minPitchSemitones ?? 0
  let max = scatter?.maxPitchSemitones ?? 0
  // Explicit user-requested special case: both bounds left at their neutral
  // default means "fully random," not "no pitch variation" - matches how
  // this feature was scoped (see noctivago_task_list memory / Board.md).
  if (min === 0 && max === 0) {
    min = -DEFAULT_PITCH_RANGE_SEMITONES
    max = DEFAULT_PITCH_RANGE_SEMITONES
  }
  if (max < min) max = min
  return min + Math.random() * (max - min)
}

function normalizeScatter(scatter) {
  return JSON.stringify({
    minGapSeconds: scatter?.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS,
    maxGapSeconds: scatter?.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS,
    minPitchSemitones: scatter?.minPitchSemitones ?? 0,
    maxPitchSemitones: scatter?.maxPitchSemitones ?? 0
  })
}

// Buffer variant: plays a small, already-baked (trimmed+filtered, no
// crossfade - see library.js's effectiveCrossfadeSeconds) AudioBuffer via a
// fresh AudioBufferSourceNode per shot. Pitch randomization uses the node's
// native `detune` param (cents) rather than playbackRate - true independent
// pitch shift with no effect on shot duration or the gap timer, a nicer
// primitive than the playbackRate-linked pitch/tempo coupling most game
// engines settle for (they're typically driving non-web audio backends that
// don't expose an equivalent). Mirrors BufferSoundSource's structure.
export class BufferScatterSource {
  constructor(engine, { audioBuffer, volume, scatter }) {
    this.engine = engine
    this.audioBuffer = audioBuffer
    this.volume = volume
    this.scatter = scatter ?? {}
    this.playing = false
    this.currentNode = null
    this._timeoutId = null
    this._stopTimeoutId = null

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0
    this.gainNode.connect(engine.masterGain)
  }

  waitForMetadata() {
    return Promise.resolve(this.audioBuffer.duration)
  }

  // No-op: loop bounds are baked into the clip at render time, same as
  // BufferSoundSource - trim edits always go through Save -> re-render.
  setLoopPoints() {}

  setScatterConfig(scatter) {
    this.scatter = scatter ?? {}
  }

  hasScatterConfig(scatter) {
    return normalizeScatter(this.scatter) === normalizeScatter(scatter)
  }

  _scheduleNext() {
    this._timeoutId = setTimeout(() => this._playOneShot(), randomGapSeconds(this.scatter) * 1000)
  }

  _playOneShot() {
    this._timeoutId = null
    if (!this.playing) return
    const node = this.engine.context.createBufferSource()
    node.buffer = this.audioBuffer
    node.detune.value = randomPitchSemitones(this.scatter) * 100
    node.connect(this.gainNode)
    node.onended = () => {
      if (node !== this.currentNode) return
      this.currentNode = null
      if (this.playing) this._scheduleNext()
    }
    node.start()
    this.currentNode = node
  }

  async play() {
    if (this.playing) return
    this.playing = true
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this._playOneShot()
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    if (this._timeoutId) {
      clearTimeout(this._timeoutId)
      this._timeoutId = null
    }
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)

    const node = this.currentNode
    this.currentNode = null
    if (node) {
      node.onended = null
      if (this._stopTimeoutId) clearTimeout(this._stopTimeoutId)
      this._stopTimeoutId = setTimeout(() => {
        this._stopTimeoutId = null
        try {
          node.stop()
        } catch {
          // already stopped
        }
        node.disconnect()
      }, RAMP_SECONDS * 1000 + 20)
    }
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
    if (this._timeoutId) clearTimeout(this._timeoutId)
    if (this._stopTimeoutId) clearTimeout(this._stopTimeoutId)
    if (this.currentNode) {
      this.currentNode.onended = null
      try {
        this.currentNode.stop()
      } catch {
        // already stopped
      }
      this.currentNode.disconnect()
      this.currentNode = null
    }
    this.gainNode.disconnect()
  }
}

// Stream variant: fallback for a scatter-mode sound whose trim doesn't (yet,
// or ever will) qualify for a baked clip - e.g. a trim longer than
// MAX_BUFFER_CLIP_SECONDS. Plays the [loopStart, loopEnd) region of the
// original file once per shot via a plain <audio> element (same sound://
// streaming LocalFileSoundSource uses, so it works for a file of any
// length), through the same highpass/lowpass/gain/echo chain so saved
// filters still apply exactly like every other source in this app. Pitch
// randomization uses playbackRate (no detune equivalent on <audio>), so -
// same documented limitation as Speed/Pitch elsewhere in this codebase - a
// pitch shift here also changes shot duration/tempo, which incidentally
// matches how most game engines actually implement this (Unity's own
// AudioSource.pitch is exactly a playback-rate scalar), just not how the
// buffer variant above does it.
export class StreamScatterSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume, filters, scatter }) {
    this.engine = engine
    this.soundId = soundId
    this.loopStart = loopStart ?? 0
    this.loopEnd = loopEnd ?? null
    this.volume = volume
    this.scatter = scatter ?? {}
    this.playing = false
    this._timeoutId = null
    this._onShotProgress = this._onShotProgress.bind(this)

    this.audioEl = new Audio()
    this.audioEl.crossOrigin = 'anonymous'
    this.audioEl.preload = 'auto'
    this.audioEl.src = `sound://${soundId}`
    this.audioEl.addEventListener('error', () => {
      log.error(`Scatter sound ${this.soundId} audio element error`, this.audioEl.error)
    })

    this.sourceNode = engine.context.createMediaElementSource(this.audioEl)

    this.filters = filters ?? {}
    this.highpassNode = engine.context.createBiquadFilter()
    this.highpassNode.type = 'highpass'
    this.highpassNode.frequency.value = this.filters.highpassHz ?? 0

    this.lowpassNode = engine.context.createBiquadFilter()
    this.lowpassNode.type = 'lowpass'
    this.lowpassNode.frequency.value = this.filters.lowpassHz ?? 20000

    this.filterGainNode = engine.context.createGain()
    this.filterGainNode.gain.value = this.filters.gainDb ? Math.pow(10, this.filters.gainDb / 20) : 1

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

  hasLoopPoints(loopStart, loopEnd) {
    return this.loopStart === loopStart && this.loopEnd === loopEnd
  }

  setFilters(filters) {
    this.filters = filters ?? {}
    const now = this.engine.context.currentTime
    this.highpassNode.frequency.setTargetAtTime(this.filters.highpassHz ?? 0, now, 0.01)
    this.lowpassNode.frequency.setTargetAtTime(this.filters.lowpassHz ?? 20000, now, 0.01)
    this.filterGainNode.gain.setTargetAtTime(this.filters.gainDb ? Math.pow(10, this.filters.gainDb / 20) : 1, now, 0.01)
  }

  hasFilters(filters) {
    return JSON.stringify(this.filters ?? {}) === JSON.stringify(filters ?? {})
  }

  setScatterConfig(scatter) {
    this.scatter = scatter ?? {}
  }

  hasScatterConfig(scatter) {
    return normalizeScatter(this.scatter) === normalizeScatter(scatter)
  }

  _loopEnd() {
    return this.loopEnd ?? this.audioEl.duration
  }

  // Detects shot-end via the <audio> element's own native events rather than
  // a requestAnimationFrame polling loop. rAF is driven by the visual frame
  // clock, which Chromium throttles to near-zero (confirmed via a live debug
  // session: 1 callback total over a 2.5s window) once the window is hidden
  // or unfocused - exactly the normal state for an ambient background-sound
  // app. `timeupdate`/`pause`/`ended` are driven by the media element's own
  // playback clock instead, which keeps running so background audio keeps
  // working - so shot-end detection now does too.
  _onShotProgress() {
    if (!this.playing) return
    const end = this._loopEnd()
    if (this.audioEl.paused || (Number.isFinite(end) && this.audioEl.currentTime >= end - 0.03)) {
      this._stopWatchingShotEnd()
      this.audioEl.pause()
      this._timeoutId = setTimeout(() => this._playOneShot(), randomGapSeconds(this.scatter) * 1000)
    }
  }

  _watchForShotEnd() {
    this.audioEl.addEventListener('timeupdate', this._onShotProgress)
    this.audioEl.addEventListener('pause', this._onShotProgress)
    this.audioEl.addEventListener('ended', this._onShotProgress)
  }

  _stopWatchingShotEnd() {
    this.audioEl.removeEventListener('timeupdate', this._onShotProgress)
    this.audioEl.removeEventListener('pause', this._onShotProgress)
    this.audioEl.removeEventListener('ended', this._onShotProgress)
  }

  async _playOneShot() {
    this._timeoutId = null
    if (!this.playing) return
    this.audioEl.playbackRate = Math.pow(2, randomPitchSemitones(this.scatter) / 12)
    this.audioEl.currentTime = this.loopStart
    try {
      await this.audioEl.play()
    } catch (err) {
      log.error(`Scatter sound ${this.soundId} failed to start a shot`, err)
      if (this.playing) this._timeoutId = setTimeout(() => this._playOneShot(), randomGapSeconds(this.scatter) * 1000)
      return
    }
    if (!this.playing) return
    this._watchForShotEnd()
  }

  async play() {
    if (this.playing) return
    this.playing = true
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    await this._playOneShot()
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    if (this._timeoutId) {
      clearTimeout(this._timeoutId)
      this._timeoutId = null
    }
    this._stopWatchingShotEnd()
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)
    setTimeout(() => this.audioEl.pause(), RAMP_SECONDS * 1000 + 20)
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
    if (this._timeoutId) clearTimeout(this._timeoutId)
    this._stopWatchingShotEnd()
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
