import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWholeMix, normalizeGroupFilters, normalizeGroups, updatePresetGroups, savePreset, deletePreset } from '../src/main/presets.js'

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

describe('pan drift (v0.1.217)', () => {
  const pan = { enabled: true, min: -2, max: 0.5, bias: 0.9, changeMinSeconds: 3, changeMaxSeconds: 5, transitionSeconds: 1 }

  test('a group keeps its pan drift, clamped into -1..1 with the bias inside the range', () => {
    const f = normalizeGroupFilters({ fluctuation: { pan } }).fluctuation
    assert.equal(f.volume, undefined)
    assert.equal(f.pan.min, -1)
    assert.equal(f.pan.max, 0.5)
    assert.equal(f.pan.bias, 0.5)
    assert.equal(f.pan.transitionSeconds, 1)
  })

  test('a group with only a disabled pan axis stores no fluctuation', () => {
    assert.equal(normalizeGroupFilters({ fluctuation: { pan: { enabled: false } } }).fluctuation, null)
  })

  test('volume and pan drift are both kept on a group', () => {
    const f = normalizeGroupFilters({ fluctuation: { volume: { enabled: true, min: 0.2, max: 0.9 }, pan } }).fluctuation
    assert.ok(f.volume.enabled && f.pan.enabled)
  })

  test('the whole mix drops pan drift (it has no pan control)', () => {
    assert.equal(normalizeWholeMix({ fluctuation: { pan } }), null)
    const f = normalizeWholeMix({ fluctuation: { volume: { enabled: true, min: 0.2, max: 0.9 }, pan } }).fluctuation
    assert.equal(f.pan, undefined)
    assert.ok(f.volume.enabled)
  })
})

describe('group drift flags (v0.1.218)', () => {
  const base = { enabled: true, min: -1, max: 1, bias: 0 }

  test('bias and each-sound-on-its-own flags round-trip on a group', () => {
    const f = normalizeGroupFilters({
      fluctuation: { volume: { ...base, min: 0.2, max: 1, biasEnabled: false, perSound: true }, pan: { ...base, perSound: false } }
    }).fluctuation
    assert.equal(f.volume.biasEnabled, false)
    assert.equal(f.volume.perSound, true)
    assert.equal(f.pan.biasEnabled, true)
    assert.equal(f.pan.perSound, false)
  })

  test('a group keeps pitch drift, always per sound, clamped to +/-6 st', () => {
    const f = normalizeGroupFilters({ fluctuation: { pitch: { ...base, min: -20, max: 3, perSound: false } } }).fluctuation
    assert.equal(f.pitch.min, -6)
    assert.equal(f.pitch.perSound, true)
  })

  test('the whole mix keeps bias but never per-sound or pitch', () => {
    const f = normalizeWholeMix({ fluctuation: { volume: { ...base, min: 0.2, max: 1, biasEnabled: false, perSound: true }, pitch: base } }).fluctuation
    assert.equal(f.volume.biasEnabled, false)
    assert.equal(f.volume.perSound, undefined)
    assert.equal(f.pitch, undefined)
  })
})

// v0.1.228: joining a Sound Group also joins the mix (owner report,
// 2026-09-17: a group's own sounds weren't in the mix at all, silent with
// no obvious cause). Uses the real store (electron-store falls back to a
// throwaway path outside Electron - never the real app's presets.json),
// cleaning up after itself.
describe('updatePresetGroups: joining a group also joins the mix', () => {
  test('a sound newly added to a group is added to sounds[] and reported via markIncluded', () => {
    const preset = savePreset({ name: 'probe', sounds: [], wholeMix: null, groups: [] })
    try {
      const marked = []
      const updated = updatePresetGroups(
        preset.id,
        [{ name: 'g', soundIds: ['sound-a'], filters: null }],
        { markIncluded: (id, included) => marked.push([id, included]) }
      )
      assert.deepEqual(marked, [['sound-a', true]])
      assert.ok(updated.sounds.some((s) => s.soundId === 'sound-a'))
      assert.equal(updated.sounds.find((s) => s.soundId === 'sound-a').overrides, null)
    } finally {
      deletePreset(preset.id)
    }
  })

  test('a sound already in the mix is not re-marked or duplicated', () => {
    const preset = savePreset({ name: 'probe', sounds: [{ soundId: 'sound-b', volume: 0.4, overrides: { gainDb: 2 } }], wholeMix: null, groups: [] })
    try {
      const marked = []
      const updated = updatePresetGroups(
        preset.id,
        [{ name: 'g', soundIds: ['sound-b'], filters: null }],
        { markIncluded: (id, included) => marked.push([id, included]) }
      )
      assert.deepEqual(marked, [['sound-b', true]])
      const entries = updated.sounds.filter((s) => s.soundId === 'sound-b')
      assert.equal(entries.length, 1)
      assert.equal(entries[0].volume, 0.4)
      assert.deepEqual(entries[0].overrides, { gainDb: 2 })
    } finally {
      deletePreset(preset.id)
    }
  })

  test('removing a sound from a group does not mark it included', () => {
    const preset = savePreset({ name: 'probe', sounds: [{ soundId: 'sound-c', volume: 1, overrides: null }], wholeMix: null, groups: [{ name: 'g', soundIds: ['sound-c'], filters: null }] })
    try {
      const marked = []
      updatePresetGroups(preset.id, [{ name: 'g', soundIds: [], filters: null }], { markIncluded: (id, included) => marked.push([id, included]) })
      assert.deepEqual(marked, [])
    } finally {
      deletePreset(preset.id)
    }
  })

  test('markIncluded is optional - an unset callback does not throw', () => {
    const preset = savePreset({ name: 'probe', sounds: [], wholeMix: null, groups: [] })
    try {
      assert.doesNotThrow(() => updatePresetGroups(preset.id, [{ name: 'g', soundIds: ['sound-d'], filters: null }]))
    } finally {
      deletePreset(preset.id)
    }
  })
})
