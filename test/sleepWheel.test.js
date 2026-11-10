import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { clampMinutes, splitMinutes, roll, readNumber, minutesFromFields, endClock, wheelDirection, TIMER_MAX_MIN } from '../src/shared/sleepWheel.js'

describe('sleep wheel', () => {
  test('clamps to 1 minute .. a year', () => {
    assert.equal(clampMinutes(0), 1)
    assert.equal(clampMinutes(1e9), TIMER_MAX_MIN)
    assert.equal(clampMinutes('abc'), 1)
  })
  test('split into days, hours, minutes', () => assert.deepEqual(splitMinutes(1500), { d: 1, h: 1, min: 0 }))
  test('the wheel only adds or removes one minute', () => {
    assert.equal(roll(59, true), 60)
    assert.equal(roll(60, false), 59)
    assert.equal(roll(1440, true), 1441)
  })
  test('ends stop dead', () => {
    assert.equal(roll(1, false), null)
    assert.equal(roll(TIMER_MAX_MIN, true), null)
  })
  test('typed fields', () => {
    assert.equal(readNumber('1,5'), 1.5)
    assert.equal(readNumber('1h'), null)
    assert.equal(minutesFromFields('', '1', '30'), 90)
    assert.equal(minutesFromFields('', '0.5', ''), 30)
    assert.equal(minutesFromFields('', '', '90'), 90)
    assert.equal(minutesFromFields('2', '1', '0'), 2940)
    assert.equal(minutesFromFields('', 'x', '1'), null)
  })
  test('end clock: time today, weekday or date later', () => {
    const now = new Date(2026, 10, 10, 20, 0)
    assert.equal(endClock(60, now), '21:00')
    assert.match(endClock(300, now), /^Wed 01:00$/)
    assert.match(endClock(20 * 1440, now), /^[A-Z][a-z]{2} \d+ 20:00$/)
  })
  test('wheel direction: side-scroll and shift+wheel, not plain wheel', () => {
    assert.equal(wheelDirection({ deltaX: 40 }), 1)
    assert.equal(wheelDirection({ deltaX: -3, deltaY: 1 }), -1)
    assert.equal(wheelDirection({ deltaY: 100, shiftKey: true }), 1)
    assert.equal(wheelDirection({ deltaY: 100 }), 0)
  })
})
