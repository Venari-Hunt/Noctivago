import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { assignGroupColorSlots } from '../src/renderer/ui/SoundRow.js'

// v0.1.241 regression: the badge color used to be a hash straight onto the
// 360-degree hue circle, which spreads uniformly but does nothing to keep two
// groups of the *same preset* apart. The owner's own "Rain Inside" drew
// 105/89/102 - three greens - and they reported the feature as never having
// worked. Groups a person can see side by side must never share a color.
const groups = (n) => Array.from({ length: n }, () => ({ id: crypto.randomUUID() }))

test('every group in a preset gets its own color slot, up to the palette size', () => {
  for (const n of [1, 2, 3, 4, 8, 16]) {
    for (let run = 0; run < 200; run++) {
      const slots = assignGroupColorSlots(groups(n))
      assert.equal(new Set(slots.values()).size, n, `${n} groups should get ${n} distinct slots`)
    }
  }
})

test('the first eight groups get eight different hues, not the same hue re-lit', () => {
  for (let run = 0; run < 200; run++) {
    const slots = [...assignGroupColorSlots(groups(8)).values()]
    // Slot layout is hue-major: slot % 8 is the hue, slot / 8 the lightness
    // tier. Sharing a hue at two lightnesses is the failure mode an earlier
    // attempt at this fix had, and it still reads as "the same color".
    assert.equal(new Set(slots.map((s) => s % 8)).size, 8)
  }
})

test('the same group id keeps its color across renders', () => {
  const list = groups(5)
  const first = assignGroupColorSlots(list)
  const second = assignGroupColorSlots(list)
  for (const g of list) assert.equal(first.get(g.id), second.get(g.id))
})

test('groups without an id are skipped rather than crashing the list', () => {
  const slots = assignGroupColorSlots([{ id: 'a' }, null, {}, { id: '' }, { id: 'b' }])
  assert.deepEqual([...slots.keys()], ['a', 'b'])
  assert.equal(assignGroupColorSlots(undefined).size, 0)
})
