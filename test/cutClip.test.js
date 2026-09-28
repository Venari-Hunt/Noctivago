import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CUT_SECONDS, canCut, cutWindow, loopSeconds, shiftForCut } from '../src/main/community/cutClip.js'

test('only loops longer than 15 s can be cut', () => {
  assert.equal(canCut({ loopStart: 0, loopEnd: 15 }, 60), false)
  assert.equal(canCut({ loopStart: 10, loopEnd: 40 }, 60), true)
  assert.equal(canCut({ loopStart: 0, loopEnd: null }, 120), true)
  assert.equal(canCut({ loopStart: 0, loopEnd: null }, null), false)
  assert.equal(loopSeconds({ loopStart: 5, loopEnd: null }, 20), 15)
})

test('the window is 15 s centered on the loop', () => {
  assert.deepEqual(cutWindow({ loopStart: 10, loopEnd: 50 }, 60), { start: 22.5, end: 37.5 })
  assert.deepEqual(cutWindow({ loopStart: 0, loopEnd: null }, 100), { start: 42.5, end: 57.5 })
  assert.equal(cutWindow({ loopStart: 0, loopEnd: 10 }, 60), null)
})

test('shiftForCut moves the trim and noise sample, keeps absent keys absent', () => {
  const win = { start: 22.5, end: 37.5 }
  const out = shiftForCut(
    { loopStart: 10, loopEnd: 50, filters: { denoiseEnabled: true, denoiseSampleStartSec: 25, denoiseSampleEndSec: 27 } },
    { loopStart: 10, loopEnd: 50 },
    60,
    win
  )
  assert.equal(out.loopStart, 0)
  assert.equal(out.loopEnd, CUT_SECONDS)
  assert.equal(out.filters.denoiseSampleStartSec, 2.5)
  assert.equal(out.filters.denoiseSampleEndSec, 4.5)
  assert.equal(out.filters.denoiseEnabled, true)

  const override = shiftForCut({ playMode: 'loop' }, { loopStart: 10, loopEnd: 50 }, 60, win)
  assert.deepEqual(override, { playMode: 'loop' })
  assert.equal(shiftForCut(null, {}, 60, win), null)
})

test('a noise sample outside the kept 15 s turns noise reduction off', () => {
  const out = shiftForCut(
    { filters: { denoiseEnabled: true, denoiseSampleStartSec: 1, denoiseSampleEndSec: 3 } },
    { loopStart: 0, loopEnd: 60 },
    60,
    { start: 22.5, end: 37.5 }
  )
  assert.equal(out.filters.denoiseEnabled, false)
})

test('the volume envelope is remapped onto the cut loop', () => {
  // Loop 0..40, a ramp from gain 0 at 0 to gain 1 at 1. Window 12.5..27.5.
  const out = shiftForCut(
    { filters: { volumeEnvelope: { enabled: true, points: [{ position: 0, gain: 0 }, { position: 0.5, gain: 1 }, { position: 1, gain: 1 }] } } },
    { loopStart: 0, loopEnd: 40 },
    40,
    { start: 12.5, end: 27.5 }
  )
  const pts = out.filters.volumeEnvelope.points
  assert.equal(pts[0].position, 0)
  assert.ok(Math.abs(pts[0].gain - 0.625) < 1e-9)
  assert.ok(Math.abs(pts[1].position - 0.5) < 1e-9)
  assert.equal(pts[1].gain, 1)
  assert.deepEqual(pts[2], { position: 1, gain: 1 })
  assert.equal(out.filters.volumeEnvelope.enabled, true)
})
