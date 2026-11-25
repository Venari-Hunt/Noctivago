import test from 'node:test'
import assert from 'node:assert/strict'
import { ADD_SOUND_ITEMS, presetPill, sleepButtonTitle, sleepRingPercent } from '../src/renderer/toolbar/domain/toolbar.js'

test('the preset pill says "No preset" until one is loaded', () => {
  assert.deepEqual(presetPill(null), { label: 'No preset', count: '', title: 'No preset loaded: click to pick one' })
  assert.equal(presetPill('Rain', 3).label, 'Rain')
})

test('the preset pill counts the mix', () => {
  assert.equal(presetPill('Rain', 1).count, '· 1 sound')
  assert.equal(presetPill('Rain', 10).count, '· 10 sounds')
})

test('the sleep button says when a timer is running', () => {
  assert.equal(sleepButtonTitle(true), 'Sleep timer (running)')
  assert.equal(sleepButtonTitle(false), 'Sleep timer')
  assert.equal(sleepButtonTitle(true, '12:04'), 'Sleep timer: 12:04 left')
})

test('the "+" menu item ids are unique', () => {
  const ids = ADD_SOUND_ITEMS.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('sleep ring length is the share of the whole timer still to run', () => {
  assert.equal(sleepRingPercent(1000, 0, 0), 100)
  assert.equal(sleepRingPercent(1000, 0, 250), 75)
  assert.equal(sleepRingPercent(1000, 0, 1000), 0)
  assert.equal(sleepRingPercent(1000, 0, 5000), 0) // past the end
  assert.equal(sleepRingPercent(1000, 0, -50), 100) // clock went back
  assert.equal(sleepRingPercent(1000, 1000, 0), 0) // zero-length timer
  assert.equal(sleepRingPercent(1000, undefined, 0), 0)
  assert.equal(sleepRingPercent(3600000, 0, 1000), 100) // one second into an hour still rounds to a tenth
  assert.equal(sleepRingPercent(3600000, 0, 3600), 99.9)
})
