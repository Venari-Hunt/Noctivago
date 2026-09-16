import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { applySoundOverride, applyOcclusionToFilters, OVERRIDABLE_SOUND_KEYS } from '../src/shared/constants.js'

describe('applySoundOverride', () => {
  const entry = {
    id: 's1',
    loopStart: 0,
    loopEnd: 10,
    filters: { highpassHz: 0 },
    crossfadeSeconds: 0.2,
    speedPitch: null,
    playMode: 'loop',
    scatter: null,
    schedule: null,
    volume: 0.8 // not an overridable key - should always pass through untouched
  }

  test('null override returns the entry unchanged', () => {
    assert.equal(applySoundOverride(entry, null), entry)
  })

  test('empty override object changes nothing', () => {
    const result = applySoundOverride(entry, {})
    assert.deepEqual(result, entry)
  })

  test('overlays only the keys present in the override', () => {
    const result = applySoundOverride(entry, { loopEnd: 20, filters: { highpassHz: 500 } })
    assert.equal(result.loopEnd, 20)
    assert.deepEqual(result.filters, { highpassHz: 500 })
    // untouched fields survive from baseline
    assert.equal(result.loopStart, 0)
    assert.equal(result.crossfadeSeconds, 0.2)
    assert.equal(result.volume, 0.8)
  })

  test('does not mutate the original entry', () => {
    const before = JSON.parse(JSON.stringify(entry))
    applySoundOverride(entry, { loopEnd: 99 })
    assert.deepEqual(entry, before)
  })

  test('only OVERRIDABLE_SOUND_KEYS are ever copied from the override', () => {
    const result = applySoundOverride(entry, { volume: 0.1, notAField: true })
    // 'volume' isn't in OVERRIDABLE_SOUND_KEYS, so the override's volume is ignored
    assert.equal(result.volume, 0.8)
    assert.equal(result.notAField, undefined)
  })

  test('OVERRIDABLE_SOUND_KEYS has the 8 documented keys', () => {
    assert.deepEqual(
      [...OVERRIDABLE_SOUND_KEYS].sort(),
      ['crossfadeSeconds', 'filters', 'loopEnd', 'loopStart', 'playMode', 'scatter', 'schedule', 'speedPitch'].sort()
    )
  })
})

describe('applyOcclusionToFilters', () => {
  test('occlusion 0 (or absent) is a no-op, same object reference back', () => {
    const f = { lowpassHz: 12000, reverbSizeMs: 100, reverbMix: 0.1 }
    assert.equal(applyOcclusionToFilters(f), f)
    const empty = {}
    assert.equal(applyOcclusionToFilters(empty), empty)
  })

  test('occlusion 1 against neutral base settings lands exactly on the three constants', () => {
    const result = applyOcclusionToFilters({ occlusion: 1 })
    assert.ok(Math.abs(result.lowpassHz - 700) < 1e-6) // Math.pow floating-point, not an exact 700
    assert.equal(result.reverbSizeMs, 900)
    assert.equal(result.reverbMix, 0.4)
  })

  test('occlusion never undoes a more muffled manual lowpass', () => {
    const result = applyOcclusionToFilters({ occlusion: 1, lowpassHz: 300 })
    assert.equal(result.lowpassHz, 300) // already more muffled than occlusion's own 700Hz ceiling
  })

  test('occlusion only adds reverb on top of the manual setting', () => {
    const result = applyOcclusionToFilters({ occlusion: 1, reverbSizeMs: 2000, reverbMix: 0.9 })
    assert.ok(result.reverbSizeMs > 2000 && result.reverbSizeMs <= 4000)
    assert.ok(result.reverbMix > 0.9 && result.reverbMix <= 1)
  })

  test('manual reverb changes stay audible under occlusion (regression, v0.1.215)', () => {
    // Used to be max(manual, occlusion): every Mix below 0.4 at occlusion 1 gave the same 0.4.
    const low = applyOcclusionToFilters({ occlusion: 1, reverbMix: 0.1, reverbSizeMs: 200 })
    const high = applyOcclusionToFilters({ occlusion: 1, reverbMix: 0.25, reverbSizeMs: 600 })
    assert.ok(high.reverbMix > low.reverbMix)
    assert.ok(high.reverbSizeMs > low.reverbSizeMs)
    assert.ok(low.reverbMix > 0.4) // still at least as wet as occlusion alone
    const maxed = applyOcclusionToFilters({ occlusion: 1, reverbMix: 1, reverbSizeMs: 4000 })
    assert.equal(maxed.reverbMix, 1)
    assert.equal(maxed.reverbSizeMs, 4000)
  })

  test('occlusion log-interpolates lowpass between neutral and 700Hz, not linearly', () => {
    const half = applyOcclusionToFilters({ occlusion: 0.5 })
    const linearMidpoint = (20000 + 700) / 2
    // log interpolation at the midpoint should land far below the linear midpoint
    assert.ok(half.lowpassHz < linearMidpoint)
    assert.ok(half.lowpassHz > 700)
  })

  test('occlusion above 1 has the same muffling effect as exactly 1 (clamped internally)', () => {
    // Note: the returned object's own `occlusion` field is a pass-through of
    // the raw input (not re-clamped) - only the effect fields below are
    // actually clamped. Harmless in practice since nothing reads occlusion
    // back off this function's result, but worth a real test either way.
    const over = applyOcclusionToFilters({ occlusion: 5 })
    const atOne = applyOcclusionToFilters({ occlusion: 1 })
    assert.equal(over.lowpassHz, atOne.lowpassHz)
    assert.equal(over.reverbSizeMs, atOne.reverbSizeMs)
    assert.equal(over.reverbMix, atOne.reverbMix)
  })
})
