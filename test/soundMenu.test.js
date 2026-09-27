import test from 'node:test'
import assert from 'node:assert/strict'
import { soundMenuItems, duplicateName } from '../src/renderer/tabs/mixer/domain/soundMenu.js'
import { DEFAULT_VOLUME } from '../src/renderer/core/volumeScale.js'

const base = { status: 'ok', loading: false, included: false, muted: false, soloed: false, volume: DEFAULT_VOLUME }
const byAction = (items) => Object.fromEntries(items.filter((i) => i.action).map((i) => [i.action, i]))

test('labels follow the sound state', () => {
  const idle = byAction(soundMenuItems(base))
  assert.equal(idle.toggleIncluded.label, 'Play (add to mix)')
  assert.equal(idle.toggleSolo.label, 'Solo')
  assert.equal(idle.toggleMute.label, 'Mute')
  const active = byAction(soundMenuItems({ ...base, included: true, soloed: true, muted: true }))
  assert.equal(active.toggleIncluded.label, 'Stop (remove from mix)')
  assert.equal(active.toggleSolo.label, 'Unsolo')
  assert.equal(active.toggleMute.label, 'Unmute')
})

test('reset volume only when the volume moved', () => {
  assert.equal(byAction(soundMenuItems(base)).resetVolume.disabled, true)
  assert.equal(byAction(soundMenuItems({ ...base, volume: 0.3 })).resetVolume.disabled, false)
})

test('a missing file disables everything that needs it', () => {
  const items = byAction(soundMenuItems({ ...base, status: 'missing', volume: 0.3 }))
  for (const action of ['toggleIncluded', 'toggleSolo', 'toggleMute', 'resetVolume', 'duplicate', 'showInFolder']) {
    assert.equal(items[action].disabled, true, action)
  }
})

test('a loading sound can still be duplicated or shown', () => {
  const items = byAction(soundMenuItems({ ...base, loading: true }))
  assert.equal(items.toggleIncluded.disabled, true)
  assert.equal(items.duplicate.disabled, false)
  assert.equal(items.showInFolder.disabled, false)
})

test('duplicate names count up and skip taken ones', () => {
  assert.equal(duplicateName('Rain', ['Rain']), 'Rain (copy)')
  assert.equal(duplicateName('Rain', ['Rain', 'Rain (copy)']), 'Rain (copy 2)')
  assert.equal(duplicateName('Rain (copy)', ['Rain', 'Rain (copy)']), 'Rain (copy 2)')
  assert.equal(duplicateName('Rain (copy 2)', ['Rain (copy)', 'Rain (copy 2)', 'Rain (copy 3)']), 'Rain (copy 4)')
})
