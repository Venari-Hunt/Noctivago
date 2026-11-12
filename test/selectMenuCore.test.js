import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepIndex, firstEnabled, lastEnabled, typeAhead, placeMenu } from '../src/renderer/core/selectMenuCore.js'

const items = [
  { label: 'Newest' },
  { label: 'Name', disabled: true },
  { label: 'Oldest' },
  { label: 'Open first' }
]

test('stepIndex skips disabled items and stops at the ends', () => {
  assert.equal(stepIndex(items, 0, 1), 2)
  assert.equal(stepIndex(items, 2, -1), 0)
  assert.equal(stepIndex(items, 0, -1), 0)
  assert.equal(stepIndex(items, 3, 1), 3)
})

test('firstEnabled and lastEnabled', () => {
  assert.equal(firstEnabled(items), 0)
  assert.equal(lastEnabled(items), 3)
  assert.equal(firstEnabled([{ label: 'a', disabled: true }]), -1)
})

test('typeAhead: prefix, cycling on a repeated letter, skips disabled, no match', () => {
  assert.equal(typeAhead(items, 0, 'o'), 2)
  assert.equal(typeAhead(items, 2, 'o'), 3)
  assert.equal(typeAhead(items, 3, 'o'), 2)
  assert.equal(typeAhead(items, 0, 'op'), 3)
  assert.equal(typeAhead(items, 0, 'na'), -1)
  assert.equal(typeAhead(items, 0, ''), -1)
})

test('placeMenu goes below, flips above when cramped, never collapses', () => {
  const rect = { top: 100, bottom: 130 }
  assert.deepEqual(placeMenu(rect, 200, 800), { top: 134, height: 200, flip: false })
  const low = placeMenu({ top: 700, bottom: 730 }, 300, 800)
  assert.equal(low.flip, true)
  assert.equal(low.top, 700 - 4 - 300)
  const tiny = placeMenu({ top: 20, bottom: 50 }, 300, 100)
  assert.ok(tiny.height >= 80)
})
