import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildClipReport,
  fixAmountDb,
  lowerGain,
  lowerGroupGainDb,
  toDb
} from '../src/renderer/tabs/mixer/domain/clipReport.js'

const dbToPeak = (db) => Math.pow(10, db / 20)

describe('fixAmountDb', () => {
  test('adds 1 dB of headroom and rounds up to half a dB', () => {
    assert.equal(fixAmountDb(2.1), 3.5)
    assert.equal(fixAmountDb(0), 1)
    assert.equal(fixAmountDb(1.5), 2.5)
  })
})

describe('lowerGain / lowerGroupGainDb', () => {
  test('lowering a gain by N dB lowers its peak by N dB', () => {
    assert.ok(Math.abs(toDb(lowerGain(1, 6)) + 6) < 1e-9)
  })
  test('group gain stops at the slider floor', () => {
    assert.deepEqual(lowerGroupGainDb(-3, 2), { gainDb: -5, capped: false })
    assert.deepEqual(lowerGroupGainDb(-23, 4), { gainDb: -24, capped: true })
    assert.deepEqual(lowerGroupGainDb(undefined, 2), { gainDb: -2, capped: false })
  })
})

describe('buildClipReport', () => {
  test('a clipping sound gets a fix on that sound', () => {
    const r = buildClipReport({ kind: 'sound', id: 's1', name: 'Thunder', maxPeak: dbToPeak(2.1) })
    assert.equal(r.heading, 'Thunder clipped by +2.1 dB on its own.')
    assert.deepEqual(r.fix, { kind: 'sound', id: 's1', lowerDb: 3.5, label: 'Lower Thunder by 3.5 dB' })
  })

  test('a group whose members add up says so and lists the loudest', () => {
    const r = buildClipReport({
      kind: 'group', id: 'g1', name: 'Outside', maxPeak: dbToPeak(1.4),
      members: [{ id: 'a', name: 'Wind', peak: dbToPeak(-3) }, { id: 'b', name: 'Rain', peak: dbToPeak(-0.5) }, { id: 'c', name: 'Quiet', peak: 0 }]
    })
    assert.equal(r.detail, 'No single sound is too loud; they add up.')
    assert.deepEqual(r.loudest.map((m) => m.label), ['Rain -0.5 dB', 'Wind -3.0 dB'])
    assert.equal(r.fix.kind, 'group')
    assert.equal(r.fix.lowerDb, 2.5)
  })

  test('the mix names a sound that is too loud on its own', () => {
    const r = buildClipReport({
      kind: 'mix', maxPeak: dbToPeak(3.2),
      members: [{ id: 'a', name: 'Thunder', peak: dbToPeak(0.4) }, { id: 'b', name: 'Rain', peak: dbToPeak(-2) }]
    })
    assert.equal(r.heading, 'The whole mix clipped by +3.2 dB.')
    assert.equal(r.detail, 'Thunder is too loud on its own.')
    assert.deepEqual(r.fix, { kind: 'all', lowerDb: 4.5, label: 'Lower every sound by 4.5 dB' })
  })

  test('no fix when the latched peak is below 0 dB', () => {
    const r = buildClipReport({ kind: 'mix', maxPeak: dbToPeak(-1), members: [] })
    assert.equal(r.fix, null)
  })
})
