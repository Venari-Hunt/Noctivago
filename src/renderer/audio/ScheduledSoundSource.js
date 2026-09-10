import log from 'electron-log/renderer'
import { randomPitchSemitones, randomVolumeScale, randomSpeedFactor, fadeSeconds, scheduleShotEnvelope } from './ScatterSoundSource.js'
import { pitchShiftBuffer } from './pitchStretch.js'

const RAMP_SECONDS = 0.15

// Real-world wall-clock playback ("a church's bell at 12:00 and 00:00", "an
// hourly chime, like a digital clock") - the trimmed clip plays once at each
// scheduled moment, then waits for the next one. The *when* is deterministic
// clock math (unlike Scatter's random gap), but per direct owner request
// ("the scheduled audios should have the exact same controls... as the
// random interval sounds have... it still needs fading, randomization and
// whatever") each shot's own character - pitch, volume, fade in/out - is
// randomized exactly the same way, reusing Scatter's own randomPitchSemitones/
// randomVolumeScale/fadeSeconds/scheduleShotEnvelope (exported from
// ScatterSoundSource.js) rather than a third copy of that math. Shares the
// buffer/stream fallback split and the general shot-then-wait shape with
// ScatterSoundSource, but stays its own file rather than a parametrized
// variant of it - the trigger-timing logic (deterministic clock vs. random
// gap) is different enough that forcing a shared base class would cost more
// than it saves.
//
// schedule shape: { type: 'times', times: ['12:00', '00:00'] } for one or
// more fixed daily HH:MM (24h) triggers, or { type: 'interval',
// intervalMinutes: 60 } for a recurring interval aligned to midnight (so
// intervalMinutes: 60 always lands on the hour, 30 on the hour and half-
// hour, etc - "like a digital clock" rather than counting from whenever the
// app happened to start).
function secondsUntilNextTrigger(schedule, now = new Date()) {
  if (!schedule) return null
  if (schedule.type === 'interval') {
    const intervalMs = Math.max(1, schedule.intervalMinutes ?? 60) * 60000
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const msSinceMidnight = now.getTime() - startOfDay
    const msUntilNext = intervalMs - (msSinceMidnight % intervalMs)
    return msUntilNext / 1000
  }
  const times = schedule.times ?? []
  if (times.length === 0) return null
  const candidates = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return d.getTime()
    })
    .filter((t) => t !== null)
  if (candidates.length === 0) return null
  return (Math.min(...candidates) - now.getTime()) / 1000
}

function normalizeSchedule(schedule) {
  return JSON.stringify({
    type: schedule?.type ?? 'times',
    times: [...(schedule?.times ?? [])].sort(),
    intervalMinutes: schedule?.intervalMinutes ?? 60,
    minPitchSemitones: schedule?.minPitchSemitones ?? 0,
    maxPitchSemitones: schedule?.maxPitchSemitones ?? 0,
    pitchFullyRandom: Boolean(schedule?.pitchFullyRandom),
    minVolume: schedule?.minVolume ?? 1,
    maxVolume: schedule?.maxVolume ?? 1,
    minSpeed: schedule?.minSpeed ?? 1,
    maxSpeed: schedule?.maxSpeed ?? 1,
    fadeInMs: schedule?.fadeInMs ?? 0,
    fadeOutMs: schedule?.fadeOutMs ?? 0
  })
}

// Buffer variant: plays the small, already-baked (trimmed+filtered, no
// crossfade - same effectiveCrossfadeSeconds reasoning scatter mode uses,
// see library.js) AudioBuffer via a fresh AudioBufferSourceNode per shot.
export class BufferScheduledSource {
  constructor(engine, { audioBuffer, volume, schedule, oneShot = false }) {
    this.engine = engine
    this.audioBuffer = audioBuffer
    this.volume = volume
    this.schedule = schedule ?? {}
    this.playing = false
    this.currentNode = null
    this.currentShotGain = null
    this._timeoutId = null
    this._stopTimeoutId = null
    // Test-fire mode (tabs/mixer/index.js's per-row "play one now" button,
    // shared with scatter mode) - see BufferScatterSource's identical
    // fields for the full rationale.
    this.oneShot = oneShot
    this.onOneShotComplete = null

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0
    this.gainNode.connect(engine.masterGain)
  }

