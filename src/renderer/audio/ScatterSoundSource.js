import log from 'electron-log/renderer'
import { pitchShiftBuffer } from './pitchStretch.js'
import { createStreamFilterChain, updateStreamFilterChain, disposeStreamFilterChain } from './StreamFilterChain.js'
import { randomGapSeconds, randomPitchSemitones, randomVolumeScale, randomPanPosition, randomSpeedFactor, fadeSeconds, scheduleShotEnvelope, scatterKey } from '../../shared/shotRules.js'
import { PanStage } from './PanStage.js'

const RAMP_SECONDS = 0.15
// Buffer variant: plays a small, already-baked (trimmed+filtered, no
// crossfade - see library.js's effectiveCrossfadeSeconds) AudioBuffer via a
// fresh AudioBufferSourceNode per shot. Per-shot random pitch is applied by
// pre-stretching the clip (pitchStretch.js) and then playing it back through
// the node's `detune` at the matching ratio, so the shot keeps the length it
// was trimmed to regardless of pitch (v0.1.111 - before that, detune alone
// resampled, folding into computedPlaybackRate and making a pitched shot
// genuinely shorter/longer). Only a clip too long to stretch on the main
// thread falls back to the old resample-coupled behavior. Mirrors
// BufferSoundSource's structure otherwise.
export class BufferScatterSource {
  constructor(engine, { audioBuffer, volume, scatter, oneShot = false }) {
    this.engine = engine
    this.audioBuffer = audioBuffer
    this.volume = volume
    this.scatter = scatter ?? {}
    this.playing = false
    this.currentNode = null
    this.currentShotGain = null
    this._timeoutId = null
    this._stopTimeoutId = null
    // Test-fire mode (tabs/mixer/index.js's per-row "play one now" button
    // for a scatter sound not currently in the mix): plays exactly one shot
    // then calls onOneShotComplete instead of scheduling another - lets the
    // caller build a throwaway source, hear one shot, and dispose it without
    // ever touching state.included/state.playing, so there's nothing to
    // remove afterward. False (the normal, continuous-cycling default) for
    // every other caller.
    this.oneShot = oneShot
    this.onOneShotComplete = null
    // "Sync it up with" (tabs/mixer/index.js's propagateSync): fired once
    // per shot that actually started, unless that shot was itself a silent
    // sync-triggered fire from another group member (see fireNow/
    // _playOneShot's silent option) - that guard is what keeps a sync group
    // from cascading into an infinite ping-pong between its own members.
    this.onShotStart = null

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0
    this.gainNode.connect(engine.masterGain)
    // Per-play pan (v0.1.218) - only one shot plays at a time, so one stage
    // re-aimed at the start of each shot is enough.
    this.panStage = new PanStage(engine.context, 0)
    this.panStage.output.connect(this.gainNode)
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
    return scatterKey(this.scatter) === scatterKey(scatter)
  }

  _scheduleNext() {
    this._timeoutId = setTimeout(() => this._playOneShot(), randomGapSeconds(this.scatter) * 1000)
  }

