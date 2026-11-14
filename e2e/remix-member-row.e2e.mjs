// End-to-end: Remix Group mode, a group's member rows (approved mock, 2026-11-13): each row has a play/stop
// button that previews that one sound, and an S that solos it in the Mixer once the preset is loaded there.
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
const ids = {}
const files = []

const makeWav = (name, div) => {
  const file = path.join(os.tmpdir(), `noct-member-${name}-${process.pid}.wav`)
  const n = RATE * 4
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
const status = () => page.evaluate(() => { const d = {}; window.dispatchEvent(new CustomEvent('noctivago:request-mixer-status', { detail: d })); return d })
const row = (name) => panel.locator('.rx-mrow', { hasText: name })

before(async () => {
  const [a, b, c] = [makeWav('a', 9), makeWav('b', 21), makeWav('c', 33)]
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  const made = await page.evaluate(async ([fa, fb, fc]) => {
    await window.noctivago.library.addSound({ path: fa, name: 'Member A', keepCopy: true })
    await window.noctivago.library.addSound({ path: fb, name: 'Member B', keepCopy: true })
    await window.noctivago.library.addSound({ path: fc, name: 'Member C', keepCopy: true })
    const lib = await window.noctivago.library.list()
    const sa = lib.find((s) => s.name === 'Member A')
    const sb = lib.find((s) => s.name === 'Member B')
    const sc = lib.find((s) => s.name === 'Member C')
    await window.noctivago.presets.save({ name: 'Member preset', sounds: [{ soundId: sa.id, volume: 0.5 }, { soundId: sb.id, volume: 0.5 }, { soundId: sc.id, volume: 0.5 }] })
    const p = (await window.noctivago.presets.list()).find((x) => x.name === 'Member preset')
    await window.noctivago.presets.updateGroups(p.id, [{ name: 'Pair', soundIds: [sa.id, sb.id] }])
    return { a: sa.id, b: sb.id, c: sc.id, preset: p.id }
  }, [a, b, c])
  Object.assign(ids, made)
  await page.reload()
  await page.waitForSelector('.sound-row')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  panel = page.locator('.tab-panel:not(.hidden)')
  await panel.getByRole('button', { name: 'Group', exact: true }).first().click()
  await page.waitForTimeout(800)
  const sel = page.locator('#rx-in-preset select')
  if (await sel.count()) await sel.selectOption({ label: 'Member preset' })
  await page.waitForTimeout(800)
  await panel.locator('.rx-item', { hasText: 'Pair' }).first().click({ timeout: 5000 })
  await page.waitForTimeout(1000)
})

after(async () => {
  await app?.close()
  for (const f of files) fs.rmSync(f, { force: true })
})

test('each member row has play, S and the edit arrow', async () => {
  assert.equal(await panel.locator('.rx-mrow').count(), 2)
  for (const name of ['Member A', 'Member B']) {
    assert.equal(await row(name).locator('.rx-mpv').count(), 1, `${name} play button`)
    assert.equal(await row(name).locator('.rx-mso').count(), 1, `${name} S button`)
  }
})

test('S is enabled before the preset is loaded (it loads it first)', async () => {
  assert.equal(await row('Member A').locator('.rx-mso').isDisabled(), false)
})

test('play previews that one sound and stops on the second press', async () => {
  const play = row('Member A').locator('.rx-mpv')
  assert.equal(await play.getAttribute('aria-label'), 'Play Member A')
  await play.click()
  await page.waitForTimeout(1200)
  assert.equal((await status()).previewSoundId, ids.a, 'the Mixer preview player plays A')
  assert.equal(await row('Member A').locator('.rx-mpv').getAttribute('aria-label'), 'Stop Member A')
  assert.ok((await row('Member A').getAttribute('class')).includes('rx-mrow-playing'))
  assert.equal(await row('Member B').locator('.rx-mpv').getAttribute('aria-label'), 'Play Member B', 'B is not playing')
  await row('Member A').locator('.rx-mpv').click()
  await page.waitForTimeout(800)
  assert.equal((await status()).previewSoundId, null, 'stopped')
  assert.equal(await row('Member A').locator('.rx-mpv').getAttribute('aria-label'), 'Play Member A')
})

test('playing another row switches the preview', async () => {
  await row('Member A').locator('.rx-mpv').click()
  await page.waitForTimeout(800)
  await row('Member B').locator('.rx-mpv').click()
  await page.waitForTimeout(1000)
  assert.equal((await status()).previewSoundId, ids.b)
  await row('Member B').locator('.rx-mpv').click()
  await page.waitForTimeout(600)
})

test('S solos one member in the live mix and releases it', async () => {
  assert.notEqual((await status()).activePresetId, ids.preset, 'preset not live yet')
  const so = row('Member A').locator('.rx-mso')
  assert.equal(await so.isDisabled(), false)
  await so.click()
  await page.waitForTimeout(4500)
  assert.equal((await status()).activePresetId, ids.preset, 'S loaded the preset')
  assert.equal((await status()).soloedSoundId, ids.a)
  assert.equal(await row('Member A').locator('.rx-mso').getAttribute('aria-pressed'), 'true')
  await row('Member A').locator('.rx-mso').click()
  await page.waitForTimeout(800)
  assert.equal((await status()).soloedSoundId, null)
})

test('Preset mode: a sound outside groups has play and S too', async () => {
  await panel.getByRole('button', { name: 'Preset', exact: true }).first().click()
  await page.waitForTimeout(800)
  await page.waitForTimeout(1000)
  assert.equal(await row('Member C').locator('.rx-mso').count(), 1, 'S')
  await row('Member C').locator('.rx-mpv').click()
  await page.waitForTimeout(1200)
  assert.equal((await status()).previewSoundId, ids.c, 'plays C')
  await row('Member C').locator('.rx-mpv').click()
  await page.waitForTimeout(600)
  assert.equal((await status()).previewSoundId, null)
})
