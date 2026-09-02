const RAMP_SECONDS = 0.15

// The "Saved" half of the Remix preview toggle - reported directly:
// "Everything modifiable on the remix tab should be audible on the remix
// tab preview... If this isn't possible then when you hit save and an audio
// is baked you should be able to alternate between the baked audio and the
// preview." PreviewSource's live Web Audio chain can't accurately preview
// everything ffmpeg bakes (Doppler and Reverse have no live preview at all;
// Pitch is only a rough approximation - see PreviewSource.js's own doc
// comments) - rather than building real-time equivalents for each of those
// (a real-time pitch-bend engine for Doppler in particular is a lot of new
// DSP work for a bake-only, non-interactive effect), this plays the actual
// baked clip file instead, so switching to "Saved" is always 100% truthful
// to what the Mixer will really play.
//
// Deliberately minimal next to PreviewSource: no crossfade voices (the
// baked clip already has its own seam crossfade baked in by ffmpeg), no
// filter chain (already baked in), just one <audio> element playing the
// clip file directly (native loop=true) through a single volume GainNode.
export class BakedClipPreview {
  constructor(engine, soundId, volume) {
    this.engine = engine
    this.volume = volume
    this.playing = false
    this._pauseTimeoutId = null

    this.audioEl = new Audio()
    this.audioEl.crossOrigin = 'anonymous'
    this.audioEl.preload = 'auto'
    this.audioEl.loop = true
    // variant=clip - see src/main/index.js's sound:// protocol handler,
    // which already serves either the original file or the rendered loop
    // clip depending on this query param (the same mechanism the Mixer's
    // own buffer-mode eligibility check relies on elsewhere). The `v=`
    // cache-buster matters here specifically: unlike every other consumer of
    // this protocol, a Save in this same tab can re-render the clip file at
    // this *exact* URL moments after a previous BakedClipPreview already
    // fetched it - a fresh timestamp per construction (index.js recreates
    // this class right after a successful bake) guarantees the new bytes are
    // actually requested rather than risking a browser-cached response for a
    // URL whose underlying file just changed.
    this.audioEl.src = `sound://${soundId}?variant=clip&v=${Date.now()}`

    this.sourceNode = engine.context.createMediaElementSource(this.audioEl)
    this.outputGainNode = engine.context.createGain()
    this.outputGainNode.gain.value = 0
    this.sourceNode.connect(this.outputGainNode)
    this.outputGainNode.connect(engine.masterGain)
  }

  waitForMetadata() {
    if (this.audioEl.readyState >= 1) return Promise.resolve(this.audioEl.duration)
    return new Promise((resolve) => {
      this.audioEl.addEventListener('loadedmetadata', () => resolve(this.audioEl.duration), { once: true })
    })
  }

  scrubTo(t) {
    this.audioEl.currentTime = t
  }

  async play() {
    if (this.playing) return
    if (this._pauseTimeoutId) {
      clearTimeout(this._pauseTimeoutId)
      this._pauseTimeoutId = null
    }
    await this.audioEl.play()
    const now = this.engine.context.currentTime
    this.outputGainNode.gain.cancelScheduledValues(now)
    this.outputGainNode.gain.setValueAtTime(this.outputGainNode.gain.value, now)
    this.outputGainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this.playing = true
  }

  pause() {
    if (!this.playing) return
    const now = this.engine.context.currentTime
    this.outputGainNode.gain.cancelScheduledValues(now)
    this.outputGainNode.gain.setValueAtTime(this.outputGainNode.gain.value, now)
    this.outputGainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)
    this.playing = false
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
    if (this._pauseTimeoutId) clearTimeout(this._pauseTimeoutId)
    this.audioEl.pause()
    this.audioEl.removeAttribute('src')
    this.audioEl.load()
    this.sourceNode.disconnect()
    this.outputGainNode.disconnect()
  }
}
