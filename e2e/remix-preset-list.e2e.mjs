// End-to-end: Remix's preset lists follow presets made or renamed in the Presets window (owner, 2026-11-17:
// "created a new preset on the app and it didn't work right on the remix tab till i restarted" - it was missing
// from the lists). Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
let panel
const file = path.join(os.tmpdir(), `noct-presetlist-${process.pid}.wav`)

const makeWav = () => {
  const rate = 22050
  const n = rate * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 11) * 6000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

// The Presets window's own buttons (its handlers work while it is closed too).
const presetsWindow = (fn, ...args) => page.evaluate(fn, args)
const createBlank = (name) =>
  presetsWindow(([n]) => {
    document.getElementById('new-preset-blank').click()
    document.getElementById('new-preset-name').value = n
    document.getElementById('preset-name-confirm').click()
  }, name).then(() => page.waitForTimeout(800))

const tab = (name) => page.locator('#tab-bar .tab-button', { hasText: name }).click().then(() => page.waitForTimeout(800))
const mode = (name) => panel.getByRole('button', { name, exact: true }).first().click().then(() => page.waitForTimeout(800))
const groupPresetOptions = () => page.locator('#rx-in-preset select option').allTextContents()
// Preset mode opens the selected preset's detail in the library pane; a search shows the list (every name
// here has an "e").
const presetItems = async () => {
  await page.locator('#rx-lib-search').fill('e')
  await page.waitForTimeout(400)
  const items = await panel.locator('.rx-item').allTextContents()
  await page.locator('#rx-lib-search').fill('')
  return items
}

before(async () => {
  makeWav()
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate(async (f) => {
    const n = window.noctivago
    await n.library.addSound({ path: f, name: 'Tone', keepCopy: true })
    const s = (await n.library.list()).find((x) => x.name === 'Tone')
    await n.presets.save({ name: 'Old preset', sounds: [{ soundId: s.id, volume: 0.5 }] })
  }, file)
  await page.reload()
  await page.waitForSelector('#tab-bar .tab-button')
  await app.dismissToasts()
  await tab('Remix')
  panel = page.locator('.tab-panel:not(.hidden)')
})

after(async () => {
  await app?.close()
  fs.rmSync(file, { force: true })
})

test('made from the Mixer while Remix was in Sound mode: Group mode lists it', async () => {
  await mode('Sound')
  await tab('Mixer')
  await createBlank('Fresh B')
  await tab('Remix')
  await mode('Group')
  assert.ok((await groupPresetOptions()).includes('Fresh B'), 'Group preset list: ' + (await groupPresetOptions()).join(', '))
})

test('made while the Remix tab is open in Preset mode: the list shows it', async () => {
  await mode('Preset')
  await createBlank('Fresh C')
  const items = await presetItems()
  assert.ok(items.some((t) => t.includes('Fresh C')), 'Preset list: ' + items.join(' | '))
})

test('renamed while the Remix tab is open: Preset and Group lists show the new name', async () => {
  await presetsWindow(async () => {
    const p = (await window.noctivago.presets.list()).find((x) => x.name === 'Old preset')
    await window.noctivago.presets.rename(p.id, 'Renamed preset')
  })
  // The rename above skips the Mixer; the Presets window's own rename path ends in refreshPresetList.
  await presetsWindow(() => window.dispatchEvent(new CustomEvent('noctivago:presets-changed')))
  await page.waitForTimeout(800)
  assert.ok((await presetItems()).some((t) => t.includes('Renamed preset')), 'Preset list: ' + (await presetItems()).join(' | '))
  await mode('Group')
  assert.ok((await groupPresetOptions()).includes('Renamed preset'), 'Group preset list: ' + (await groupPresetOptions()).join(', '))
})
