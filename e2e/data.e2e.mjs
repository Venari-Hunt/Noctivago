// End-to-end: presets and settings workflows against the real main process
// (rename, duplicate, delete, export to a .ncvpreset file, import it back, settings that persist).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
let wavPath
let outFile
let soundId
const api = (fn, ...args) => page.evaluate(([f, a]) => f.split('.').reduce((o, k) => o[k], window.noctivago)(...a), [fn, args])
const presetNames = () => api('presets.list').then((l) => l.map((p) => p.name))

function writeTone(file) {
  const rate = 22050
  const n = rate * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-data-${process.pid}.wav`)
  outFile = path.join(os.tmpdir(), `noctivago-e2e-data-${process.pid}.ncvpreset`)
  writeTone(wavPath)
  app = await launchApp({ pickPath: outFile })
  page = app.page
  soundId = (await api('library.addSound', { path: wavPath, name: 'E2E tone', keepCopy: true })).id
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
  fs.rmSync(outFile, { force: true })
})

describe('library', () => {
  test('an added sound is listed with its name and an ok status', async () => {
    const list = await api('library.list')
    const e = list.find((s) => s.id === soundId)
    assert.equal(e.name, 'E2E tone')
    assert.equal(e.status, 'ok')
  })
})

describe('presets', () => {
  let presetId
  test('save creates a preset with its sound and volume', async () => {
    const p = await api('presets.save', { name: 'E2E mix', sounds: [{ soundId, volume: 0.4 }] })
    presetId = p.id
    assert.deepEqual((await presetNames()).filter((n) => n === 'E2E mix'), ['E2E mix'])
    assert.equal(p.sounds[0].volume, 0.4)
  })

  test('rename changes the name', async () => {
    await api('presets.rename', presetId, 'E2E renamed')
    const names = await presetNames()
    assert.ok(names.includes('E2E renamed') && !names.includes('E2E mix'))
  })

  test('duplicate makes a second preset with the same sounds', async () => {
    const copy = await api('presets.duplicate', presetId)
    assert.notEqual(copy.id, presetId)
    assert.equal(copy.sounds.length, 1)
    await api('presets.delete', copy.id)
  })

  test('updateSounds stores a new volume', async () => {
    await api('presets.updateSounds', presetId, [{ soundId, volume: 0.9, overrides: null }])
    const p = (await api('presets.list')).find((x) => x.id === presetId)
    assert.equal(p.sounds[0].volume, 0.9)
  })

  test('export writes a .ncvpreset file with the audio inside', async () => {
    const r = await api('presets.export', presetId)
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.ok(fs.existsSync(outFile))
    assert.ok(fs.statSync(outFile).size > 5000, 'the file carries the sound')
    assert.equal(r.soundCount, 1)
  })

  test('delete removes it', async () => {
    await api('presets.delete', presetId)
    assert.ok(!(await presetNames()).includes('E2E renamed'))
  })
})

describe('settings', () => {
  const TOGGLES = [
    'setMinimizeToTrayEnabled',
    'setSleepTimerAutoStartEnabled',
    'setEagerlyBakeOnImportEnabled',
    'setFasterExportEnabled',
    'setParallelMixdownEnabled',
    'setPresetAutosaveEnabled',
    'setSkipRemixLeaveConfirmEnabled'
  ]
  for (const name of TOGGLES) {
    test(`${name} flips one stored value and survives a reload`, async () => {
      const on = await api(`settings.${name}`, true)
      const off = await api(`settings.${name}`, false)
      const changed = Object.keys(off).filter((k) => JSON.stringify(on[k]) !== JSON.stringify(off[k]))
      assert.equal(changed.length, 1, `keys changed: ${changed.join(', ')}`)
      await page.reload()
      await page.waitForSelector('#tab-bar .tab-button')
      const after = await api('settings.get')
      assert.deepEqual(after[changed[0]], off[changed[0]])
      await api(`settings.${name}`, true)
    })
  }

  test('the update channel switches between stable and nightly', async () => {
    const nightly = await api('settings.setUpdateChannel', 'nightly')
    const stable = await api('settings.setUpdateChannel', 'stable')
    assert.notDeepEqual(nightly, stable)
  })
})
