const RAMP_SECONDS = 0.15

// Plays an already-decoded AudioBuffer (a small ffmpeg-rendered loop clip)
// via a native AudioBufferSourceNode with true loop=true/loopStart/loopEnd —
// sample-accurate, click-free looping. Used instead of LocalFileSoundSource
// whenever a valid loop clip exists for a sound; see main.js getOrCreateSource.
export class BufferSoundSource {
  constructor(engine, { audioBuffer, volume }) {
    this.engine = engine
    this.audioBuffer = audioBuffer
    this.volume = volume
    this.playing = false
    this.sourceNode = null
    this._pausedOffset = 0
    this._startedAt = 0
    this._stopTimeoutId = null

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0
    this.gainNode.connect(engine.masterGain)
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
    node.connect(this.gainNode)

    const offset = this._pausedOffset % this.audioBuffer.duration
    node.start(0, offset)
    this.sourceNode = node
    this._startedAt = this.engine.context.currentTime - offset

    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this.playing = true
  }

  pause() {
    if (!this.playing) return
    const now = this.engine.context.currentTime
    this._pausedOffset = (now - this._startedAt) % this.audioBuffer.duration

    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)
    this.playing = false

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
    this.gainNode.disconnect()
  }
}