  waitForMetadata() {
    return Promise.resolve(this.audioBuffer.duration)
  }

  // No-op: loop bounds are baked into the clip at render time, same as
  // BufferSoundSource/BufferScatterSource - trim edits always go through
  // Save -> re-render.
  setLoopPoints() {}

  setScheduleConfig(schedule) {
    this.schedule = schedule ?? {}
  }

  hasScheduleConfig(schedule) {
    return normalizeSchedule(this.schedule) === normalizeSchedule(schedule)
  }

  _scheduleNext() {
    const seconds = secondsUntilNextTrigger(this.schedule)
    if (seconds === null) return
    this._timeoutId = setTimeout(() => this._playOneShot(), seconds * 1000)
  }

  _playOneShot() {
    this._timeoutId = null
    if (!this.playing) return
    const node = this.engine.context.createBufferSource()
    const semitones = randomPitchSemitones(this.schedule)
    const speedFactor = randomSpeedFactor(this.schedule)
    node.detune.value = semitones * 100
    // Per-shot PITCH keeps the shot's trimmed length via a WSOLA pre-stretch
    // (v0.1.111). Per-shot SPEED (v0.1.135) is applied as plain `playbackRate`
    // varispeed - it changes tempo/length and couples pitch with it, and is
    // deliberately NOT routed through the WSOLA time-stretch, which buzzes on
    // an aggressive time-compression of a broadband transient (a sped-up
    // thunderclap - the "loud synth-like noise" report; v0.1.175 takes speed
    // off that path entirely, same as BufferScatterSource). `pitchShiftBuffer`
    // returns null for a clip too long to stretch or a pitch shift steeper
    // than the WSOLA handles - `detune` then resamples the pitch (also speeding
    // the shot up by the pitch ratio, hence the extra term in the fallback
    // duration).
    const shifted = pitchShiftBuffer(this.engine.context, this.audioBuffer, semitones)
    node.buffer = shifted ?? this.audioBuffer
    node.playbackRate.value = speedFactor
    const durationSeconds = shifted
      ? this.audioBuffer.duration / speedFactor
      : this.audioBuffer.duration / (Math.pow(2, semitones / 12) * speedFactor)
    const shotGain = this.engine.context.createGain()
    node.connect(shotGain)
    shotGain.connect(this.gainNode)
    const target = randomVolumeScale(this.schedule)
    const { fadeInSeconds, fadeOutSeconds } = fadeSeconds(this.schedule, durationSeconds)
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

  async play() {
    if (this.playing) return
    this.playing = true
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this._scheduleNext()
  }

  // Test-fire (tabs/mixer/index.js's per-row "play one now" button, shared
  // with scatter mode): if already live, skips whatever wait is currently
  // pending and fires immediately - normal scheduling resumes afterward. If
  // not currently playing at all (the ephemeral, not-included-in-the-mix
  // case), starts the envelope and fires immediately rather than going
  // through play()'s own "wait for the next scheduled time" behavior, which
  // would defeat the entire point of testing it right now.
  fireNow() {
    if (this.playing) {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId)
        this._timeoutId = null
      }
      this._playOneShot()
      return
    }
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
    this.gainNode.disconnect()
  }
}

