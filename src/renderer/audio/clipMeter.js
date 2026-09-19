// Live level/clip meter taps for the Mixer (per sound, per Sound Group, and
// the whole mix), Audition-style: a peak bar plus a clip light that stays lit
// once the signal reaches 0 dBFS until someone clicks it.
//
// Every tap sits *before* the brick-wall limiters (SoundGroupChain /
// WholeMixChain), so a sound the limiter is quietly squashing still shows as
// clipping instead of looking fine.
//
// The measuring runs in an AudioWorklet rather than a polled AnalyserNode: an
// analyser only shows whatever fits in its window at the moment it's read, so
// a short over between two reads would be missed. The processor sees every
// sample and posts one peak per ~50ms window (and nothing at all while
// silent). Registered from a Blob URL, same as pitchShiftNode.js.

const PROCESSOR_NAME = 'noctivago-clip-meter'

const PROCESSOR_SOURCE = `
class ClipMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.window = Math.round(sampleRate * 0.05)
    this.frames = 0
    this.peak = 0
    this.lastSent = 0
  }
  process(inputs) {
    const input = inputs[0]
    let peak = this.peak
    for (let c = 0; c < input.length; c++) {
      const data = input[c]
      for (let i = 0; i < data.length; i++) {
        const a = data[i] < 0 ? -data[i] : data[i]
        if (a > peak) peak = a
      }
    }
    this.peak = peak
    this.frames += input.length ? input[0].length : 128
    if (this.frames >= this.window) {
      if (peak > 0 || this.lastSent > 0) this.port.postMessage(peak)
      this.lastSent = peak
      this.peak = 0
      this.frames = 0
    }
    return true
  }
}
registerProcessor('${PROCESSOR_NAME}', ClipMeterProcessor)
`

// 0 dBFS. Pre-limiter the signal is plain float and can go past this without
// distorting inside the graph - but past this point is exactly where the
// limiter starts squashing it (or, with no limiter, where the output clips).
export const CLIP_LEVEL = 1

const modules = new WeakMap()

function ensureModule(context) {
  let promise = modules.get(context)
  if (!promise) {
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' }))
    promise = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    modules.set(context, promise)
  }
  return promise
}

export class ClipMeter {
  constructor(context) {
    // Connect to `input` right away; the worklet itself attaches behind it
    // once its module has loaded.
    this.input = context.createGain()
    this.peak = 0 // latest ~50ms window
    this.clipped = false // latched until reset()
    this.maxPeak = 0 // loudest since the last reset()
    this.recentPeak = 0 // loudest of the last two windows (for blame snapshots)
    this._prevPeak = 0
    // Called whenever maxPeak rises past 0 dB, so the engine can snapshot
    // what every feeding sound was doing at that moment (the Clip report).
    this.onClipPeak = null
    this.blame = null
    this.node = null
    this._disposed = false
    ensureModule(context)
      .then(() => {
        if (this._disposed) return
        this.node = new AudioWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 0 })
        this.node.port.onmessage = (e) => this._onPeak(e.data)
        this.input.connect(this.node)
      })
      .catch((err) => console.warn('Clip meter unavailable:', err))
  }

  _onPeak(peak) {
    this.recentPeak = Math.max(peak, this._prevPeak)
    this._prevPeak = peak
    this.peak = peak
    const newMax = peak > this.maxPeak
    if (newMax) this.maxPeak = peak
    if (peak >= CLIP_LEVEL) {
      this.clipped = true
      if (newMax) this.onClipPeak?.()
    }
  }

  reset() {
    this.clipped = false
    this.maxPeak = this.peak
    this.blame = null
  }

  dispose() {
    this._disposed = true
    this.input.disconnect()
    if (this.node) {
      this.node.port.onmessage = null
      this.node.disconnect()
    }
  }
}
