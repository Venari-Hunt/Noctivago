// Pitch and tempo for the saved clip (one engine). Runs Signalsmith Stretch,
// the same engine the Remix preview plays through live (an AudioWorklet), so
// what you hear while editing is what gets saved. It replaces ffmpeg's
// rubberband, which previewed and rendered with two different engines.
//
// The package is built for AudioWorklet, but its WASM core is plain: this
// loads the same file and drives it block by block, the way the worklet does
// in buffer mode (the whole clip is in memory, the engine is told where to read
// and how fast). Doppler is a semitone curve over source time (shared/doppler.js).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dopplerSemitones, DEFAULT_DOPPLER_INTENSITY_SEMITONES, DEFAULT_DOPPLER_SHARPNESS } from '../../shared/doppler.js'

const BLOCK_SAMPLES = 512
// The engine keeps tones below this in tune (its default); same as the live node.
const TONALITY_HZ = 8000

function stretchModulePath() {
  try {
    return fileURLToPath(import.meta.resolve('signalsmith-stretch'))
  } catch {
    return path.join(process.cwd(), 'node_modules', 'signalsmith-stretch', 'SignalsmithStretch.mjs')
  }
}

let factoryPromise = null
// The package file starts with the Emscripten module factory, then the
// AudioWorklet glue. Only the factory part is run here.
export function loadStretchFactory(file = stretchModulePath()) {
  if (!factoryPromise) {
    factoryPromise = Promise.resolve().then(() => {
      const text = fs.readFileSync(file, 'utf8')
      const head = text.slice(0, text.indexOf('function registerWorkletProcessor')).replace('let module = {}, exports = {};', '')
      const mod = { exports: {} }
      new Function('module', 'exports', head)(mod, mod.exports)
      return mod.exports
    })
  }
  return factoryPromise
}

// channels: Float32Array per channel. rate: tempo (2 = twice as fast, half as
// long). semitonesAt(t): pitch shift in semitones at source time t (seconds).
// Returns Float32Array per channel, length round(input / rate).
export async function stretchChannels(channels, sampleRate, { rate = 1, semitonesAt = () => 0 } = {}) {
  const factory = await loadStretchFactory()
  const wasm = await factory()
  wasm._main()
  const channelCount = channels.length
  wasm._presetDefault(channelCount, sampleRate)
  const inLatency = wasm._inputLatency()
  const outLatency = wasm._outputLatency()
  const bufferLength = inLatency + outLatency
  const base = wasm._setBuffers(channelCount, bufferLength)
  const inPtr = (c) => base + bufferLength * 4 * c
  const outPtr = (c) => base + bufferLength * 4 * (c + channelCount)
  const heap = () => wasm.HEAP8.buffer

  const inLength = channels[0].length
  const outLength = Math.round(inLength / rate)
  const out = channels.map(() => new Float32Array(outLength))
  // The engine's own delay: the audio for output sample j comes out
  // outLatency samples later than the time map says, so run that much extra
  // and drop it from the front.
  const total = outLength + outLatency
  for (let j = 0; j < total; j += BLOCK_SAMPLES) {
    const n = Math.min(BLOCK_SAMPLES, total - j)
    const sourceSeconds = (rate * j) / sampleRate
    wasm._setTransposeSemitones(semitonesAt(sourceSeconds), TONALITY_HZ / sampleRate)
    wasm._setFormantSemitones(0, false)
    wasm._setFormantBase(0)
    const endSample = Math.round(sourceSeconds * sampleRate + inLatency)
    const startSample = endSample - bufferLength
    for (let c = 0; c < channelCount; c++) {
      const view = new Float32Array(heap(), inPtr(c), bufferLength)
      const src = channels[c]
      for (let k = 0; k < bufferLength; k++) {
        const s = startSample + k
        view[k] = s >= 0 && s < inLength ? src[s] : 0
      }
    }
    wasm._seek(bufferLength, rate)
    wasm._process(0, n)
    for (let c = 0; c < channelCount; c++) {
      const view = new Float32Array(heap(), outPtr(c), n)
      for (let k = 0; k < n; k++) {
        const o = j + k - outLatency
        if (o >= 0 && o < outLength) out[c][o] = view[k]
      }
    }
  }
  return out
}

// ---- WAV in/out (32-bit float or 16-bit PCM in, 32-bit float out) ----

export function readWav(file) {
  const buf = fs.readFileSync(file)
  let pos = 12
  let fmt = null
  let data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), sampleRate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) }
    } else if (id === 'data') {
      data = buf.subarray(pos + 8, Math.min(buf.length, pos + 8 + size))
      break
    }
    pos += 8 + size + (size & 1)
  }
  if (!fmt || !data) throw new Error('not a WAV file')
  const bytes = fmt.bits / 8
  const frames = Math.floor(data.length / (bytes * fmt.channels))
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const at = (i * fmt.channels + c) * bytes
      channels[c][i] = fmt.format === 3 ? data.readFloatLE(at) : data.readInt16LE(at) / 32768
    }
  }
  return { channels, sampleRate: fmt.sampleRate }
}

export function writeWavFloat(file, channels, sampleRate) {
  const frames = channels[0].length
  const n = channels.length
  const dataBytes = frames * n * 4
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(3, 20)
  buf.writeUInt16LE(n, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * n * 4, 28)
  buf.writeUInt16LE(n * 4, 32)
  buf.writeUInt16LE(32, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++) buf.writeFloatLE(channels[c][i], 44 + (i * n + c) * 4)
  }
  fs.writeFileSync(file, buf)
}

// The speedPitch settings the Remix tab saves -> the pass's rate and curve.
// Doppler stacks on the static Pitch, as the rubberband chain did.
export function pitchPassParams(speedPitch) {
  const {
    speed = 1,
    pitchSemitones = 0,
    dopplerEnabled = false,
    dopplerClosestFraction = 0.5,
    dopplerIntensitySemitones = DEFAULT_DOPPLER_INTENSITY_SEMITONES,
    dopplerReversed = false,
    dopplerSharpness = DEFAULT_DOPPLER_SHARPNESS
  } = speedPitch ?? {}
  return { speed, pitchSemitones, dopplerEnabled, dopplerClosestFraction, dopplerIntensitySemitones, dopplerReversed, dopplerSharpness }
}

export function needsPitchPass(speedPitch) {
  const p = pitchPassParams(speedPitch)
  return p.speed !== 1 || p.pitchSemitones !== 0 || p.dopplerEnabled
}

export async function pitchShiftWavFile(inFile, outFile, speedPitch) {
  const p = pitchPassParams(speedPitch)
  const { channels, sampleRate } = readWav(inFile)
  const duration = channels[0].length / sampleRate
  const semitonesAt = p.dopplerEnabled
    ? (t) => p.pitchSemitones + dopplerSemitones(t, duration, p.dopplerClosestFraction, p.dopplerIntensitySemitones, p.dopplerReversed, p.dopplerSharpness)
    : () => p.pitchSemitones
  const out = await stretchChannels(channels, sampleRate, { rate: p.speed, semitonesAt })
  writeWavFloat(outFile, out, sampleRate)
}
