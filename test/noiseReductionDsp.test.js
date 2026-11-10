import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reduceNoise, resolveNoiseWindow, computeNoiseProfile, NoiseReductionChannel, NOISE_FRAME } from '../src/shared/noiseReductionDsp.js'

const SR = 44100

// Seeded white noise so the test is repeatable.
function noise(length, amp, seed = 1) {
  let s = seed
  const a = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    a[i] = amp * ((s / 0xffffffff) * 2 - 1)
  }
  return a
}
const rms = (x, a, b) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a))
const db = (r) => 20 * Math.log10(r)

// 6 s: hiss all the way (-30 dB-ish), a 1 kHz tone from 3 s on. The first 2 s are noise only.
function hissUnderTone() {
  const n = SR * 6
  const hiss = noise(n, 0.05)
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = hiss[i] + (i >= SR * 3 ? 0.3 * Math.sin((2 * Math.PI * 1000 * i) / SR) : 0)
  return x
}

test('hiss drops by 10+ dB in the quiet part and the tone stays within 1.5 dB', () => {
  const x = hissUnderTone()
  const [y] = reduceNoise([x], SR, { noiseFromSec: 0, noiseToSec: 2, strengthDb: 12 })
  const quietBefore = rms(x, SR * 2.2, SR * 2.8)
  const quietAfter = rms(y, SR * 2.2, SR * 2.8)
  assert.ok(db(quietBefore) - db(quietAfter) > 10, `hiss only dropped ${db(quietBefore) - db(quietAfter)} dB`)
  // the tone (measured by correlating with it) keeps its level
  const amp = (sig) => {
    let c = 0
    let s = 0
    for (let i = SR * 4; i < SR * 5; i++) {
      c += sig[i] * Math.cos((2 * Math.PI * 1000 * i) / SR)
      s += sig[i] * Math.sin((2 * Math.PI * 1000 * i) / SR)
    }
    return (2 * Math.hypot(c, s)) / SR
  }
  assert.ok(Math.abs(db(amp(y)) - db(amp(x))) < 1.5, `tone moved ${db(amp(y)) - db(amp(x))} dB`)
})

test('a stronger setting takes out more', () => {
  const x = hissUnderTone()
  const [soft] = reduceNoise([x], SR, { noiseFromSec: 0, noiseToSec: 2, strengthDb: 6 })
  const [hard] = reduceNoise([x], SR, { noiseFromSec: 0, noiseToSec: 2, strengthDb: 30 })
  assert.ok(rms(hard, SR * 2.2, SR * 2.8) < rms(soft, SR * 2.2, SR * 2.8))
})

test('streaming in small blocks matches the whole-clip result', () => {
  const x = hissUnderTone().subarray(0, SR * 2)
  const profile = computeNoiseProfile([x], SR, 0, 1)
  const whole = new NoiseReductionChannel()
  whole.setProfile(profile)
  const expected = whole.processWhole(x)
  const ch = new NoiseReductionChannel()
  ch.setProfile(profile)
  const out = new Float32Array(x.length)
  const inBuf = new Float32Array(128)
  const outBuf = new Float32Array(128)
  const total = x.length + ch.latency + ch.hop
  for (let i = 0; i < total; i += 128) {
    for (let k = 0; k < 128; k++) inBuf[k] = i + k < x.length ? x[i + k] : 0
    ch.process(inBuf, outBuf, 128)
    for (let k = 0; k < 128; k++) {
      const o = i + k - ch.latency
      if (o >= 0 && o < x.length) out[o] = outBuf[k]
    }
  }
  for (let i = 0; i < x.length; i += 101) assert.ok(Math.abs(out[i] - expected[i]) < 1e-5)
})

test('no profile (window too short) leaves the audio as it was', () => {
  const x = noise(SR, 0.1)
  const out = reduceNoise([x], SR, { noiseFromSec: 0, noiseToSec: (NOISE_FRAME / SR) * 0.5, strengthDb: 12 })
  assert.equal(out[0], x)
})

test('resolveNoiseWindow clamps to the loop and falls back to the first third', () => {
  assert.deepEqual(resolveNoiseWindow(2, 4, 1, 10), { start: 2, end: 4 })
  assert.deepEqual(resolveNoiseWindow(0, 20, 1, 10), { start: 1, end: 10 })
  assert.deepEqual(resolveNoiseWindow(0, 0, 0, 3), { start: 0, end: 1 })
  assert.deepEqual(resolveNoiseWindow(NaN, NaN, 0, 30), { start: 0, end: 1.5 })
  assert.equal(resolveNoiseWindow(0, 1, 0, 0.1), null)
})
