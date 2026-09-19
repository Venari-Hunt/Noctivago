import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { busFluctuation, effectiveMemberFluctuation, applyGroupShotOverride, groupDriftMemberKey } from '../src/shared/groupDrift.js'

const timing = { changeMinSeconds: 2, changeMaxSeconds: 4, transitionSeconds: 1 }
const axis = (extra) => ({ enabled: true, fullyRandom: false, biasEnabled: true, min: -0.4, max: 0.6, bias: 0.1, ...timing, ...extra })

describe('busFluctuation', () => {
  test('keeps shared volume/pan, drops per-sound axes and pitch', () => {
    const f = { volume: axis({ min: 0.2, max: 1, bias: 0.5 }), pan: axis({ perSound: true }), pitch: axis() }
    const bus = busFluctuation(f)
    assert.deepEqual(Object.keys(bus), ['volume'])
  })

  test('nothing shared -> null', () => {
    assert.equal(busFluctuation({ pan: axis({ perSound: true }) }), null)
    assert.equal(busFluctuation(null), null)
  })
})

describe('effectiveMemberFluctuation', () => {
  const own = { volume: axis({ enabled: false }), pitch: axis({ enabled: false }), pan: axis({ min: -1, max: -1, bias: -1 }) }

  test('no group -> the sound\'s own drift, untouched', () => {
    assert.equal(effectiveMemberFluctuation(own, null), own)
  })

  test('shared group pan switches the member\'s own pan drift off', () => {
    const out = effectiveMemberFluctuation(own, { pan: axis() })
    assert.equal(out.pan.enabled, false)
    assert.equal(out.pan.min, -1)
  })

  // v0.1.231: a shared (non-per-sound) group axis is meant to move every
  // member together - before this fix, only pan actually switched a
  // member's own drift off; a shared group volume drift left members free
  // to also wander their own volume independently, out of sync with the
  // group. Caught from a direct question about whether members stay in
  // sync, not a reported bug.
  test('shared group volume switches the member\'s own volume drift off, same as pan', () => {
    const withOwnVolume = { ...own, volume: axis({ min: -1, max: -1, bias: -1 }) }
    const out = effectiveMemberFluctuation(withOwnVolume, { volume: axis() })
    assert.equal(out.volume.enabled, false)
    assert.equal(out.volume.min, -1)
  })

  test('a disabled member volume axis stays disabled under a shared group volume drift', () => {
    const out = effectiveMemberFluctuation(own, { volume: axis() })
    assert.equal(out.volume.enabled, false)
  })

  test('per-sound group axes replace the member\'s own settings', () => {
    const groupVol = axis({ perSound: true, min: 0.3, max: 0.9, bias: 0.6 })
    const out = effectiveMemberFluctuation(own, { volume: groupVol, pan: axis({ perSound: true }) })
    assert.equal(out.volume.enabled, true)
    assert.equal(out.volume.min, 0.3)
    assert.equal(out.pan.enabled, true)
    assert.equal(out.pan.min, -0.4)
  })

  test('group pitch always applies per sound, even without the flag', () => {
    const out = effectiveMemberFluctuation(null, { pitch: axis({ min: -2, max: 2, bias: 0 }) })
    assert.equal(out.pitch.enabled, true)
    assert.equal(out.pitch.max, 2)
  })

  test('a disabled group axis changes nothing', () => {
    assert.equal(effectiveMemberFluctuation(own, { volume: axis({ enabled: false, perSound: true }) }), own)
  })
})

describe('applyGroupShotOverride', () => {
  const scatter = { minGapSeconds: 5, minPitchSemitones: 3, maxPitchSemitones: 3, minVolume: 1, maxVolume: 1 }

  test('per-sound axes become the per-play range; other fields stay', () => {
    const out = applyGroupShotOverride(scatter, {
      volume: axis({ perSound: true, min: 0.2, max: 0.8, bias: 0.5 }),
      pan: axis({ perSound: true, biasEnabled: false })
    })
    assert.equal(out.minGapSeconds, 5)
    assert.equal(out.minVolume, 0.2)
    assert.equal(out.maxVolume, 0.8)
    assert.equal(out.volumeBias, 0.5)
    assert.equal(out.volumeBiasEnabled, true)
    assert.equal(out.minPan, -0.4)
    assert.equal(out.panBiasEnabled, false)
    assert.equal(out.minPitchSemitones, 3) // no group pitch -> own pitch kept
  })

  test('shared (not per-sound) axes leave per-play settings alone', () => {
    assert.equal(applyGroupShotOverride(scatter, { volume: axis({ min: 0.2, max: 0.8 }), pan: axis() }), scatter)
  })

  test('fully random maps to the drift range as explicit bounds', () => {
    const out = applyGroupShotOverride(scatter, { pitch: axis({ fullyRandom: true }) })
    assert.equal(out.minPitchSemitones, -6)
    assert.equal(out.maxPitchSemitones, 6)
    assert.equal(out.pitchFullyRandom, false)
    assert.equal(out.pitchBiasEnabled, false)
  })
})

describe('groupDriftMemberKey', () => {
  test('changes only when what members receive changes', () => {
    const a = groupDriftMemberKey({ volume: axis({ min: 0.2 }) })
    const b = groupDriftMemberKey({ volume: axis({ min: 0.5 }) })
    assert.equal(a, b) // a shared volume's own min/max never reaches members, only on/off does
    assert.notEqual(groupDriftMemberKey({ volume: axis({ perSound: true }) }), a)
    assert.notEqual(groupDriftMemberKey({ pan: axis() }), groupDriftMemberKey(null))
    // v0.1.231: toggling a shared volume drift on/off now switches members'
    // own volume drift off/on too, so it must change the key the same way
    // a shared pan drift already did (see the effectiveMemberFluctuation
    // fix above) - this used to be a no-op key (a real gap this closes).
    assert.notEqual(a, groupDriftMemberKey(null))
  })
})
