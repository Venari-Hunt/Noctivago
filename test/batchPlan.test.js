import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planBatches, MAX_BATCH_SPAN_SECONDS, BATCH_TAIL_MARGIN_SECONDS } from '../src/main/ffmpeg/batchPlan.js'

const plays = (offsets) => offsets.map((offsetSeconds) => ({ offsetSeconds }))

test('dense plays still group by count', () => {
  const events = plays(Array.from({ length: 50 }, (_, i) => i * 2))
  const batches = planBatches(events, 1, 20)
  assert.deepEqual(batches.map((b) => b.events.length), [20, 20, 10])
  assert.equal(batches[0].start, 0)
  assert.equal(batches[1].start, 40)
})

test('sparse plays never make a batch wider than the span cap', () => {
  // The owner's Beach export: 86 plays of a 25 s shot, one every ~6 min, over 9 h.
  const events = plays(Array.from({ length: 86 }, (_, i) => 5 + i * 376))
  const batches = planBatches(events, 25, 300)
  assert.equal(batches.length, 86)
  for (const b of batches) assert.ok(b.span <= MAX_BATCH_SPAN_SECONDS + BATCH_TAIL_MARGIN_SECONDS)
})

test('every play lands in exactly one batch, in order, inside its span', () => {
  const offsets = [0, 10, 200, 290, 310, 900, 905, 2000]
  const batches = planBatches(plays(offsets), 30, 300)
  assert.deepEqual(batches.flatMap((b) => b.events.map((e) => e.offsetSeconds)), offsets)
  for (const b of batches) {
    for (const e of b.events) assert.ok(e.offsetSeconds + 30 <= b.start + b.span)
  }
})

test('a single shot longer than the cap still gets its own batch', () => {
  const batches = planBatches(plays([0, 1000]), 600, 20)
  assert.equal(batches.length, 2)
  assert.equal(batches[0].span, 600 + BATCH_TAIL_MARGIN_SECONDS)
})

test('per-play shot length and fade-out extend the span', () => {
  const [b] = planBatches([{ offsetSeconds: 10, shotDurationSeconds: 4, fadeOutMs: 1000 }], 99, 20)
  assert.equal(b.span, 5 + BATCH_TAIL_MARGIN_SECONDS)
})
