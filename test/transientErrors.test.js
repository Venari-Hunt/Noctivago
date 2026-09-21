import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientStatus, isTransient, markTransient, RETRY_DELAYS_MS } from '../src/shared/transientErrors.js'

test('the statuses worth asking again about', () => {
  // The one that actually happened: a GitHub gateway timeout on manifest.json.
  assert.equal(isTransientStatus(504), true)
  for (const status of [408, 425, 429, 500, 502, 503]) assert.equal(isTransientStatus(status), true)
})

test('a missing or forbidden file is not worth retrying', () => {
  for (const status of [200, 301, 400, 401, 403, 404, 410]) assert.equal(isTransientStatus(status), false)
})

test('markTransient round-trips, and a plain error is not transient', () => {
  assert.equal(isTransient(markTransient(new Error('gateway'))), true)
  assert.equal(isTransient(new Error('bad manifest')), false)
  assert.equal(isTransient(null), false)
  assert.equal(isTransient(undefined), false)
})

test('retries are bounded so a manual install never feels hung', () => {
  assert.equal(RETRY_DELAYS_MS.length, 2)
  assert.ok(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) <= 2000)
})
