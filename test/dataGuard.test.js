import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  compareVersions,
  planDataGuard,
  runDataGuard,
  listSnapshots,
  readStamp,
  takeSnapshot,
  pruneSnapshots
} from '../src/main/dataGuardCore.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ncv-guard-'))
const write = (dir, file, data) => fs.writeFileSync(path.join(dir, file), JSON.stringify(data))
const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))

test('versions sort like semver, nightlies below their release', () => {
  assert.equal(compareVersions('2.0.1', '2.0.0'), 1)
  assert.equal(compareVersions('2.0.1-nightly.20261111.4', '2.0.1'), -1)
  assert.equal(compareVersions('2.0.1-nightly.20261111.4', '2.0.0'), 1)
  assert.equal(compareVersions('2.0.1-nightly.20261112.1', '2.0.1-nightly.20261111.9'), 1)
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
})

test('plan: first run stamps, an upgrade snapshots, a same-schema downgrade only stamps', () => {
  const app = { version: '2.0.0', schema: 1 }
  assert.equal(planDataGuard(null, app).action, 'stamp')
  assert.equal(planDataGuard({ schema: 1, version: '1.9.0' }, app).action, 'snapshot')
  assert.equal(planDataGuard({ schema: 1, version: '2.0.1-nightly.20261111.1' }, app).action, 'stamp')
})

test('plan: a downgrade across a schema change restores the newest readable snapshot, else blocks', () => {
  const app = { version: '2.0.0', schema: 1 }
  const snaps = [
    { name: 'b', meta: { version: '2.0.1-nightly.2', schema: 2, reason: 'upgrade' } },
    { name: 'a', meta: { version: '2.0.0', schema: 1, reason: 'upgrade' } }
  ]
  const plan = planDataGuard({ schema: 2, version: '2.0.1-nightly.3' }, app, snaps)
  assert.equal(plan.action, 'restore')
  assert.equal(plan.snapshot.name, 'a')
  assert.equal(planDataGuard({ schema: 2, version: '2.0.1-nightly.3' }, app, [snaps[0]]).action, 'block')
})

test('nightly round trip: stable data comes back, nightly data is kept aside, channel choice survives', () => {
  const dir = tmp()
  // Stable 2.0.0 runs with its data.
  write(dir, 'library.json', { sounds: ['rain'] })
  write(dir, 'settings.json', { updateChannel: 'stable' })
  runDataGuard(dir, { version: '2.0.0', schema: 1 })
  assert.deepEqual(readStamp(dir).version, '2.0.0')

  // The user picks Nightly; the nightly (schema 2) starts: snapshot of the stable data first.
  write(dir, 'settings.json', { updateChannel: 'nightly' })
  const up = runDataGuard(dir, { version: '2.0.1-nightly.20261111.1', schema: 2 })
  assert.equal(up.action, 'snapshot')
  write(dir, 'library.json', { tracks: [{ name: 'rain' }, { name: 'wind' }] }) // new shape

  // Back to Stable: chosen in the nightly, then stable 2.0.0 starts.
  write(dir, 'settings.json', { ...read(dir, 'settings.json'), updateChannel: 'stable' })
  const down = runDataGuard(dir, { version: '2.0.0', schema: 1 })
  assert.equal(down.action, 'restore')
  assert.deepEqual(read(dir, 'library.json'), { sounds: ['rain'] })
  assert.equal(read(dir, 'settings.json').updateChannel, 'stable')
  assert.equal(readStamp(dir).schema, 1)
  const aside = listSnapshots(dir).find((s) => s.meta.reason === 'set-aside')
  assert.deepEqual(read(aside.dir, 'library.json'), { tracks: [{ name: 'rain' }, { name: 'wind' }] })
})

test('no readable snapshot: start empty, keep the newer data aside, never crash', () => {
  const dir = tmp()
  write(dir, 'library.json', { tracks: [] })
  write(dir, 'settings.json', { updateChannel: 'stable' })
  fs.writeFileSync(path.join(dir, 'data-version.json'), JSON.stringify({ schema: 2, version: '2.1.0-nightly.1' }))
  const r = runDataGuard(dir, { version: '2.0.0', schema: 1 })
  assert.equal(r.action, 'block')
  assert.equal(fs.existsSync(path.join(dir, 'library.json')), false)
  assert.equal(read(dir, 'settings.json').updateChannel, 'stable')
  assert.ok(fs.existsSync(path.join(r.asideDir, 'library.json')))
})

test('data from before the guard gets a snapshot on its first stamped run', () => {
  const dir = tmp()
  write(dir, 'library.json', { sounds: ['old'] })
  const r = runDataGuard(dir, { version: '2.0.0', schema: 1 })
  assert.equal(r.action, 'snapshot')
  assert.equal(listSnapshots(dir).length, 1)
})

test('pruning keeps the newest three plus the newest of each schema', () => {
  const dir = tmp()
  write(dir, 'library.json', {})
  takeSnapshot(dir, { version: '2.0.0', schema: 1, reason: 'upgrade' })
  for (let i = 1; i <= 5; i++) takeSnapshot(dir, { version: `2.0.1-nightly.${i}`, schema: 2, reason: 'upgrade' })
  pruneSnapshots(dir, 3)
  const names = listSnapshots(dir).map((s) => s.meta.version)
  assert.deepEqual(names, ['2.0.1-nightly.5', '2.0.1-nightly.4', '2.0.1-nightly.3', '2.0.0'])
})
