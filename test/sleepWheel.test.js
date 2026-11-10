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
  test('rolling up carries minutes into hours and hours into days', () => {
    assert.deepEqual(roll(59, 'min', true), { minutes: 60, unit: 'h' })
    assert.deepEqual(roll(30, 'min', true), { minutes: 31, unit: 'min' })
    assert.deepEqual(roll(1380, 'h', true), { minutes: 1440, unit: 'd' })
    assert.deepEqual(roll(1440, 'd', true), { minutes: 2880, unit: 'd' })
  })
  test('rolling down drops to the next smaller unit', () => {
    assert.deepEqual(roll(120, 'h', false), { minutes: 60, unit: 'h' })
    assert.deepEqual(roll(90, 'h', false), { minutes: 30, unit: 'min' })
    assert.deepEqual(roll(60, 'h', false), { minutes: 59, unit: 'min' })
    assert.deepEqual(roll(1440, 'd', false), { minutes: 1380, unit: 'h' })
  })
  test('ends stop dead', () => {
    assert.equal(roll(1, 'min', false), null)
    assert.equal(roll(TIMER_MAX_MIN, 'd', true), null)
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
