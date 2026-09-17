import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { samplePanWalk, panMatrixFrames, encodePanWav, hasPanFluctuation, PAN_GEN_RATE } from '../src/main/ffmpeg/panDrift.js'
import { stereoPanMatrix } from '../src/shared/pan.js'

// Deterministic PRNG so the walk is reproducible.
function seeded(seed) {
  let x = seed >>> 0
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

const config = { enabled: true, min: -0.6, max: 0.4, bias: -0.1, changeMinSeconds: 1, changeMaxSeconds: 2, transitionSeconds: 0.5 }

describe('samplePanWalk', () => {
  test('covers the duration plus a second of slack at PAN_GEN_RATE', () => {
    assert.equal(samplePanWalk(config, 10, seeded(1)).length, 11 * PAN_GEN_RATE)
  })

  test('stays inside min..max and actually moves', () => {
    const walk = samplePanWalk(config, 60, seeded(2))
    let lo = Infinity
    let hi = -Infinity
    for (const v of walk) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    assert.ok(lo >= -0.6 && hi <= 0.4)
    assert.ok(hi - lo > 0.2)
  })

  test('starts at the bias', () => {
    assert.ok(Math.abs(samplePanWalk(config, 5, seeded(3))[0] - -0.1) < 1e-9)
  })

  test('fully random roams the whole -1..1 range', () => {
    const walk = samplePanWalk({ ...config, fullyRandom: true }, 600, seeded(4))
    const lo = walk.reduce((a, v) => Math.min(a, v), Infinity)
    const hi = walk.reduce((a, v) => Math.max(a, v), -Infinity)
    assert.ok(lo < -0.5 && hi > 0.5)
  })

  test('bias off starts mid-range and spreads evenly', () => {
    const walk = samplePanWalk({ ...config, biasEnabled: false, transitionSeconds: 0 }, 600, seeded(6))
    assert.ok(Math.abs(walk[0] - -0.1) < 1e-9) // (-0.6 + 0.4) / 2
    const high = walk.filter((v) => v > 0.2).length / walk.length
    assert.ok(high > 0.12 && high < 0.28) // uniform: ~20% of the span
  })

  test('transition 0 snaps straight to each target', () => {
    const walk = samplePanWalk({ ...config, transitionSeconds: 0 }, 5, seeded(5))
    assert.ok(walk.every((v) => Number.isFinite(v)))
  })
})

describe('panMatrixFrames / encodePanWav', () => {
  test('each frame is the shared pan law at that walk value', () => {
    const frames = panMatrixFrames(Float64Array.from([-1, 0, 0.3]))
    assert.deepEqual([...frames.subarray(8, 12)], stereoPanMatrix(0.3).flat())
    assert.deepEqual([...frames.subarray(4, 8)].map((v) => Math.round(v * 1e9) / 1e9), [1, 0, 0, 1])
  })

  test('writes a 4-channel 16-bit WAV of the right size', () => {
    const buf = encodePanWav(panMatrixFrames(new Float64Array(250)))
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF')
    assert.equal(buf.readUInt16LE(22), 4)
    assert.equal(buf.readUInt32LE(24), PAN_GEN_RATE)
    assert.equal(buf.length, 44 + 250 * 8)
    // center = identity: LfromL = full scale, LfromR = 0
    assert.equal(buf.readInt16LE(44), 32767)
    assert.equal(buf.readInt16LE(46), 0)
  })
})

describe('hasPanFluctuation', () => {
  test('only an enabled pan axis counts', () => {
    assert.equal(hasPanFluctuation(null), false)
    assert.equal(hasPanFluctuation({ volume: { enabled: true } }), false)
    assert.equal(hasPanFluctuation({ pan: { enabled: false } }), false)
    assert.equal(hasPanFluctuation({ pan: { enabled: true } }), true)
  })
})