  _playOneShot({ silent = false } = {}) {
    this._timeoutId = null
    if (!this.playing) return
    if (!silent) this.onShotStart?.()
    const node = this.engine.context.createBufferSource()
    const semitones = randomPitchSemitones(this.scatter)
    const speedFactor = randomSpeedFactor(this.scatter)
    node.detune.value = semitones * 100
    // Per-shot PITCH keeps the shot's trimmed length via a WSOLA pre-stretch
    // (v0.1.111): the clip is stretched by the pitch ratio, then `detune`
    // plays it back at that ratio - pitch moves, duration doesn't.
    //
    // Per-shot SPEED (v0.1.135) is applied as plain `playbackRate` varispeed -
    // it changes tempo/length and couples pitch along with it (like a tape
    // machine). It is deliberately NOT routed through the WSOLA time-stretch:
    // an aggressive time-compression there buzzes badly on broadband
    // transients (a sped-up thunderclap - the "loud synth-like noise"
    // reports; v0.1.172's narrow ratio guard didn't fully kill it, v0.1.175
    // takes speed off that path entirely).
    //
    // `pitchShiftBuffer` returns the buffer unchanged for a negligible shift,
    // and null for a clip too long to stretch on the main thread or a pitch
    // shift steeper than the WSOLA handles - in which case `detune` alone
    // resamples the pitch, which also speeds the shot up by the pitch ratio
    // (hence the pitchRatio term in the fallback duration below).
    //
    // `playbackRate = speedFactor` in both cases: with a valid pitch-stretched
    // buffer it's the only source of the speed change; on the resample
    // fallback it stacks on top of detune's own pitchRatio speed-up.
    const shifted = pitchShiftBuffer(this.engine.context, this.audioBuffer, semitones)
    node.buffer = shifted ?? this.audioBuffer
    node.playbackRate.value = speedFactor
    const durationSeconds = shifted
      ? this.audioBuffer.duration / speedFactor
      : this.audioBuffer.duration / (Math.pow(2, semitones / 12) * speedFactor)
    const shotGain = this.engine.context.createGain()
    node.connect(shotGain)
    this.panStage.setPan(randomPanPosition(this.scatter), { immediate: true })
    shotGain.connect(this.panStage.input)
    const target = randomVolumeScale(this.scatter)
    const { fadeInSeconds, fadeOutSeconds } = fadeSeconds(this.scatter, durationSeconds)
    scheduleShotEnvelope(shotGain.gain, target, this.engine.context.currentTime, durationSeconds, fadeInSeconds, fadeOutSeconds)
    node.onended = () => {
      if (node !== this.currentNode) return
      this.currentNode = null
      this.currentShotGain = null
      shotGain.disconnect()
      if (this.oneShot) {
        this.playing = false
        this.onOneShotComplete?.()
      } else if (this.playing) {
        this._scheduleNext()
      }
    }
    node.start()
    this.currentNode = node
    this.currentShotGain = shotGain
  }

  // The Mixer's per-row "test fire" button (tabs/mixer/index.js's
  // testFireOneShot, shared with scheduled mode). If already live, skips
  // whatever gap is currently pending and fires a shot right now - normal
  // continuous cycling resumes afterward via the usual _scheduleNext() path
  // once this shot ends, same as any other shot. If not currently playing
  // at all (the ephemeral, not-included-in-the-mix test-fire case), starts
  // the envelope and fires immediately - play() would do the same thing
  // here since scatter shots never wait before the first one, but fireNow()
  // covers this case explicitly so callers can treat it identically to
  // scheduled mode's fireNow(), whose play() *does* wait for the first
  // trigger and so genuinely needs this second branch.
  fireNow({ silent = false } = {}) {
    if (this.playing) {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId)
        this._timeoutId = null
      }
      this._playOneShot({ silent })
      return
    }
    this.playing = true
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this._playOneShot({ silent })
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
    const shotGain = this.currentShotGain
    this.currentNode = null
    this.currentShotGain = null
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
        shotGain?.disconnect()
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
      this.currentShotGain?.disconnect()
      this.currentShotGain = null
    }
    this.panStage.dispose()
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
// randomization uses playbackRate (no detune equivalent on <audio>, and no
// in-memory samples to pre-stretch the way the buffer variant does), so a
// pitch shift here still changes shot duration/tempo. This is now the *only*
// place per-shot pitch stays coupled to length - the common (baked) path
// keeps length constant (v0.1.111) - and it only bites a scatter trim long
// enough to never bake, which is unusual. Documented accepted limitation,
// same as Speed/Pitch elsewhere in this codebase.
export class StreamScatterSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume, filters, scatter, oneShot = false }) {
    this.engine = engine
    this.soundId = soundId
    this.loopStart = loopStart ?? 0
    this.loopEnd = loopEnd ?? null
    this.volume = volume
    this.scatter = scatter ?? {}
    this.playing = false
    this._timeoutId = null
    this._onShotProgress = this._onShotProgress.bind(this)
    // See BufferScatterSource's identical fields for the full rationale -
    // plays exactly one shot then calls onOneShotComplete instead of
    // scheduling another.
    this.oneShot = oneShot
    this.onOneShotComplete = null
    // See BufferScatterSource's identical field for the full rationale.
    this.onShotStart = null

    this.audioEl = new Audio()
    this.audioEl.crossOrigin = 'anonymous'
    this.audioEl.preload = 'auto'
    this.audioEl.src = `sound://${soundId}`
    this.audioEl.addEventListener('error', () => {
      log.error(`Scatter sound ${this.soundId} audio element error`, this.audioEl.error)
    })

