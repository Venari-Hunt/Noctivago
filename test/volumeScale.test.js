import test from 'node:test'
import assert from 'node:assert/strict'
import { positionToGain, gainToPosition, gainToSlider, sliderToGain, SLIDER_STEPS, VOLUME_MAX_GAIN } from '../src/renderer/core/volumeScale.js'
import { VOLUME_MIN_DB } from '../src/shared/constants.js'

const db = (g) => 20 * Math.log10(g)

test('ends and centre', () => {
  assert.equal(positionToGain(0), 0)
  assert.equal(positionToGain(0.5), 1)
  assert.equal(positionToGain(1), VOLUME_MAX_GAIN)
  assert.equal(gainToSlider(1), SLIDER_STEPS / 2)
  assert.equal(gainToSlider(0), 0)
})

test('quiet side is equal dB per step', () => {
  assert.ok(Math.abs(db(positionToGain(0.25)) - VOLUME_MIN_DB / 2) < 1e-9)
  const step = db(sliderToGain(401)) - db(sliderToGain(400))
  const step2 = db(sliderToGain(101)) - db(sliderToGain(100))
  assert.ok(Math.abs(step - step2) < 1e-9)
  assert.ok(step < 0.15)
})

test('gain round-trips through the slider', () => {
  for (const g of [0.002, 0.01, 0.1, 0.5, 0.7, 1, 1.3, 2]) {
    assert.ok(Math.abs(db(sliderToGain(gainToSlider(g))) - db(g)) < 0.07, `gain ${g}`)
  }
})

test('out-of-range gains clamp to the ends', () => {
  assert.equal(gainToPosition(5), 1)
  assert.equal(gainToPosition(1e-9), 0)
})
