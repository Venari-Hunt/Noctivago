import { SoundFluctuation, fluctuationKey } from './Modulator.js'

const RAMP_SECONDS = 0.15

// Plays an already-decoded AudioBuffer (a small ffmpeg-rendered loop clip)
// via a native AudioBufferSourceNode with true loop=true/loopStart/loopEnd —
// sample-accurate, click-free looping. Used instead of LocalFileSoundSource
// whenever a valid loop clip exists for a sound; see main.js getOrCreateSource.
export class BufferSoundSource {
  constructor(engine, { audioBuffer, volume, fluctuation }) {
    this.engine = engine
    this.audioBuffer = audioBuffer
    this.volume = volume
    this.playing = false
    this.sourceNode = null
    this._pausedOffset = 0
    this._startedAt = 0
    this._stopTimeoutId = null

    // Fluctuation (v0.1.164) - see SoundSource.js for the full rationale.
    // fluctuationGain sits between the buffer source and the volume gainNode
    // (0..1 multiplier, attenuation only); pitch drift rides the current
    // source node's own detune (cents), a true independent pitch shift on
    // the decoded buffer - it also nudges the loop's playback speed, which
    // reads as gentle tape-flutter and is exactly the intended ambience
    // wobble. Filters are baked into the clip, so this is the one live
    // per-shot processing buffer mode has.
    this.fluctuationGain = engine.context.createGain()
    this.fluctuationGain.gain.value = 1
    this._fluctuation = new SoundFluctuation({
      onVolume: (v) => this.fluctuationGain.gain.setTargetAtTime(v, this.engine.context.currentTime, 0.12),
      onPitch: (semitones) => this.sourceNode?.detune.setTargetAtTime(semitones * 100, this.engine.context.currentTime, 0.12)
    })
    this._fluctuation.configure(fluctuation ?? {})

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0
    this.fluctuationGain.connect(this.gainNode)
    this.gainNode.connect(engine.masterGain)
  }

  setFluctuation(fluctuation) {
    this._fluctuation.configure(fluctuation ?? {})
    this._fluctuation.sync(this.playing)
  }

  hasFluctuation(fluctuation) {
    return this._fluctuation.key === fluctuationKey(fluctuation)
  }

  waitForMetadata() {
    return Promise.resolve(this.audioBuffer.duration)
  }

  // No-op: loop bounds are baked into the clip at render time. Loop-point
  // edits always go through Save -> re-render -> dispose-and-rebuild.
  setLoopPoints() {}

  async play() {
    if (this.playing) return
    if (this._stopTimeoutId) {
      clearTimeout(this._stopTimeoutId)
      this._stopTimeoutId = null
    }

    const node = this.engine.context.createBufferSource()
    node.buffer = this.audioBuffer
    node.loop = true
    node.loopStart = 0
    node.loopEnd = this.audioBuffer.duration
    node.connect(this.fluctuationGain)

    const offset = this._pausedOffset % this.audioBuffer.duration
    node.start(0, offset)
    this.sourceNode = node
    this._startedAt = this.engine.context.currentTime - offset

    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this.playing = true
    this._fluctuation.sync(true)
  }

  pause() {
    if (!this.playing) return
    const now = this.engine.context.currentTime
    this._pausedOffset = (now - this._startedAt) % this.audioBuffer.duration

    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)
    this.playing = false
    this._fluctuation.stop()

    const node = this.sourceNode
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
    this._fluctuation.dispose()
    if (this._stopTimeoutId) clearTimeout(this._stopTimeoutId)
    if (this.sourceNode) {
      try {
        this.sourceNode.stop()
      } catch {
        // already stopped
      }
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    this.fluctuationGain.disconnect()
    this.gainNode.disconnect()
  }
}
