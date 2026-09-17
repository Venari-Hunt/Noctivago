import { stereoPanMatrix } from '../../shared/pan.js'

// Pan drift baking (v0.1.217) - the export counterpart of the live
// `driftPanStage` (src/renderer/audio/PanStage.js driven by a Modulator).
// Kept Electron-free so test/panDrift.test.js can import it; panEnvelope.js
// writes the result to disk.
//
// One realization of the same bounded random walk the live Modulator runs
// (see gainEnvelope.js's sampleVolumeWalk - same timing mapping, same
// pow(r, 1.7) bias skew, same fullyRandom uniform pick), expressed as the
// four pan-matrix coefficients per control frame. exportMix.js multiplies
// them in with PAN_DRIFT_GRAPH below. Every coefficient is in 0..1, so the
// control signal fits a plain 16-bit WAV.

export const PAN_GEN_RATE = 1000

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

// Mirror of Modulator.js's resolveFluctuationTiming.
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
    return {
      changeMinSeconds: lerp(20, 1.5, r) * 0.6,
      changeMaxSeconds: lerp(20, 1.5, r) * 1.4,
      transitionSeconds: lerp(9, 0.15, t) * 3
    }
  }
  return { changeMinSeconds: 6, changeMaxSeconds: 14, transitionSeconds: 8 }
}

export function hasPanFluctuation(fluctuation) {
  return Boolean(fluctuation?.pan?.enabled)
}

// The pan walk (-1..1) for durationSeconds (+1s of slack), one value per
// 1/PAN_GEN_RATE seconds. `rng` is injectable for deterministic tests.
export function samplePanWalk(config, durationSeconds, rng = Math.random) {
  const fullyRandom = Boolean(config?.fullyRandom)
  // v0.1.218: bias off picks targets evenly across min..max (walk starts mid-range).
  const uniform = fullyRandom || config?.biasEnabled === false
  const rawMin = Math.max(-1, Math.min(1, num(config?.min, 0)))
  const rawMax = Math.max(-1, Math.min(1, num(config?.max, 0)))
  const min = fullyRandom ? -1 : Math.min(rawMin, rawMax)
  const max = fullyRandom ? 1 : Math.max(rawMin, rawMax)
  const bias = fullyRandom ? 0 : uniform ? (min + max) / 2 : Math.min(max, Math.max(min, num(config?.bias, 0)))
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

  const dt = 1 / PAN_GEN_RATE
  const frames = Math.max(1, Math.ceil((durationSeconds + 1) * PAN_GEN_RATE))
  const out = new Float64Array(frames)
  let value = bias
  let target = bias
  let nextChangeAt = jitteredInterval()
  const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1
  for (let i = 0; i < frames; i++) {
    const now = i * dt
    if (now >= nextChangeAt) {
      target = pickTarget()
      nextChangeAt = now + jitteredInterval()
    }
    value += (target - value) * k
    out[i] = Math.max(min, Math.min(max, value))
  }
  return out
}

// Interleaved [LfromL, LfromR, RfromL, RfromR] per frame.
export function panMatrixFrames(walk) {
  const out = new Float64Array(walk.length * 4)
  for (let i = 0; i < walk.length; i++) {
    const [[ll, lr], [rl, rr]] = stereoPanMatrix(walk[i])
    out[i * 4] = ll
    out[i * 4 + 1] = lr
    out[i * 4 + 2] = rl
    out[i * 4 + 3] = rr
  }
  return out
}

// 4-channel 16-bit PCM WAV bytes at PAN_GEN_RATE.
export function encodePanWav(frames) {
  const numFrames = frames.length / 4
  const blockAlign = 8
  const dataSize = numFrames * blockAlign
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(4, 22)
  buf.writeUInt32LE(PAN_GEN_RATE, 24)
  buf.writeUInt32LE(PAN_GEN_RATE * blockAlign, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < frames.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(0, Math.min(1, frames[i])) * 32767), 44 + i * 2)
  }
  return buf
}

// filter_complex fragment: applies the 4-channel coefficient stream
// `envInput` (an input label like '2:a') to the stereo fltp stream
// [inLabel], producing [outLabel]. The stream must already be at 44100 Hz.
export function panDriftGraph(envInput, inLabel, outLabel) {
  const t = `pd${outLabel}`
  return [
    `[${envInput}]aresample=44100,aformat=sample_fmts=fltp,channelsplit=channel_layout=4.0[${t}ll][${t}lr][${t}rl][${t}rr]`,
    `[${inLabel}]channelsplit=channel_layout=stereo[${t}sl][${t}sr]`,
    `[${t}sl]asplit[${t}sl1][${t}sl2]`,
    `[${t}sr]asplit[${t}sr1][${t}sr2]`,
    `[${t}sl1][${t}ll]amultiply[${t}xll]`,
    `[${t}sr1][${t}lr]amultiply[${t}xlr]`,
    `[${t}sl2][${t}rl]amultiply[${t}xrl]`,
    `[${t}sr2][${t}rr]amultiply[${t}xrr]`,
    `[${t}xll][${t}xlr]amix=inputs=2:normalize=0[${t}l]`,
    `[${t}xrl][${t}xrr]amix=inputs=2:normalize=0[${t}r]`,
    `[${t}l][${t}r]join=inputs=2:channel_layout=stereo[${outLabel}]`
  ].join(';')
}
