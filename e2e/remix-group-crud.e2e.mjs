// End-to-end: Remix Group mode (rebuild plan step 0, part 2): pick a preset and open one of its
// groups, create a group from the UI, edit its gain / name and Save, and delete it. Every result
// is checked against window.noctivago.presets.list(), not only the DOM. Needs the Remix build in
// ../noctivago-plugin-repos/noctivago-remix.
// Not covered: membership toggling (the member rows' controls only mute / solo / loop in the
// preview, group membership is set from the Preset list) and Cancel (the Group header has no
// revert button; Cancel is Sound-mode only).
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

const makeWav = (name, div, seconds = 3) => {
  const file = path.join(os.tmpdir(), `noct-grp-${name}-${process.pid}.wav`)
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
const groups = () => page.evaluate(async () => (await window.noctivago.presets.list()).find((x) => x.name === 'Crud preset')?.groups ?? [])
const setGain = (db) => page.evaluate((v) => {
  const el = document.querySelector('#editor-mix-group-gain')
  el.value = String(v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, db)
const save = async () => {
  await page.locator('#editor-mix-save').click()
  await page.waitForTimeout(1500)
}

before(async () => {
  const a = makeWav('a', 9)
  const b = makeWav('b', 21)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate(async ([fa, fb]) => {
    const n = window.noctivago
    const sa = await n.library.addSound({ path: fa, name: 'Crud Alpha', keepCopy: true })
    const sb = await n.library.addSound({ path: fb, name: 'Crud Beta', keepCopy: true })
    await n.presets.save({ name: 'Crud preset', sounds: [{ soundId: sa.id, volume: 0.5 }, { soundId: sb.id, volume: 0.5 }] })
    const p = (await n.presets.list()).find((x) => x.name === 'Crud preset')
    await n.presets.updateGroups(p.id, [{ name: 'Duo', soundIds: [sa.id, sb.id] }])
  }, [a, b])
  await page.reload()
  await page.waitForSelector('.sound-row')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  panel = page.locator('.tab-panel:not(.hidden)')
  await panel.getByRole('button', { name: 'Group', exact: true }).first().click()
  await page.waitForTimeout(800)
})

after(async () => {
  await app?.close()
  for (const f of files) fs.rmSync(f, { force: true })
})

test('picking a preset in "In preset" lists its groups; picking one opens its member rows', async () => {
  await page.locator('#rx-in-preset select').selectOption({ label: 'Crud preset' })
  await page.waitForTimeout(1000)
  const item = panel.locator('.rx-item', { hasText: 'Duo' }).first()
  await item.click({ timeout: 5000 })
  await page.waitForTimeout(1000)
  assert.equal(await panel.locator('.rx-mrow').count(), 2, 'Duo should show its two members')
  assert.equal(await panel.locator('.rx-mrow', { hasText: 'Crud Alpha' }).count(), 1)
  assert.equal(await page.locator('#editor-mix-group-name').inputValue(), 'Duo')
})

test('editing a group gain and Save writes the group filters; reopening shows the saved value', async () => {
  const before = (await groups())[0]
  await setGain(6)
  await page.waitForTimeout(300)
  await save()
  const after = (await groups()).find((g) => g.name === 'Duo')
  assert.notDeepEqual(after.filters, before.filters, 'saved filters did not change')
  assert.equal(after.filters.gainDb, 6, 'gain 6 dB is not in the saved filters')
  assert.deepEqual(after.soundIds, before.soundIds, 'saving the gain changed the members')
  assert.equal(await page.locator('#editor-mix-group-gain').inputValue(), '6')
})

test('renaming a group and Save persists the new name', async () => {
  const name = page.locator('#editor-mix-group-name')
  await name.fill('Duo Renamed')
  await name.dispatchEvent('input')
  await save()
  const gs = await groups()
  assert.ok(gs.some((g) => g.name === 'Duo Renamed'), `names: ${gs.map((g) => g.name)}`)
  assert.equal(gs.length, 1)
})

test('+ New group creates an empty group, opens it, and it persists', async () => {
  await panel.locator('#rx-new-group').click()
  await page.waitForTimeout(1500)
  const gs = await groups()
  assert.equal(gs.length, 2, 'a second group should exist')
  const created = gs.find((g) => g.name !== 'Duo Renamed')
  assert.deepEqual(created.soundIds, [])
  assert.equal(await page.locator('#editor-mix-group-name').inputValue(), created.name, 'the new group is not open')
  assert.equal(await panel.locator('.rx-mrow').count(), 0)
})

test('deleting the new group removes it from the preset', async () => {
  await page.locator('#editor-mix-delete-group').click()
  await page.waitForTimeout(1500)
  const gs = await groups()
  assert.deepEqual(gs.map((g) => g.name), ['Duo Renamed'])
})
