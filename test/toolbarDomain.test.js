import test from 'node:test'
import assert from 'node:assert/strict'
import { ADD_SOUND_ITEMS, presetIndicator, sleepButtonTitle } from '../src/renderer/toolbar/domain/toolbar.js'

test('the preset indicator dims to "No preset" until one is loaded', () => {
  assert.deepEqual(presetIndicator(null), { hasPreset: false, label: 'No preset', sub: 'No sounds yet', title: 'No preset loaded' })
  assert.deepEqual(presetIndicator('Rain', 3), { hasPreset: true, label: 'Rain', sub: '3 sounds · saves as you go', title: 'Editing preset "Rain"' })
})

test('the preset subtitle counts the mix, with and without a preset', () => {
  assert.equal(presetIndicator('Rain', 1).sub, '1 sound · saves as you go')
  assert.equal(presetIndicator(null, 2).sub, '2 sounds in the mix')
})

test('the sleep button says when a timer is running', () => {
  assert.equal(sleepButtonTitle(true), 'Sleep timer (running)')
  assert.equal(sleepButtonTitle(false), 'Sleep timer')
})

test('the "+" menu item ids are unique', () => {
  const ids = ADD_SOUND_ITEMS.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length)
})
