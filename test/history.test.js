import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, CAP, MERGE_MS } from '../src/renderer/core/history.js'

function setup(opts = {}) {
  const clock = { t: 1000 }
  const h = createHistory({ now: () => clock.t, ...opts })
  const log = []
  const entry = (name, extra = {}) => ({
    label: name, undo: () => log.push('undo ' + name), redo: () => log.push('redo ' + name), ...extra,
  })
  return { h, clock, log, entry }
}

test('push, undo, redo run the right functions in order', () => {
  const { h, log, entry } = setup()
  h.push(entry('a'))
  h.push(entry('b'))
  assert.ok(h.canUndo() && !h.canRedo())
  assert.equal(h.undo(), true)
  assert.equal(h.undo(), true)
  assert.equal(h.undo(), false)
  assert.equal(h.redo(), true)
  assert.deepEqual(log, ['undo b', 'undo a', 'redo a'])
  assert.ok(h.canUndo() && h.canRedo())
})

test('peekLabels names the next undo and redo', () => {
  const { h, entry } = setup()
  assert.deepEqual(h.peekLabels(), { undo: null, redo: null })
  h.push(entry('volume of Rain'))
  h.push(entry('mute of Wind'))
  h.undo()
  assert.deepEqual(h.peekLabels(), { undo: 'volume of Rain', redo: 'mute of Wind' })
})

test('a new push clears the redo stack', () => {
  const { h, entry } = setup()
  h.push(entry('a'))
  h.undo()
  assert.ok(h.canRedo())
  h.push(entry('b'))
  assert.ok(!h.canRedo())
})

test('same mergeKey within the window merges: first undo, last redo', () => {
  const { h, clock, log, entry } = setup()
  h.push(entry('v1', { mergeKey: 'vol:x' }))
  clock.t += MERGE_MS - 1
  h.push(entry('v2', { mergeKey: 'vol:x' }))
  clock.t += MERGE_MS - 1 // window is measured from the latest push, so a drag keeps merging
  h.push(entry('v3', { mergeKey: 'vol:x' }))
  assert.deepEqual(h.peekLabels(), { undo: 'v3', redo: null })
  h.undo()
  h.redo()
  assert.deepEqual(log, ['undo v1', 'redo v3'])
  assert.ok(h.canUndo())
  h.undo()
  assert.ok(!h.canUndo())
})

test('no merge after the window, with another key, or without a key', () => {
  const { h, clock, entry } = setup()
  h.push(entry('a', { mergeKey: 'k' }))
  clock.t += MERGE_MS + 1
  h.push(entry('b', { mergeKey: 'k' }))
  h.push(entry('c', { mergeKey: 'other' }))
  h.push(entry('d'))
  h.push(entry('e'))
  let n = 0
  while (h.undo()) n++
  assert.equal(n, 5)
})

test('no merge into an entry that was undone and redone', () => {
  const { h, entry } = setup()
  h.push(entry('a', { mergeKey: 'k' }))
  h.undo()
  h.redo()
  h.push(entry('b', { mergeKey: 'k' }))
  let n = 0
  while (h.undo()) n++
  assert.equal(n, 2)
})

test('cap drops the oldest entries', () => {
  const { h, log, entry } = setup()
  for (let i = 0; i < CAP + 5; i++) h.push(entry('e' + i))
  let n = 0
  while (h.undo()) n++
  assert.equal(n, CAP)
  assert.equal(log[log.length - 1], 'undo e5')
  const small = setup({ cap: 2 })
  for (const k of ['a', 'b', 'c']) small.h.push(small.entry(k))
  assert.deepEqual(small.h.peekLabels(), { undo: 'c', redo: null })
  small.h.undo(); small.h.undo()
  assert.ok(!small.h.canUndo())
})

test('clear empties both stacks and notifies once', () => {
  const { h, entry } = setup()
  h.push(entry('a'))
  h.push(entry('b'))
  h.undo()
  let calls = 0
  h.onChange(() => calls++)
  h.clear()
  assert.ok(!h.canUndo() && !h.canRedo())
  assert.equal(calls, 1)
  h.clear() // already empty: no notification
  assert.equal(calls, 1)
})

test('onChange fires on push, merge, undo, redo; unsubscribe stops it', () => {
  const { h, entry } = setup()
  let calls = 0
  const off = h.onChange(() => calls++)
  h.push(entry('a', { mergeKey: 'k' }))
  h.push(entry('b', { mergeKey: 'k' }))
  h.undo()
  h.redo()
  assert.equal(calls, 4)
  off()
  h.undo()
  assert.equal(calls, 4)
})

test('pushes made while an undo or redo runs are ignored', () => {
  const { h, entry } = setup()
  h.push({ label: 'a', undo: () => h.push(entry('echo')), redo: () => h.push(entry('echo')) })
  h.undo()
  assert.ok(!h.canUndo())
  assert.equal(h.peekLabels().redo, 'a')
  h.redo()
  assert.equal(h.peekLabels().undo, 'a')
  assert.ok(!h.canRedo())
})

test('an undo that throws keeps the entry on the stack', () => {
  const { h } = setup()
  h.push({ label: 'a', undo: () => { throw new Error('boom') }, redo: () => {} })
  assert.throws(() => h.undo(), /boom/)
  assert.ok(h.canUndo() && !h.canRedo())
  h.push({ label: 'b', undo: () => {}, redo: () => {} })
  assert.equal(h.undo(), true) // later pushes still work (not stuck running)
})

test('push returns the entry; latest() is the next undo; remove() drops it from either stack', () => {
  const { h, entry } = setup()
  assert.equal(h.latest(), null)
  const a = h.push(entry('a'))
  const b = h.push(entry('b'))
  assert.equal(h.latest(), b)
  assert.equal(h.remove(a), true)
  assert.equal(h.remove(a), false)
  assert.deepEqual(h.peekLabels(), { undo: 'b', redo: null })
  h.undo()
  assert.equal(h.latest(), null)
  assert.equal(h.remove(b), true) // it was on the redo stack
  assert.ok(!h.canUndo() && !h.canRedo())
})

test('remove() notifies once and stops a merge into the removed entry', () => {
  const { h, entry } = setup()
  let calls = 0
  h.onChange(() => calls++)
  const a = h.push({ ...entry('a'), mergeKey: 'k' })
  assert.equal(calls, 1)
  h.remove(a)
  assert.equal(calls, 2)
  h.push({ ...entry('b'), mergeKey: 'k' })
  assert.deepEqual(h.peekLabels(), { undo: 'b', redo: null })
  h.undo()
  assert.ok(!h.canUndo()) // b stood alone, it did not merge into the removed a
})

test('push without undo and redo functions throws', () => {
  const { h } = setup()
  assert.throws(() => h.push({ label: 'x' }), TypeError)
})
