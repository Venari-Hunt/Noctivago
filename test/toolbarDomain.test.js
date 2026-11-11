import test from 'node:test'
import assert from 'node:assert/strict'
import { ADD_SOUND_ITEMS, presetPill, sleepButtonTitle } from '../src/renderer/toolbar/domain/toolbar.js'

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
})

test('the "+" menu item ids are unique', () => {
  const ids = ADD_SOUND_ITEMS.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length)
})
