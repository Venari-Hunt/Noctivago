// End-to-end: the preset pill (Desktop 2.0 step 13d) with Save changes as I go OFF:
// an edit shows "Unsaved changes"; Save > Saving > Changes saved; Cancel > Changes canceled.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
let wavPath
const settle = (ms = 400) => page.waitForTimeout(ms)
const pill = () => page.locator('.preset-pill')

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
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-presets-${process.pid}.wav`)
  writeTone(wavPath)
  app = await launchApp()
  page = app.page
  await page.evaluate(async (p) => {
    const sound = await window.noctivago.library.addSound({ path: p, name: 'E2E tone', keepCopy: true })
    await window.noctivago.presets.save({ name: 'E2E preset', sounds: [{ soundId: sound.id, volume: 0.5 }] })
  }, wavPath)
  await page.reload()
  await page.waitForSelector('.sound-row')
  await app.dismissToasts()
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

describe('preset pill', () => {
  test('loading the preset puts its name in the pill', async () => {
    await pill().click()
    await settle()
    await page.getByText('E2E preset').first().click()
    await settle(1200)
    assert.match(await pill().innerText(), /E2E preset/)
    assert.ok((await pill().getAttribute('class')).includes('norm'))
  })

  const nudgeVolume = (value) =>
    page.evaluate((v) => {
      const el = document.querySelector('.sound-row .volume-slider-wrap input[type="range"]')
      el.value = String(v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)

  test('Save changes as I go ON: Changes made, then Changes saved, then the name again', async () => {
    await nudgeVolume(900)
    await page.waitForFunction(() => /Changes made|Saving|Changes saved/.test(document.querySelector('.preset-pill')?.innerText ?? ''), null, { timeout: 3000 })
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector('.preset-pill')?.innerText ?? ''), null, { timeout: 6000 })
    await page.waitForFunction(() => /E2E preset/.test(document.querySelector('.preset-pill')?.innerText ?? ''), null, { timeout: 6000 })
    const saved = await page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds[0].volume))
    assert.notEqual(saved, 0.5)
  })

  test('Save changes as I go OFF: an edit shows Unsaved changes with Cancel and Save', async () => {
    await page.evaluate(() => window.noctivago.settings.setPresetAutosaveEnabled(false))
    await page.reload()
    await page.waitForSelector('.sound-row')
    await app.dismissToasts()
    await pill().click()
    await settle()
    await page.getByText('E2E preset').first().click()
    await settle(1200)
    await nudgeVolume(300)
    await settle(700)
    assert.match(await pill().innerText(), /Unsaved changes/)
    assert.ok(await pill().locator('[data-pill-save]').isVisible())
    assert.ok(await pill().locator('[data-pill-cancel]').isVisible())
  })

  test('Cancel drops the edit: Changes canceled, volume back to the saved one', async () => {
    const saved = await page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds[0].volume))
    await pill().locator('[data-pill-cancel]').click()
    await page.waitForFunction(() => /Changes canceled/.test(document.querySelector('.preset-pill')?.innerText ?? ''), null, { timeout: 5000 })
    const now = await page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds[0].volume))
    assert.equal(now, saved)
  })

  test('Save writes the edit: Saving, Changes saved, new volume stored', async () => {
    await nudgeVolume(100)
    await settle(700)
    await pill().locator('[data-pill-save]').click()
    await page.waitForFunction(() => /Changes saved/.test(document.querySelector('.preset-pill')?.innerText ?? ''), null, { timeout: 5000 })
    const saved = await page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds[0].volume))
    assert.ok(saved < 0.2, 'stored volume dropped, got ' + saved)
  })
})