    this.sourceNode = engine.context.createMediaElementSource(this.audioEl)

    // Per-shot fade in/out + volume-randomization envelope lives on its own
    // node, separate from gainNode's play/pause envelope below - the two
    // multiply together but are driven independently (this one resets every
    // shot, gainNode only ever moves on play()/pause()/setVolume()).
    this.shotGainNode = engine.context.createGain()
    this.shotGainNode.gain.value = 1

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0

    // highpass -> lowpass -> EQ -> gain -> [echo tap] -> [reverb tap], same
    // shape LocalFileSoundSource uses live - see StreamFilterChain.js for why
    // this needs to be explicit here (this class is the stream fallback, so
    // nothing is pre-baked the way BufferScatterSource's clip is).
    this._filterChain = createStreamFilterChain(engine.context, filters, this.shotGainNode)
    this.filters = this._filterChain.filters

    this.sourceNode.connect(this._filterChain.highpassNode)
    // Per-play pan (v0.1.218), after the filter chain's own static pan.
    this.panStage = new PanStage(engine.context, 0)
    this.shotGainNode.connect(this.panStage.input)
    this.panStage.output.connect(this.gainNode)
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
    updateStreamFilterChain(this._filterChain, filters)
    this.filters = this._filterChain.filters
  }

  hasFilters(filters) {
    return JSON.stringify(this.filters ?? {}) === JSON.stringify(filters ?? {})
  }

  setScatterConfig(scatter) {
    this.scatter = scatter ?? {}
  }

  hasScatterConfig(scatter) {
    return scatterKey(this.scatter) === scatterKey(scatter)
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
      if (this.oneShot) {
        this.playing = false
        this.onOneShotComplete?.()
      } else {
        this._timeoutId = setTimeout(() => this._playOneShot(), randomGapSeconds(this.scatter) * 1000)
      }
    }
  }

  // See BufferScatterSource.fireNow's identical comment.
  fireNow({ silent = false } = {}) {
    if (this.playing) {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId)
        this._timeoutId = null
      }
      this._playOneShot({ silent })
      return
    }
    this.playing = true
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this._playOneShot({ silent })
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

  async _playOneShot({ silent = false } = {}) {
    this._timeoutId = null
    if (!this.playing) return
    if (!silent) this.onShotStart?.()
    // Both pitch and speed go through playbackRate here (no detune / no
    // in-memory samples on an <audio> element), so a pitch shift still
    // changes tempo - the documented accepted limitation for this
    // never-baked fallback. Speed is *meant* to change tempo, so it rides
    // the same knob cleanly; it just also nudges pitch here, same corner.
    const playbackRate = Math.pow(2, randomPitchSemitones(this.scatter) / 12) * randomSpeedFactor(this.scatter)
    this.audioEl.playbackRate = playbackRate
    this.audioEl.currentTime = this.loopStart
    this.panStage.setPan(randomPanPosition(this.scatter), { immediate: true })
    try {
      await this.audioEl.play()
    } catch (err) {
      log.error(`Scatter sound ${this.soundId} failed to start a shot`, err)
      if (this.playing) this._timeoutId = setTimeout(() => this._playOneShot(), randomGapSeconds(this.scatter) * 1000)
      return
    }
    if (!this.playing) return
    // playbackRate already stretches/compresses real-time shot duration
    // (same documented pitch/tempo coupling this class already has) - divide
    // it out so the fade-out envelope lands at the shot's real end, not its
    // nominal (unshifted) one.
    const end = this._loopEnd()
    const nominalDuration = Number.isFinite(end) ? Math.max(0, end - this.loopStart) : this.audioEl.duration - this.loopStart
    const durationSeconds = nominalDuration / playbackRate
    const target = randomVolumeScale(this.scatter)
    const { fadeInSeconds, fadeOutSeconds } = fadeSeconds(this.scatter, durationSeconds)
    scheduleShotEnvelope(this.shotGainNode.gain, target, this.engine.context.currentTime, durationSeconds, fadeInSeconds, fadeOutSeconds)
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
    disposeStreamFilterChain(this._filterChain)
    this.shotGainNode.disconnect()
    this.panStage.dispose()
    this.gainNode.disconnect()
  }
}
