import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWholeMix, normalizeGroupFilters, normalizeGroups } from '../src/main/presets.js'

describe('normalizeWholeMix', () => {
  test('null/undefined/non-object input is null', () => {
    assert.equal(normalizeWholeMix(null), null)
    assert.equal(normalizeWholeMix(undefined), null)
    assert.equal(normalizeWholeMix('nope'), null)
  })

  test('a fully-neutral config collapses to null', () => {
    assert.equal(normalizeWholeMix({}), null)
    assert.equal(normalizeWholeMix({ highpassHz: 0, lowpassHz: 20000, gainDb: 0 }), null)
  })

  test('any single non-neutral field prevents collapsing to null', () => {
    assert.notEqual(normalizeWholeMix({ gainDb: 3 }), null)
    assert.notEqual(normalizeWholeMix({ reverbMix: 0.2 }), null)
    assert.notEqual(normalizeWholeMix({ eq: [{ freqHz: 1000, gainDb: 2, q: 1 }] }), null)
  })

  test('fields are clamped into their documented ranges', () => {
    const result = normalizeWholeMix({ highpassHz: 99999, lowpassHz: 1, gainDb: 999, echoDecay: 5 })
    assert.equal(result.highpassHz, 2000)
    assert.equal(result.lowpassHz, 150)
    assert.equal(result.gainDb, 24)
    assert.equal(result.echoDecay, 0.85)
  })

  test('eq bands are normalized and invalid entries dropped', () => {
    const result = normalizeWholeMix({ eq: [{ freqHz: 500, gainDb: 2, q: 1, type: 'peaking' }, null, 'garbage'] })
    assert.equal(result.eq.length, 1)
    assert.equal(result.eq[0].freqHz, 500)
  })

  test('a legacy percentage-based mix fluctuation migrates the same way Modulator.js does', () => {
    const result = normalizeWholeMix({
      fluctuation: { volume: { enabled: true, min: 0.2, max: 0.9, changeRate: 0.5, transition: 0.5 } }
    })
    assert.ok(result.fluctuation.volume.enabled)
    assert.ok(result.fluctuation.volume.changeMinSeconds > 6 && result.fluctuation.volume.changeMinSeconds < 7)
  })

  test('disabled fluctuation normalizes to null, not an object', () => {
    const result = normalizeWholeMix({ gainDb: 1, fluctuation: { volume: { enabled: false } } })
    assert.equal(result.fluctuation, null)
  })
})

describe('normalizeGroupFilters', () => {
  test('never collapses to null even when fully neutral (a group always keeps a real filters object)', () => {
    const result = normalizeGroupFilters({})
    assert.equal(typeof result, 'object')
    assert.equal(result.highpassHz, 0)
    assert.equal(result.occlusion, 0)
  })

  test('occlusion is clamped into 0..1', () => {
    assert.equal(normalizeGroupFilters({ occlusion: 5 }).occlusion, 1)
    assert.equal(normalizeGroupFilters({ occlusion: -5 }).occlusion, 0)
  })

  test('has no fadeInSeconds field (group-specific difference from wholeMix)', () => {
    const result = normalizeGroupFilters({ fadeInSeconds: 10 })
    assert.equal(result.fadeInSeconds, undefined)
  })
})

describe('normalizeGroups', () => {
  test('non-array input normalizes to an empty array', () => {
    assert.deepEqual(normalizeGroups(null), [])
    assert.deepEqual(normalizeGroups(undefined), [])
    assert.deepEqual(normalizeGroups('nope'), [])
  })

  test('assigns a fresh id when one is not supplied', () => {
    const [group] = normalizeGroups([{ name: 'Outside' }])
    assert.equal(typeof group.id, 'string')
    assert.ok(group.id.length > 0)
  })

  test('keeps a supplied id (needed so re-saving an existing group does not fork its identity)', () => {
    const [group] = normalizeGroups([{ id: 'g1', name: 'Outside' }])
    assert.equal(group.id, 'g1')
  })

  test('soundIds are deduplicated and non-strings dropped', () => {
    const [group] = normalizeGroups([{ name: 'g', soundIds: ['a', 'a', 'b', 123, null] }])
    assert.deepEqual(group.soundIds, ['a', 'b'])
  })

  test('a falsy entry in the array is dropped, not converted to a placeholder group', () => {
    const groups = normalizeGroups([{ name: 'Real' }, null, undefined])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].name, 'Real')
  })

  test('an unnamed group falls back to the default name "Group"', () => {
    const [group] = normalizeGroups([{}])
    assert.equal(group.name, 'Group')
  })
})
