import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { clampMinutes, splitMinutes, roll, readNumber, minutesFromFields, endClock, wheelDirection } from '../src/shared/sleepWheel.js'

describe('sleep wheel', () => {
  test('clamps to 1 minute .. 24 hours', () => {
    assert.equal(clampMinutes(0), 1)
    assert.equal(clampMinutes(2000), 1440)
    assert.equal(clampMinutes('abc'), 1)
  })
  test('split', () => assert.deepEqual(splitMinutes(95), { h: 1, min: 35 }))
  test('rolling minutes up carries into hours and moves the wheel there', () => {
    assert.deepEqual(roll(59, 'min', true), { minutes: 60, unit: 'h' })
    assert.deepEqual(roll(30, 'min', true), { minutes: 31, unit: 'min' })
  })
  test('rolling hours', () => {
    assert.deepEqual(roll(120, 'h', true), { minutes: 180, unit: 'h' })
    assert.deepEqual(roll(120, 'h', false), { minutes: 60, unit: 'h' })
    assert.deepEqual(roll(60, 'h', false), null) // 0 min is not a timer
    assert.deepEqual(roll(90, 'h', false), { minutes: 30, unit: 'min' })
  })
  test('ends stop dead', () => {
    assert.equal(roll(1, 'min', false), null)
    assert.equal(roll(1440, 'h', true), null)
    assert.equal(roll(1440, 'min', true), null)
  })
  test('typed fields', () => {
    assert.equal(readNumber('1,5'), 1.5)
    assert.equal(readNumber('1h'), null)
    assert.equal(minutesFromFields('1', '30'), 90)
    assert.equal(minutesFromFields('0.5', ''), 30)
    assert.equal(minutesFromFields('', '90'), 90)
    assert.equal(minutesFromFields('x', '1'), null)
  })
  test('end clock wraps past midnight', () => {
    assert.equal(endClock(180, new Date(2026, 10, 10, 23, 0)), '02:00')
  })
  test('wheel direction: side-scroll and shift+wheel, not plain wheel', () => {
    assert.equal(wheelDirection({ deltaX: 40 }), 1)
    assert.equal(wheelDirection({ deltaX: -3, deltaY: 1 }), -1)
    assert.equal(wheelDirection({ deltaY: 100, shiftKey: true }), 1)
    assert.equal(wheelDirection({ deltaY: 100 }), 0)
  })
})
