import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'

// Bakes the Remix "Fluctuation" feature's slow random volume drift into an
// export (v0.1.171). Live playback drives a gain node from a running
// Modulator (src/renderer/audio/Modulator.js); an export has no live audio
// graph, so instead this renders ONE realization of that same bounded
// random walk to a short mono/stereo control-signal WAV, which exportMix.js
// then multiplies against the relevant track (a fluctuating loop sound's own
// tiled track, a Sound Group's submix bus, or the whole final mix) via
// ffmpeg's `amultiply`. Same idea as how scatter/scheduled shot placement is
// already one baked realization of that mode's own randomization rather than
// a re-runnable behavior.
//
// The walk math below is a deliberate, self-contained copy of Modulator's -
// the main process never imports from src/renderer/ (see CLAUDE.md), so this
// mirrors that file the same way the Remix plugin keeps its own bundled
// copy. If Modulator's mapping (the flat-seconds timing fields + legacy
// changeRate/transition migration, the pow(r,1.7) bias skew, pickTarget, the
// fullyRandom uniform pick) changes, change it here too.

// Control signal sample rate. Far below audio rate - the drift is slow (even
// the snappiest allowed settings put the time constant near ~0.07s and a new
// target no more than a few times a second) so 1000 Hz is already smooth for
// a gain automation curve, and exportMix.js `aresample`s it up to 44100
// before the multiply. Keeps the file tiny even for a multi-hour export
// (~7 MB/hour stereo 16-bit).
export const GEN_RATE = 1000

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Mirror of Modulator.js's resolveFluctuationTiming - accepts the flat-seconds
// fields (v0.1.176+), the legacy 0..1 changeRate/transition, or nothing.
function resolveTiming(axis) {
  if (Number.isFinite(axis?.changeMinSeconds) || Number.isFinite(axis?.transitionSeconds)) {
    const lo = num(axis.changeMinSeconds, 6)
    const hi = num(axis.changeMaxSeconds, 14)
    return {
      changeMinSeconds: Math.max(0.1, Math.min(lo, hi)),
      changeMaxSeconds: Math.max(Math.max(0.1, Math.min(lo, hi)), hi),
      transitionSeconds: Math.max(0, num(axis.transitionSeconds, 8))
    }
  }
  if (Number.isFinite(axis?.changeRate) || Number.isFinite(axis?.transition)) {
    const r = num(axis.changeRate, 0.5)
    const t = num(axis.transition, 0.5)
    const centre = lerp(20, 1.5, r)
    const tau = lerp(9, 0.15, t)
    return {
      changeMinSeconds: centre * 0.6,
      changeMaxSeconds: centre * 1.4,
      transitionSeconds: tau * 3
    }
  }
  return { changeMinSeconds: 6, changeMaxSeconds: 14, transitionSeconds: 8 }
}

// Reproduces Modulator's bounded random walk for `durationSeconds`, sampled
// at GEN_RATE. Returns a Float64Array of 0..1 gain multipliers. `rng` is
// injectable so a test can make it deterministic; a real export uses
// Math.random (one fresh realization per run, matching scatter/scheduled).
export function sampleVolumeWalk(config, durationSeconds, rng = Math.random) {
  const fullyRandom = Boolean(config.fullyRandom)
  // v0.1.218: bias off picks targets evenly across min..max (walk starts mid-range).
  const uniform = fullyRandom || config?.biasEnabled === false
  const min = fullyRandom ? 0 : Math.min(config.min, config.max)
  const max = fullyRandom ? 1 : Math.max(config.min, config.max)
  const bias = uniform ? (min + max) / 2 : Math.min(max, Math.max(min, config.bias))
  const timing = resolveTiming(config)
  const changeMin = timing.changeMinSeconds
  const changeSpan = timing.changeMaxSeconds - timing.changeMinSeconds
  const tau = Math.max(0, timing.transitionSeconds / 3)

  const jitteredInterval = () => changeMin + rng() * changeSpan
  const pickTarget = () => {
    if (uniform) return min + rng() * (max - min)
    const lower = bias - min
    const upper = max - bias
    const span = lower + upper
    if (span <= 0) return bias
    const goUp = rng() < upper / span
    const t = Math.pow(rng(), 1.7)
    return goUp ? bias + t * upper : bias - t * lower
  }

  const dt = 1 / GEN_RATE
  const frames = Math.max(1, Math.ceil((durationSeconds + 1) * GEN_RATE))
  const out = new Float64Array(frames)

  let value = bias
  let target = bias
  let nextChangeAt = jitteredInterval()
  const k = 1 - Math.exp(-dt / tau)
  for (let i = 0; i < frames; i++) {
    const now = i * dt
    if (now >= nextChangeAt) {
      target = pickTarget()
      nextChangeAt = now + jitteredInterval()
    }
    value += (target - value) * k
    out[i] = Math.max(0, Math.min(1, value))
  }
  return out
}

function envelopeTempDir() {
  return path.join(app.getPath('userData'), 'export-tmp')
}

// Writes `values` (0..1) as a 2-channel 16-bit PCM WAV at GEN_RATE - stereo
// so the downstream `amultiply` never hits a channel-count mismatch with the
// (always stereo) audio track. Returns the file path; caller cleans it up.
// Exported for src/main/ffmpeg/volumeEnvelope.js (the user-authored envelope
// bake) to reuse verbatim - both live in the same main-process runtime, so
// this is an ordinary shared import, not one of this codebase's
// cross-plugin/cross-process duplications.
export function writeWav(values) {
  const numFrames = values.length
  const bytesPerSample = 2
  const numChannels = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const buf = Buffer.alloc(44 + dataSize)

  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(GEN_RATE, 24)
  buf.writeUInt32LE(GEN_RATE * blockAlign, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(8 * bytesPerSample, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    const s = Math.round(Math.max(0, Math.min(1, values[i])) * 32767)
    buf.writeInt16LE(s, offset)
    buf.writeInt16LE(s, offset + 2)
    offset += 4
  }

  const filePath = path.join(envelopeTempDir(), `${crypto.randomUUID()}.wav`)
  fs.mkdirSync(envelopeTempDir(), { recursive: true })
  fs.writeFileSync(filePath, buf)
  return filePath
}

// True when a fluctuation config (a sound's `fluctuation.volume`, or a
// preset/group's `fluctuation.volume`) actually asks for volume drift.
export function hasVolumeFluctuation(fluctuation) {
  return Boolean(fluctuation?.volume?.enabled)
}

// Renders one realization of the volume walk to a control-signal WAV.
// Returns the path (in export-tmp, so exportMix.js's own cleanup + the
// startup sweep both cover it) or null if the config isn't actually active.
export function renderGainEnvelopeWav(fluctuation, durationSeconds, rng = Math.random) {
  if (!hasVolumeFluctuation(fluctuation)) return null
  const values = sampleVolumeWalk(fluctuation.volume, durationSeconds, rng)
  return writeWav(values)
}
