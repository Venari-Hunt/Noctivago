import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rangeWheelValue } from '../src/renderer/core/numberBoxStepper.js'

const vol = { value: '500', min: '0', max: '1000', step: '1' }

test('wheel moves 1% of the travel, Ctrl moves one step', () => {
  assert.equal(rangeWheelValue(vol, 1, false), 510)
  assert.equal(rangeWheelValue(vol, -1, false), 490)
  assert.equal(rangeWheelValue(vol, 1, true), 501)
})

test('stops at both ends', () => {
  assert.equal(rangeWheelValue({ ...vol, value: '1000' }, 1, false), 1000)
  assert.equal(rangeWheelValue({ ...vol, value: '0' }, -1, false), 0)
})

test('a short seek bar still moves at least one step', () => {
  assert.equal(rangeWheelValue({ value: '1', min: '0', max: '5', step: '0.1' }, 1, false), 1.1)
})
