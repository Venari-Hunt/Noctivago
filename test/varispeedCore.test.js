import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createVarispeedLooper } from '../src/main/ffmpeg/varispeedCore.js'

const SR = 1000

function sineShot(freq, seconds, channels = 2) {
  const frames = Math.round(SR * seconds)
  const out = new Float32Array(frames * channels)
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / SR)
    for (let c = 0; c < channels; c++) out[i * channels + c] = v
  }
  return out
}

function zeroCrossingHz(buf, channels, fromFrame, toFrame) {
  let crossings = 0
  let prev = buf[fromFrame * channels]
  for (let i = fromFrame + 1; i < toFrame; i++) {
    const v = buf[i * channels]
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) crossings++
    prev = v
  }
  return crossings / 2 / ((toFrame - fromFrame) / SR)
}

describe('createVarispeedLooper', () => {
  test('at a constant rate of 1 it reproduces the clip tiled, sample for sample', () => {
    const shot = sineShot(10, 1)
    const looper = createVarispeedLooper({ shot, channels: 2, ratios: new Float64Array([1, 1]), stepSeconds: 1, sampleRate: SR })
    const out = looper.next(SR * 3)
    for (let i = 0; i < out.length; i++) {
      assert.ok(Math.abs(out[i] - shot[i % shot.length]) < 1e-6, `sample ${i}`)
    }
  })

  test('a rate of 2 doubles the heard frequency (tape-style: pitch and speed together)', () => {
    const shot = sineShot(20, 1)
    const looper = createVarispeedLooper({ shot, channels: 2, ratios: new Float64Array([2, 2]), stepSeconds: 1, sampleRate: SR })
    const out = looper.next(SR * 2)
    const hz = zeroCrossingHz(out, 2, 0, SR * 2)
    assert.ok(Math.abs(hz - 40) < 1.5, `expected ~40Hz, got ${hz}`)
  })

  test('the rate follows the drift curve over time', () => {
    const shot = sineShot(20, 1)
    // rate 1 for the first second, gliding to 1.5 by t=2, holding after
    const looper = createVarispeedLooper({ shot, channels: 2, ratios: new Float64Array([1, 1, 1.5, 1.5]), stepSeconds: 1, sampleRate: SR })
    const out = looper.next(SR * 4)
    const early = zeroCrossingHz(out, 2, 0, SR)
    const late = zeroCrossingHz(out, 2, SR * 3, SR * 4)
    assert.ok(Math.abs(early - 20) < 1.5, `early ${early}`)
    assert.ok(Math.abs(late - 30) < 1.5, `late ${late}`)
  })

  test('wraps around the loop seam without a jump', () => {
    // exactly 5 whole periods, so a correct wrap is perfectly continuous
    const shot = sineShot(5, 1, 1)
    const looper = createVarispeedLooper({ shot, channels: 1, ratios: new Float64Array([1.37, 1.37]), stepSeconds: 1, sampleRate: SR })
    const out = looper.next(SR * 5)
    const maxStep = (2 * Math.PI * 5 * 1.37) / SR
    for (let i = 1; i < out.length; i++) {
      assert.ok(Math.abs(out[i] - out[i - 1]) <= maxStep + 1e-3, `discontinuity at ${i}`)
    }
  })

  test('applies gain and keeps state across successive blocks', () => {
    const shot = sineShot(10, 1)
    const whole = createVarispeedLooper({ shot, channels: 2, ratios: new Float64Array([1.2, 0.8, 1.1]), stepSeconds: 0.5, sampleRate: SR, gain: 0.5 })
    const split = createVarispeedLooper({ shot, channels: 2, ratios: new Float64Array([1.2, 0.8, 1.1]), stepSeconds: 0.5, sampleRate: SR, gain: 0.5 })
    const a = whole.next(SR * 2)
    const b = new Float32Array(a.length)
    b.set(split.next(700), 0)
    b.set(split.next(SR * 2 - 700), 700 * 2)
    assert.deepEqual(b, a)
    const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    assert.ok(peak <= 0.5 + 1e-6 && peak > 0.45, `peak ${peak}`)
  })

  test('rejects an empty clip or empty rate curve', () => {
    assert.throws(() => createVarispeedLooper({ shot: new Float32Array(0), channels: 2, ratios: new Float64Array([1]), stepSeconds: 1, sampleRate: SR }))
    assert.throws(() => createVarispeedLooper({ shot: sineShot(1, 1), channels: 2, ratios: new Float64Array(0), stepSeconds: 1, sampleRate: SR }))
  })
})
