// End-to-end: Remix Drift is one dropdown per type (approved mock, 2026-11-13): Volume, Pitch and Pan drift
// each have their own header with On/Off and the range; Group has three, Preset has Volume only.
// Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
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
let wavPath
let presetId

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-drift-${process.pid}.wav`)
  const n = RATE * 4
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 11) * 6000), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  presetId = await page.evaluate(async (p) => {
    await window.noctivago.library.addSound({ path: p, name: 'Drift tone', keepCopy: true })
    const s = (await window.noctivago.library.list()).find((x) => x.name === 'Drift tone')
    await window.noctivago.presets.save({ name: 'Drift preset', sounds: [{ soundId: s.id, volume: 0.5 }] })
    const preset = (await window.noctivago.presets.list()).find((x) => x.name === 'Drift preset')
    await window.noctivago.presets.updateGroups(preset.id, [{ name: 'Drift group', soundIds: [s.id] }])
    return preset.id
  }, wavPath)
  await page.reload()
  await page.waitForSelector('.sound-row')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  panel = page.locator('.tab-panel:not(.hidden)')
  await panel.getByText('Drift tone').first().click()
  await page.waitForTimeout(2500)
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

const heads = () => page.evaluate(() => [...document.querySelectorAll('.tab-panel:not(.hidden) .rx-side .rx-acc')].filter((a) => a.offsetParent).map((a) => a.dataset.acc + '=' + a.querySelector('.rx-accv').textContent))

test('Sound mode: three drift dropdowns, no combined Drift', async () => {
  const list = await heads()
  assert.deepEqual(list.filter((h) => h.startsWith('drift')), ['drift-vol=Off', 'drift-pitch=Off', 'drift-pan=Off'])
  assert.ok(!list.some((h) => h.startsWith('drift=')), 'no single Drift dropdown')
  for (const t of ['Volume drift', 'Pitch drift', 'Pan drift']) assert.equal(await panel.locator('.rx-acch', { hasText: t }).count() >= 1, true, t)
})

test('turning a type on shows On and its range on the header, only that one', async () => {
  await panel.locator('.rx-acch:visible', { hasText: 'Volume drift' }).first().click()
  await page.waitForTimeout(300)
  await page.evaluate(() => document.querySelector('#editor-fluc-vol-enabled').click())
  await page.waitForTimeout(800)
  const list = await heads()
  const vol = list.find((h) => h.startsWith('drift-vol='))
  assert.match(vol, /^drift-vol=On · .+ to .+/, vol)
  assert.equal(list.find((h) => h.startsWith('drift-pitch=')), 'drift-pitch=Off')
  await page.evaluate(() => document.querySelector('#editor-fluc-vol-enabled').click())
  await page.waitForTimeout(500)
  assert.equal((await heads()).find((h) => h.startsWith('drift-vol=')), 'drift-vol=Off')
})

test('Group mode has three drift dropdowns, Preset mode only Volume', async () => {
  await panel.getByRole('button', { name: 'Group', exact: true }).first().click()
  await page.waitForTimeout(800)
  const sel = page.locator('#rx-in-preset select')
  if (await sel.count()) await sel.selectOption({ label: 'Drift preset' })
  await page.waitForTimeout(800)
  await panel.locator('.rx-item', { hasText: 'Drift group' }).first().click({ timeout: 5000 })
  await page.waitForTimeout(1000)
  assert.deepEqual((await heads()).filter((h) => h.startsWith('drift')).map((h) => h.split('=')[0]), ['drift-vol', 'drift-pitch', 'drift-pan'])
  await panel.getByRole('button', { name: 'Preset', exact: true }).first().click()
  await page.waitForTimeout(1000)
  assert.deepEqual((await heads()).filter((h) => h.startsWith('drift')).map((h) => h.split('=')[0]), ['drift-vol'])
})
