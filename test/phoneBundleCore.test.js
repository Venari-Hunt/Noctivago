import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  busReverbs,
  withoutReverb,
  needsCut,
  loopWrapPlan,
  phoneSettings,
  memoryWarning,
  decodedBytes
} from '../src/main/phone/phoneBundleCore.js'

test('bus reverbs run group first, then whole mix, skipping inactive ones', () => {
  assert.deepEqual(busReverbs({ reverbSizeMs: 1000, reverbMix: 0.3 }, { reverbSizeMs: 2000, reverbMix: 0.5 }), [
    { sizeMs: 1000, mix: 0.3 },
    { sizeMs: 2000, mix: 0.5 }
  ])
  assert.deepEqual(busReverbs({ reverbSizeMs: 1000, reverbMix: 0 }, null), [])
  assert.deepEqual(busReverbs(null, { reverbSizeMs: 0, reverbMix: 0.5 }), [])
})

test('occlusion alone implies a bus reverb', () => {
  const [reverb] = busReverbs({ occlusion: 1 }, null)
  assert.ok(reverb.sizeMs > 0 && reverb.mix > 0)
})

test('withoutReverb keeps the occluded lowpass and clears reverb', () => {
  const out = withoutReverb({ occlusion: 1, reverbSizeMs: 500, reverbMix: 0.2, gainDb: 3 })
  assert.equal(out.reverbMix, 0)
  assert.equal(out.reverbSizeMs, 0)
  assert.equal(out.occlusion, 0)
  assert.equal(out.gainDb, 3)
  assert.ok(out.lowpassHz < 20000)
  assert.equal(withoutReverb(null), null)
})

test('only loops over 10 minutes get cut', () => {
  assert.equal(needsCut({ loopStart: 0, loopEnd: 600 }, 900), false)
  assert.equal(needsCut({ loopStart: 0, loopEnd: null }, 900), true)
  assert.equal(needsCut({ loopStart: 0, loopEnd: null }, null), false)
})

test('the loop wrap covers the impulse before the kept copy', () => {
  assert.deepEqual(loopWrapPlan(10, 2), { copies: 2, keepFromSeconds: 10 })
  assert.deepEqual(loopWrapPlan(1.5, 4), { copies: 4, keepFromSeconds: 4.5 })
  const { copies, keepFromSeconds } = loopWrapPlan(3, 3)
  assert.ok(keepFromSeconds >= 3 && copies === 2)
})

test('phone settings loop the whole clip and keep the live parts', () => {
  const scatter = { minSeconds: 5, maxSeconds: 20 }
  const fluctuation = { enabled: true }
  const out = phoneSettings(
    { playMode: 'scatter', loopStart: 3, loopEnd: 9, crossfadeSeconds: 0.5, speedPitch: { speed: 2 }, filters: { pan: 0.4 }, scatter, fluctuation },
    6.2
  )
  assert.equal(out.loopStart, 0)
  assert.equal(out.loopEnd, 6.2)
  assert.equal(out.crossfadeSeconds, 0)
  assert.equal(out.speedPitch, null)
  assert.deepEqual(out.filters, {})
  assert.equal(out.playMode, 'scatter')
  assert.equal(out.scatter, scatter)
  assert.equal(out.fluctuation, fluctuation)
})

test('memory warning only past the budget', () => {
  assert.equal(decodedBytes(1), 384000)
  assert.equal(memoryWarning(600), null)
  assert.match(memoryWarning(1200), /about 439 MB/)
})