// Stream variant: fallback for a scheduled sound whose trim doesn't qualify
// for a baked clip (e.g. longer than MAX_BUFFER_CLIP_SECONDS). Same
// highpass/lowpass/gain/echo chain as every other streamed source so saved
// filters still apply. Uses the <audio> element's own native
// timeupdate/pause/ended events to detect shot-end rather than
// requestAnimationFrame - see ScatterSoundSource.js's identical fix
// (v0.1.71) for why: rAF is throttled to near-zero once the window is
// hidden/unfocused, the normal state for this app, which would otherwise
// silently kill scheduling after the first shot.
//
// DISCLAIMER (owner-requested, v0.1.111 Questions): pitch randomization here
// uses playbackRate (no detune equivalent on <audio>, and no in-memory
// samples to pre-stretch the way BufferScheduledSource's WSOLA path does),
// so a pitch shift still changes shot duration/tempo - exactly the same
// coupling StreamScatterSource has, and for the same reason (see its own
// identical disclaimer). This only bites a scheduled trim long enough to
// never bake, which is unusual. If you're here chasing a "pitched shots play
// faster/slower than expected" bug: this is that bug, it's a known/accepted
// limitation, not a regression - fixing it for real needs a realtime
// pitch-shift node in the stream chain, which is a real chunk of new work,
// not a quick patch. Don't spend time re-diagnosing this from scratch.
export class StreamScheduledSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume, filters, schedule, oneShot = false }) {
    this.engine = engine
    this.soundId = soundId
    this.loopStart = loopStart ?? 0
    this.loopEnd = loopEnd ?? null
    this.volume = volume
    this.schedule = schedule ?? {}
    this.playing = false
    this._timeoutId = null
    this._onShotProgress = this._onShotProgress.bind(this)
    // See BufferScheduledSource's identical fields for the full rationale.
    this.oneShot = oneShot
    this.onOneShotComplete = null

    this.audioEl = new Audio()
    this.audioEl.crossOrigin = 'anonymous'
    this.audioEl.preload = 'auto'
    this.audioEl.src = `sound://${soundId}`
    this.audioEl.addEventListener('error', () => {
      log.error(`Scheduled sound ${this.soundId} audio element error`, this.audioEl.error)
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

    // Per-shot fade in/out + volume-randomization envelope, separate from
    // gainNode's own play/pause envelope below - same split
    // StreamScatterSource already has, and for the same reason: this one
    // resets every shot, gainNode only moves on play()/pause()/setVolume().
    this.shotGainNode = engine.context.createGain()
    this.shotGainNode.gain.value = 1

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0

    this.sourceNode.connect(this.highpassNode)
    this.highpassNode.connect(this.lowpassNode)
    this.lowpassNode.connect(this.filterGainNode)
    this.filterGainNode.connect(this.shotGainNode)
    this.shotGainNode.connect(this.gainNode)
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

  setScheduleConfig(schedule) {
    this.schedule = schedule ?? {}
  }

  hasScheduleConfig(schedule) {
    return normalizeSchedule(this.schedule) === normalizeSchedule(schedule)
  }

  _loopEnd() {
    return this.loopEnd ?? this.audioEl.duration
  }

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
        this._scheduleNext()
      }
    }
  }

  _scheduleNext() {
    const seconds = secondsUntilNextTrigger(this.schedule)
    if (seconds === null) return
    this._timeoutId = setTimeout(() => this._playOneShot(), seconds * 1000)
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
    // Pitch and speed both ride playbackRate here (no detune on <audio>), so
    // pitch still couples to tempo - the documented accepted limitation for
    // this never-baked fallback. Speed is meant to change tempo anyway.
    const playbackRate = Math.pow(2, randomPitchSemitones(this.schedule) / 12) * randomSpeedFactor(this.schedule)
    this.audioEl.playbackRate = playbackRate
    this.audioEl.currentTime = this.loopStart
    try {
      await this.audioEl.play()
    } catch (err) {
      log.error(`Scheduled sound ${this.soundId} failed to start a shot`, err)
      if (this.oneShot) {
        this.playing = false
        this.onOneShotComplete?.()
      } else if (this.playing) {
        this._scheduleNext()
      }
      return
    }
    if (!this.playing) return
    // playbackRate already stretches/compresses real-time shot duration -
    // same coupling StreamScatterSource already accounts for - divide it
    // out so the fade envelope lands at the shot's real end.
    const end = this._loopEnd()
    const nominalDuration = Number.isFinite(end) ? Math.max(0, end - this.loopStart) : this.audioEl.duration - this.loopStart
    const durationSeconds = nominalDuration / playbackRate
    const target = randomVolumeScale(this.schedule)
    const { fadeInSeconds, fadeOutSeconds } = fadeSeconds(this.schedule, durationSeconds)
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
    this._scheduleNext()
  }

  // See BufferScheduledSource.fireNow's identical comment.
  fireNow() {
    if (this.playing) {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId)
        this._timeoutId = null
      }
      this._playOneShot()
      return
    }
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
    this.shotGainNode.disconnect()
    this.gainNode.disconnect()
  }
}
