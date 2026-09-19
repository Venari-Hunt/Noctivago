import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planPluginSync } from '../src/shared/pluginSync.js'

test('plans loads, unloads, swaps and no-ops', () => {
  const plan = planPluginSync(
    [{ id: 'remix', version: '1.0.0' }, { id: 'export', version: '1.0.0' }, { id: 'old', version: '2.0.0' }],
    [{ id: 'remix', version: '1.1.0' }, { id: 'export', version: '1.0.0' }, { id: 'browse', version: '1.0.0' }]
  )
  assert.deepEqual(plan, { unload: ['old'], load: ['browse'], swap: ['remix'], unchanged: ['export'] })
})

test('a downgrade is a swap too (versions.json can pin an older release)', () => {
  assert.deepEqual(planPluginSync([{ id: 'a', version: '1.1.0' }], [{ id: 'a', version: '1.0.0' }]).swap, ['a'])
})

test('nothing running loads everything in wanted order', () => {
  const plan = planPluginSync([], [{ id: 'b', version: '1' }, { id: 'a', version: '1' }])
  assert.deepEqual(plan.load, ['b', 'a'])
})
