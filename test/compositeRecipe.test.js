import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bakedMembers } from '../src/main/ffmpeg/compositeRecipe.js'

test('bakedMembers leaves out muted layers and keeps the input untouched', () => {
  const recipe = [
    { soundId: 'a', delayMs: 0 },
    { soundId: 'b', delayMs: 100, muted: true },
    { soundId: 'c', delayMs: 200, muted: false }
  ]
  assert.deepEqual(bakedMembers(recipe).map((m) => m.soundId), ['a', 'c'])
  assert.equal(recipe.length, 3, 'the saved recipe still has the muted layer')
})

test('an older recipe with no muted field bakes every layer', () => {
  const recipe = [{ soundId: 'a' }, { soundId: 'b' }]
  assert.equal(bakedMembers(recipe).length, 2)
})
