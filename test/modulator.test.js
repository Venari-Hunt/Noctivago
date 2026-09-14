import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveFluctuationTiming, normalizeFluctuationAxis, fluctuationKey, Modulator, FLUCTUATION_PITCH_RANGE } from '../src/renderer/audio/Modulator.js'

describe('resolveFluctuationTiming', () => {
  test('nothing set falls back to the documented defaults (6/14/8)', () => {
    assert.deepEqual(resolveFluctuationTiming(undefined), {
      changeMinSeconds: 6,
      changeMaxSeconds: 14,
      transitionSeconds: 8
    })
  })

  test('new-shape fields pass through (clamped, min<=max enforced)', () => {
    const result = resolveFluctuationTiming({ changeMinSeconds: 30, changeMaxSeconds: 10, transitionSeconds: 5 })
    // swapped min/max on input should come out correctly ordered
    assert.equal(result.changeMinSeconds, 10)
    assert.equal(result.changeMaxSeconds, 30)
    assert.equal(result.transitionSeconds, 5)
  })

  test('legacy changeRate/transition (0..1) migrates to the same values the old lerp produced', () => {
    // legacy default (0.5, 0.5) is documented to land at ~6.5-15s gap, ~13.7s transition
    const result = resolveFluctuationTiming({ changeRate: 0.5, transition: 0.5 })
    assert.ok(result.changeMinSeconds > 6 && result.changeMinSeconds < 7)
    assert.ok(result.changeMaxSeconds > 14 && result.changeMaxSeconds < 16)
    assert.ok(result.transitionSeconds > 13 && result.transitionSeconds < 14)
  })

  test('legacy fields are ignored once new-shape fields are present', () => {
    const result = resolveFluctuationTiming({ changeMinSeconds: 1, changeMaxSeconds: 2, transitionSeconds: 3, changeRate: 0.9, transition: 0.9 })
    assert.equal(result.changeMinSeconds, 1)
    assert.equal(result.changeMaxSeconds, 2)
    assert.equal(result.transitionSeconds, 3)
  })

  test('out-of-range values are clamped rather than passed through raw', () => {
    const result = resolveFluctuationTiming({ changeMinSeconds: -50, changeMaxSeconds: 99999, transitionSeconds: 99999 })
    assert.equal(result.changeMinSeconds, 0.2)
    assert.equal(result.changeMaxSeconds, 300)
    assert.equal(result.transitionSeconds, 120)
  })
})

describe('normalizeFluctuationAxis', () => {
  test('undefined axis normalizes to a disabled, neutral-centered shape', () => {
    const result = normalizeFluctuationAxis(undefined, 1)
    assert.equal(result.enabled, false)
    assert.equal(result.fullyRandom, false)
    assert.equal(result.min, 1)
    assert.equal(result.max, 1)
    assert.equal(result.bias, 1)
  })

  test('an explicit disabled/neutral object round-trips stably', () => {
    const axis = { enabled: false, min: 0, max: 0, bias: 0 }
    const once = normalizeFluctuationAxis(axis, 0)
    const twice = normalizeFluctuationAxis(once, 0)
    assert.deepEqual(once, twice)
  })

  test('a legacy percentage-based axis and its migrated equivalent produce the same key', () => {
    const legacy = { enabled: true, min: 0.2, max: 0.9, bias: 0.5, changeRate: 0.5, transition: 0.5 }
    const migrated = normalizeFluctuationAxis(legacy, 1)
    const reNormalized = normalizeFluctuationAxis(migrated, 1)
    assert.deepEqual(migrated, reNormalized)
  })
})

describe('fluctuationKey', () => {
  test('is stable for legacy vs. already-migrated equivalent configs', () => {
    const legacy = { volume: { enabled: true, min: 0.2, max: 0.9, bias: 0.5, changeRate: 0.5, transition: 0.5 } }
    const migratedVolume = normalizeFluctuationAxis(legacy.volume, 1)
    const migrated = { volume: migratedVolume }
    assert.equal(fluctuationKey(legacy), fluctuationKey(migrated))
  })

  test('differs when volume or pitch axes actually differ', () => {
    const a = fluctuationKey({ volume: { enabled: true, min: 0.2, max: 0.9, bias: 0.5 } })
    const b = fluctuationKey({ volume: { enabled: true, min: 0.3, max: 0.9, bias: 0.5 } })
    assert.notEqual(a, b)
  })
})

describe('Modulator', () => {
  function makeModulator(overrides = {}) {
    const samples = []
    const mod = new Modulator({ onValue: (v) => samples.push(v), neutral: 1, rangeMin: 0, rangeMax: 2 })
    mod.configure({
      enabled: true,
      fullyRandom: false,
      min: 0.5,
      max: 1.5,
      bias: 1,
      changeMinSeconds: 1,
      changeMaxSeconds: 1,
      transitionSeconds: 3,
      ...overrides
    })
    return { mod, samples }
  }

  test('_pickTarget always stays within [min, max], bounded mode', () => {
    const { mod } = makeModulator()
    for (let i = 0; i < 2000; i++) {
      const t = mod._pickTarget()
      assert.ok(t >= mod.min - 1e-9 && t <= mod.max + 1e-9, `target ${t} out of [${mod.min}, ${mod.max}]`)
    }
  })

  test('_pickTarget with fullyRandom roams the whole configured range, not just near bias', () => {
    const { mod } = makeModulator({ fullyRandom: true, min: 0.5, max: 1.5, bias: 1 })
    let sawNearMin = false
    let sawNearMax = false
    for (let i = 0; i < 5000; i++) {
      const t = mod._pickTarget()
      assert.ok(t >= mod.min - 1e-9 && t <= mod.max + 1e-9)
      if (t < mod.min + 0.05) sawNearMin = true
      if (t > mod.max - 0.05) sawNearMax = true
    }
    assert.ok(sawNearMin, 'fullyRandom never sampled near the minimum in 5000 draws')
    assert.ok(sawNearMax, 'fullyRandom never sampled near the maximum in 5000 draws')
  })

  test('value glides toward target over repeated ticks and stays in bounds', () => {
    const { mod, samples } = makeModulator()
    mod.running = true // _tick() no-ops unless running (normally set by start())
    mod.value = mod.min
    mod.target = mod.max
    mod._nextChangeAt = Infinity // don't let a tick pick a new target mid-test
    mod._lastTick = performance.now() - 100 // 100ms of elapsed time on first tick
    for (let i = 0; i < 50; i++) {
      mod._tick()
      mod._lastTick -= 100 // simulate steady 100ms ticks
    }
    assert.ok(samples.length === 50)
    assert.ok(samples[samples.length - 1] > samples[0], 'value should have moved toward the target')
    for (const v of samples) {
      assert.ok(v >= mod.min - 1e-9 && v <= mod.max + 1e-9, `sample ${v} escaped [${mod.min}, ${mod.max}]`)
    }
  })

  test('configure keeps an in-flight target inside freshly narrowed bounds', () => {
    const { mod } = makeModulator({ min: 0, max: 2, bias: 1 })
    mod.target = 1.9
    mod.configure({ enabled: true, fullyRandom: false, min: 0.8, max: 1.2, bias: 1, changeMinSeconds: 1, changeMaxSeconds: 1, transitionSeconds: 3 })
    assert.ok(mod.target <= 1.2 && mod.target >= 0.8)
  })
})

test('FLUCTUATION_PITCH_RANGE is the documented +-6 semitones', () => {
  assert.equal(FLUCTUATION_PITCH_RANGE, 6)
})
