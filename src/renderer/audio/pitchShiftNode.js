// Real-time constant pitch shift for stream-mode sounds (v0.1.225).
//
// A streamed <audio> sound (a loop region too long to bake) can only change
// speed through playbackRate. With pitch drift on, the element runs with
// preservesPitch off so the drift is heard tape-style - pitch and tempo move
// together, exactly like buffer mode's AudioBufferSourceNode.detune
// (SoundSource.js). That would also turn the Speed control into a pitch
// change, which buffer mode never does (its speed is a pitch-preserving
// rubberband bake), so this node shifts the pitch back by 1/speed.
//
// It's the classic two-tap delay-line shifter: each tap reads a delay that
// sweeps across a short window at (1 - ratio) samples per sample, which
// plays the input back at `ratio` times its pitch; the two taps sit half a
// window apart and crossfade with sin^2 weights that always sum to 1. Cheap
// and latency-free apart from the window, fine on the noisy textures this
// app mostly plays; tonal content can pick up a faint flutter. Only created
// when Speed != 100% and pitch drift is on, so most sounds never use it.
//
// The processor is registered from a Blob URL, so there's no separate file
// for the bundler to find at runtime.

const PROCESSOR_NAME = 'noctivago-pitch-shift'

const PROCESSOR_SOURCE = `
const WINDOW_SECONDS = 0.05
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]
  }
  constructor() {
    super()
    this.window = Math.max(64, Math.round(sampleRate * WINDOW_SECONDS))
    this.length = this.window * 2 + 4
    this.buffers = [new Float32Array(this.length), new Float32Array(this.length)]
    this.write = 0
    this.phase = 0
  }
  read(buffer, delay) {
    let pos = this.write - 1 - delay
    while (pos < 0) pos += this.length
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = buffer[i0 % this.length]
    const b = buffer[(i0 + 1) % this.length]
    return a + (b - a) * frac
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    const ratio = parameters.ratio[0]
    const frames = output[0].length
    const step = (1 - ratio) / this.window
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const source = input.length ? input[Math.min(ch, input.length - 1)] : null
        this.buffers[ch][this.write] = source ? source[i] : 0
      }
      this.write = (this.write + 1) % this.length
      this.phase += step
      this.phase -= Math.floor(this.phase)
      const p0 = this.phase
      const p1 = (p0 + 0.5) % 1
      const w0 = Math.sin(Math.PI * p0) ** 2
      const w1 = 1 - w0
      for (let ch = 0; ch < output.length; ch++) {
        const buffer = this.buffers[Math.min(ch, 1)]
        output[ch][i] = this.read(buffer, p0 * this.window) * w0 + this.read(buffer, p1 * this.window) * w1
      }
    }
    return true
  }
}
registerProcessor('${PROCESSOR_NAME}', PitchShiftProcessor)
`

const registered = new WeakMap()

function ensureRegistered(context) {
  if (!registered.has(context)) {
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' }))
    const promise = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    registered.set(context, promise)
  }
  return registered.get(context)
}

// Resolves to a stereo AudioWorkletNode with a k-rate `ratio` param.
export async function createPitchShiftNode(context, ratio = 1) {
  await ensureRegistered(context)
  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers'
  })
  node.parameters.get('ratio').value = ratio
  return node
}
