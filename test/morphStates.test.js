import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MORPH_TIMING, morphLabel, importResultLabel } from '../src/renderer/ui/domain/morphStates.js'

test('morph timing matches the approved mock', () => {
  assert.deepEqual(MORPH_TIMING, { workingDelay: 400, doneHold: 1400, failHold: 4200 })
})

test('morph labels are escaped and cut to fit', () => {
  assert.equal(morphLabel('<b>&'), '&lt;b&gt;&amp;')
  assert.equal(morphLabel('  Saved  '), 'Saved')
  assert.equal(morphLabel('x'.repeat(60), 10), 'xxxxxxxxx…')
  assert.equal(morphLabel(null), '')
})

test('import result words', () => {
  assert.deepEqual(importResultLabel({ ok: true, soundCount: 3 }), { state: 'done', text: 'Imported to Presets' })
  assert.deepEqual(importResultLabel({ ok: true, soundCount: 3, failedCount: 1 }), { state: 'done', text: 'Imported, 1 sound missing' })
  assert.deepEqual(importResultLabel({ ok: true, failedCount: 2 }), { state: 'done', text: 'Imported, 2 sounds missing' })
  assert.deepEqual(importResultLabel({ ok: false, error: 'Bad zip' }), { state: 'fail', text: 'Bad zip' })
  assert.deepEqual(importResultLabel(undefined), { state: 'fail', text: 'Import failed' })
})
