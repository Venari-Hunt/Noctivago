import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { clampMinutes, rulerPercent, minutesFromRuler, readoutText, endClock, wheelStep, stepMinutes } from '../src/shared/sleepRuler.js'

describe('sleep ruler', () => {
  test('clamps to 1 minute .. 24 hours', () => {
    assert.equal(clampMinutes(0), 1)
    assert.equal(clampMinutes(2000), 1440)
    assert.equal(clampMinutes('abc'), 1)
    assert.equal(clampMinutes(29.6), 30)
  })
  test('ruler percent pins past 8 h', () => {
    assert.equal(rulerPercent(240), 50)
    assert.equal(rulerPercent(900), 100)
  })
  test('ruler value snaps to 5 minutes, never 0', () => {
    assert.equal(minutesFromRuler(0), 1)
    assert.equal(minutesFromRuler(182), 180)
    assert.equal(minutesFromRuler(480), 480)
  })
  test('readout', () => {
    assert.equal(readoutText(180), '3 h 00')
    assert.equal(readoutText(45), '0 h 45')
    assert.equal(readoutText(95), '1 h 35')
  })
  test('end clock wraps past midnight', () => {
    assert.equal(endClock(180, new Date(2026, 10, 10, 23, 0)), '02:00')
    assert.equal(endClock(15, new Date(2026, 10, 10, 9, 50)), '10:05')
  })
  test('wheel: side-scroll and shift+wheel step, plain wheel does not', () => {
    assert.equal(wheelStep({ deltaX: 40, deltaY: 0 }), 5)
    assert.equal(wheelStep({ deltaX: -3, deltaY: 1 }), -5)
    assert.equal(wheelStep({ deltaX: 0, deltaY: 100, shiftKey: true }), 5)
    assert.equal(wheelStep({ deltaX: 0, deltaY: 100 }), 0)
  })
  test('stepMinutes snaps to the grid then steps', () => {
    assert.equal(stepMinutes(32, 5), 35)
    assert.equal(stepMinutes(32, -5), 30)
    assert.equal(stepMinutes(1, -5), 1)
    assert.equal(stepMinutes(1438, 5), 1440)
  })
})

import { parseLengthText } from '../src/shared/sleepRuler.js'
describe('typed length', () => {
  test('forms', () => {
    assert.equal(parseLengthText('90'), 90)
    assert.equal(parseLengthText('1:30'), 90)
    assert.equal(parseLengthText('1h30'), 90)
    assert.equal(parseLengthText('3 h 00'), 180)
    assert.equal(parseLengthText('2h'), 120)
    assert.equal(parseLengthText('45 min'), 45)
    assert.equal(parseLengthText('abc'), null)
    assert.equal(parseLengthText(''), null)
  })
})
