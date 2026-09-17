import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomSpeedFactor } from '../src/renderer/audio/ScatterSoundSource.js'

// Per-play Speed (v0.1.227): the same Fully random / Bias options as the
// pitch/volume/pan picks.
describe('randomSpeedFactor', () => {
  const roll = (config, n = 4000) => Array.from({ length: n }, () => randomSpeedFactor(config))

  test('no range means no variation, and old configs without the new fields still work', () => {
    assert.ok(roll(undefined, 50).every((v) => v === 1))
    assert.ok(roll({ minSpeed: 0.8, maxSpeed: 1.2 }).every((v) => v >= 0.8 && v <= 1.2))
  })

  test('fully random rolls the whole 50-200% range and ignores min/max', () => {
    const values = roll({ minSpeed: 1, maxSpeed: 1, speedFullyRandom: true })
    assert.ok(values.every((v) => v >= 0.5 && v <= 2))
    assert.ok(Math.min(...values) < 0.6 && Math.max(...values) > 1.9)
  })

  test('bias clusters picks near the bias value but stays inside the range', () => {
    const config = { minSpeed: 0.5, maxSpeed: 2, speedBiasEnabled: true, speedBias: 1.8 }
    const values = roll(config)
    assert.ok(values.every((v) => v >= 0.5 && v <= 2))
    const near = values.filter((v) => Math.abs(v - 1.8) < 0.15).length / values.length
    // A uniform pick lands in that 0.3-wide window 20% of the time.
    assert.ok(near > 0.3, `near-bias share ${near}`)
  })

  test('a bias outside a range that shrank is clamped into it', () => {
    const values = roll({ minSpeed: 0.9, maxSpeed: 1.1, speedBiasEnabled: true, speedBias: 1.8 })
    assert.ok(values.every((v) => v >= 0.9 && v <= 1.1))
  })
})
