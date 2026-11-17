import test from 'node:test'
import assert from 'node:assert/strict'
import { createInFlight } from '../src/renderer/tabs/mixer/domain/inFlight.js'

test('two concurrent calls for one id build one source', async () => {
  const once = createInFlight()
  let built = 0
  const build = async () => { built++; await new Promise((r) => setTimeout(r, 10)); return { n: built } }
  const [a, b] = await Promise.all([once('raven', build), once('raven', build)])
  assert.equal(built, 1)
  assert.equal(a, b)
})

test('different ids run separately; a later call runs again after settle', async () => {
  const once = createInFlight()
  let built = 0
  const build = async () => ++built
  await Promise.all([once('a', build), once('b', build)])
  assert.equal(built, 2)
  await once('a', build)
  assert.equal(built, 3)
})

test('a failure clears the slot so a retry can run', async () => {
  const once = createInFlight()
  await assert.rejects(once('x', async () => { throw new Error('boom') }))
  assert.equal(await once('x', async () => 'ok'), 'ok')
})
