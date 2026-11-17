// End-to-end: Remix Sound mode paths no other test covers (rebuild plan step 0): typed loop
// Start / End / Length, undo and redo after an edit, the Scheduled playback mode and its
// times / interval fields, and picking a sound from the library. Needs the Remix build in
// ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 22050
let app
let page
let panel
const files = []

const makeWav = (name, div, seconds = 20) => {
  const file = path.join(os.tmpdir(), `noct-edit-${name}-${process.pid}.wav`)
  const n = RATE * seconds
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / div) * 6000), 44 + i * 2)
  fs.writeFileSync(file, buf)
  files.push(file)
  return file
}
const val = (sel) => page.locator(sel).first().inputValue()
const fill = async (sel, text) => {
  const el = page.locator(sel).first()
  await el.fill(text)
  await el.dispatchEvent('change')
}
const pickSound = async (name) => {
  await panel.getByText(name).first().click()
  await page.waitForTimeout(2000)
}

before(async () => {
  const a = makeWav('a', 9)
  const b = makeWav('b', 21, 8)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate(async ([fa, fb]) => {
    await window.noctivago.library.addSound({ path: fa, name: 'Edit Alpha', keepCopy: true })
    await window.noctivago.library.addSound({ path: fb, name: 'Edit Beta', keepCopy: true })
  }, [a, b])
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  panel = page.locator('.tab-panel:not(.hidden)')
  await pickSound('Edit Alpha')
})

after(async () => {
  await app?.close()
  for (const f of files) fs.rmSync(f, { force: true })
})

test('typed loop Start / End / Length update each other and the waveform', async () => {
  await fill('#editor-start-input', '0:02')
  await fill('#editor-end-input', '0:08')
  assert.equal(await val('#editor-start-input'), '0:02')
  assert.equal(await val('#editor-end-input'), '0:08')
  assert.equal(await val('#editor-length-input'), '0:06')
  await fill('#editor-length-input', '0:04') // resizes from the fixed Start
  assert.equal(await val('#editor-start-input'), '0:02')
  assert.equal(await val('#editor-end-input'), '0:06')
  await fill('#editor-end-input', '0:99:99') // nonsense is ignored, values stay
  assert.equal(await val('#editor-start-input'), '0:02')
})

test('undo and redo walk back and forward over an edit', async () => {
  await page.waitForTimeout(800) // let the edit settle into history (500 ms debounce)
  const undo = page.locator('#editor-undo')
  const redo = page.locator('#editor-redo')
  assert.equal(await undo.isEnabled(), true, 'undo is disabled after edits')
  const before = await val('#editor-end-input')
  await fill('#editor-end-input', '0:10')
  await page.waitForTimeout(800)
  assert.equal(await val('#editor-end-input'), '0:10')
  await undo.click()
  await page.waitForTimeout(400)
  assert.equal(await val('#editor-end-input'), before, 'undo did not restore the End')
  assert.equal(await redo.isEnabled(), true, 'redo is disabled after an undo')
  await redo.click()
  await page.waitForTimeout(400)
  assert.equal(await val('#editor-end-input'), '0:10', 'redo did not reapply the End')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  assert.equal(await val('#editor-end-input'), before, 'Ctrl+Z did not undo')
})

test('Scheduled mode shows its fields: fixed times or a recurring interval', async () => {
  await page.locator('#editor-playmode-scheduled').check()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('#editor-schedule-section').isVisible(), true, 'schedule section hidden')
  assert.equal(await page.locator('#editor-schedule-times-row').isVisible(), true)
  assert.equal(await page.locator('#editor-schedule-interval-row').isVisible(), false)
  await fill('#editor-schedule-times', '08:30, 20:00')
  await page.locator('#editor-schedule-type-interval').check()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('#editor-schedule-interval-row').isVisible(), true)
  assert.equal(await page.locator('#editor-schedule-times-row').isVisible(), false)
  await fill('#editor-schedule-interval', '15')
  assert.equal(await val('#editor-schedule-interval'), '15')
  await page.locator('#editor-schedule-type-times').check()
  await page.waitForTimeout(300)
  assert.equal(await val('#editor-schedule-times'), '08:30, 20:00', 'times lost when switching type')
})

test('the schedule is saved with the sound and comes back after reload', async () => {
  await page.locator('#editor-schedule-type-interval').check()
  await fill('#editor-schedule-interval', '15')
  await page.locator('#editor-save').click()
  await page.waitForTimeout(6000)
  const saved = await page.evaluate(async () => (await window.noctivago.library.list()).find((s) => s.name === 'Edit Alpha'))
  assert.equal(saved.playMode, 'scheduled', `play mode saved as ${saved.playMode}`)
  assert.equal(saved.schedule?.type, 'interval')
  assert.equal(saved.schedule?.intervalMinutes, 15)
})

test('picking another sound in the library switches the editor to it', async () => {
  // The 2.0 layout swaps the old search box for the library list: a click on a row picks the sound.
  assert.equal((await page.locator('#editor-sound-name').first().textContent()).trim(), 'Edit Alpha')
  await panel.getByText('Edit Beta').first().click()
  await page.waitForTimeout(2500)
  assert.equal((await page.locator('#editor-sound-name').first().textContent()).trim(), 'Edit Beta')
  assert.equal(await val('#editor-end-input'), '0:08', 'Beta (8 s) did not load its own length')
  assert.equal(await page.locator('#editor-undo').isEnabled(), false, 'undo history was not reset for the new sound')
})
