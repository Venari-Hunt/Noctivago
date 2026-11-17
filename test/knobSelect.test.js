import { test } from 'node:test'
import assert from 'node:assert/strict'
import { knobWheelValue } from '../src/renderer/core/knobSelect.js'

const vol = { value: '500', min: '0', max: '1000', step: '1' }
const notch = (deltaY, extra = {}) => ({ deltaY, deltaX: 0, deltaMode: 0, ...extra })

test('a wheel notch up turns the knob up about 3%, down turns it down', () => {
  assert.equal(knobWheelValue(vol, notch(-100)), 533)
  assert.equal(knobWheelValue(vol, notch(100)), 467)
})

test('side-scroll right turns it up', () => {
  assert.equal(knobWheelValue(vol, { deltaX: 30, deltaY: 0 }), 510)
})

test('Ctrl moves exactly one step', () => {
  assert.equal(knobWheelValue(vol, notch(-100, { ctrlKey: true })), 501)
})

test('a coarse knob still moves one step per notch, snapped to its grid', () => {
  assert.equal(knobWheelValue({ value: '0', min: '-12', max: '12', step: '1' }, notch(-3)), 1)
  assert.equal(knobWheelValue({ value: '0.5', min: '0', max: '10', step: '0.5' }, notch(-1)), 1)
})

test('stops at both ends and ignores a zero wheel', () => {
  assert.equal(knobWheelValue({ ...vol, value: '990' }, notch(-100)), 1000)
  assert.equal(knobWheelValue({ ...vol, value: '10' }, notch(100)), 0)
  assert.equal(knobWheelValue(vol, notch(0)), 500)
})

test('line-mode wheels count 40 px a line', () => {
  assert.equal(knobWheelValue(vol, notch(-3, { deltaMode: 1 })), 540)
})
