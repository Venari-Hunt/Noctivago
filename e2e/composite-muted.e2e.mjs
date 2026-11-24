// End-to-end: a muted Composite layer stays in the saved recipe but is not baked.
// Talks to the real main process (composite:create / composite:rebake), so it needs
// no plugin. The muted layer starts late (4 s), so a bake that included it would be
// much longer than one without it.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const SOUND_SEC = 2
let app
let page
const wavs = []

function writeTone(file, divisor) {
  const rate = 22050
  const n = rate * SOUND_SEC
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / divisor) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

const soundId = (name) => page.evaluate((n) => window.noctivago.library.list().then((l) => l.find((e) => e.name === n)?.id), name)
const entryNamed = (name) => page.evaluate((n) => window.noctivago.library.list().then((l) => l.find((e) => e.name === n) ?? null), name)

// Length of the baked file in seconds, read the way the Composite tab does.
const bakedSeconds = (name) =>
  page.evaluate(async (n) => {
    const e = (await window.noctivago.library.list()).find((x) => x.name === n)
    return new Promise((resolve, reject) => {
      const a = new Audio(`sound://${e.id}?t=${Date.now()}`)
      a.onloadedmetadata = () => resolve(a.duration)
      a.onerror = () => reject(new Error('could not read the baked file'))
    })
  }, name)

before(async () => {
  const a = path.join(os.tmpdir(), `noctivago-e2e-muted-a-${process.pid}.wav`)
  const b = path.join(os.tmpdir(), `noctivago-e2e-muted-b-${process.pid}.wav`)
  const c = path.join(os.tmpdir(), `noctivago-e2e-muted-c-${process.pid}.wav`)
  wavs.push(a, b, c)
  writeTone(a, 20)
  writeTone(b, 9)
  writeTone(c, 5)
  app = await launchApp()
  page = app.page
  await page.evaluate(async ([pa, pb, pc]) => {
    await window.noctivago.library.addSound({ path: pa, name: 'Muted A', keepCopy: true })
    await window.noctivago.library.addSound({ path: pb, name: 'Muted B', keepCopy: true })
    await window.noctivago.library.addSound({ path: pc, name: 'Muted C', keepCopy: true })
  }, [a, b, c])
})

after(async () => {
  await app?.close()
  for (const f of wavs) {
    try {
      fs.unlinkSync(f)
    } catch {}
  }
})

describe('Composite: muted layers', () => {
  test('a muted layer is not baked, stays in the saved recipe, and reloads muted', async () => {
    const [a, b, c] = [await soundId('Muted A'), await soundId('Muted B'), await soundId('Muted C')]
    const recipe = [
      { soundId: a, delayMs: 0, inSec: 0, outSec: 2, volume: 1 },
      { soundId: b, delayMs: 500, inSec: 0, outSec: 2, volume: 1 },
      { soundId: c, delayMs: 4000, inSec: 0, outSec: 2, volume: 1, muted: true }
    ]
    const made = await page.evaluate((members) => window.noctivago.composite.create({ name: 'E2E muted', members }), recipe)
    assert.equal(made.ok, true)
    const entry = await entryNamed('E2E muted')
    assert.deepEqual(entry.compositeSource.members.map((m) => !!m.muted), [false, false, true], 'the muted layer is still in the recipe')
    const secs = await bakedSeconds('E2E muted')
    assert.ok(secs > 2 && secs < 3.5, `baked without the 4 s muted layer (got ${secs})`)
  })

  test('remaking with the layer unmuted bakes it in; muting it again takes it out', async () => {
    const entry = await entryNamed('E2E muted')
    const members = entry.compositeSource.members
    const remake = (ms) => page.evaluate(([id, m]) => window.noctivago.composite.rebake({ id, name: 'E2E muted', members: m }), [entry.id, ms])
    assert.equal((await remake(members.map((m) => ({ ...m, muted: false })))).ok, true)
    assert.ok((await bakedSeconds('E2E muted')) > 5.5, 'unmuted layer is baked')
    assert.equal((await remake(members)).ok, true)
    const again = await entryNamed('E2E muted')
    assert.ok((await bakedSeconds('E2E muted')) < 3.5, 'muted again, shorter bake')
    assert.equal(again.compositeSource.members[2].muted, true)
  })

  test('fewer than two unmuted layers is refused', async () => {
    const [a, b] = [await soundId('Muted A'), await soundId('Muted B')]
    const r = await page.evaluate(
      ([x, y]) =>
        window.noctivago.composite.create({
          name: 'E2E muted one',
          members: [
            { soundId: x, delayMs: 0, inSec: 0, outSec: 2, volume: 1 },
            { soundId: y, delayMs: 0, inSec: 0, outSec: 2, volume: 1, muted: true }
          ]
        }),
      [a, b]
    )
    assert.equal(r.ok, false)
    assert.equal(await entryNamed('E2E muted one'), null)
  })
})
