// End-to-end: Remix per-item preview in Group and Preset mode (owner, 2026-11-14; approved mock
// mock-noctivago-remix-detail). Play previews the item with its settings from Remix's own engine (never the
// Mixer's preview player); a natural loop loops, a Random one-shot plays once or repeats with Loop on, a group
// plays its members as a group. Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
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

const makeWav = (name, div, seconds) => {
  const file = path.join(os.tmpdir(), `noct-itemprev-${name}-${process.pid}.wav`)
  const n = Math.round(RATE * seconds)
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
const shots = () => page.evaluate(() => Number(document.querySelector('[data-rx-shots]')?.dataset.rxShots ?? 0))
const row = (name) => panel.locator('.rx-mrow', { hasText: name })
const drow = (name) => panel.locator('.rx-drow', { hasText: name })
const label = (loc) => loc.getAttribute('aria-label')

before(async () => {
  const [a, b, c] = [makeWav('loop', 9, 4), makeWav('shot', 21, 0.6), makeWav('out', 33, 4)]
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  const made = await page.evaluate(async ([fa, fb, fc]) => {
    const n = window.noctivago
    await n.library.addSound({ path: fa, name: 'Loop A', keepCopy: true })
    await n.library.addSound({ path: fb, name: 'Shot B', keepCopy: true })
    await n.library.addSound({ path: fc, name: 'Outside C', keepCopy: true })
    const lib = await n.library.list()
    const [sa, sb, sc] = ['Loop A', 'Shot B', 'Outside C'].map((name) => lib.find((s) => s.name === name))
    await n.library.updatePlayMode(sb.id, 'scatter')
    await n.library.updateScatterConfig(sb.id, { ...(sb.scatter ?? {}), minGapSeconds: 1, maxGapSeconds: 1 })
    await n.presets.save({ name: 'Preview preset', sounds: [{ soundId: sa.id, volume: 0.5 }, { soundId: sb.id, volume: 0.5 }, { soundId: sc.id, volume: 0.5 }] })
    const p = (await n.presets.list()).find((x) => x.name === 'Preview preset')
    await n.presets.updateGroups(p.id, [{ name: 'Duo', soundIds: [sa.id, sb.id] }])
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
  if (await sel.count()) await sel.selectOption({ label: 'Preview preset' })
  await page.waitForTimeout(800)
})

after(async () => {
  await app?.close()
  for (const f of files) fs.rmSync(f, { force: true })
})

test('Group mode list: each group row has Play, and it plays the group in Remix', async () => {
  const wrap = panel.locator('.rx-iw', { hasText: 'Duo' })
  assert.equal(await wrap.count(), 1)
  const before = await shots()
  await wrap.locator('.rx-mpv').click()
  await page.waitForTimeout(3500)
  assert.equal(await label(wrap.locator('.rx-mpv')), 'Stop Duo')
  assert.ok((await wrap.getAttribute('class')).includes('rx-iw-playing'))
  assert.ok((await shots()) - before >= 2, 'members fire: the loop starts and the one-shot repeats')
  assert.equal((await status()).previewSoundId ?? null, null, 'not the Mixer preview player')
  assert.equal((await status()).soloedSoundId ?? null, null, 'no Mixer solo cheat')
  await wrap.locator('.rx-mpv').click()
  await page.waitForTimeout(500)
  assert.equal(await label(wrap.locator('.rx-mpv')), 'Play Duo')
})

test('member rows: Loop is greyed on a natural loop, live on a one-shot', async () => {
  await panel.locator('.rx-item', { hasText: 'Duo' }).first().click({ timeout: 5000 })
  await page.waitForTimeout(1000)
  assert.equal(await row('Loop A').locator('.rx-mlp').isDisabled(), true)
  assert.equal(await row('Shot B').locator('.rx-mlp').isDisabled(), false)
  assert.equal(await row('Shot B').locator('.rx-mlp').getAttribute('aria-pressed'), 'false')
})

// The mock's numbers: transport column at x 0, Play on the line at y 4, Loop at y 36, name at x 40.
const boxes = (rowLoc, sels) => rowLoc.evaluate((r, sels) => {
  const o = r.getBoundingClientRect()
  return sels.map((s) => { const b = r.querySelector(s).getBoundingClientRect(); return [Math.round(b.left - o.left), Math.round(b.top - o.top), Math.round(b.width), Math.round(b.height)] })
}, sels)

test('member row sits on the mock grid', async () => {
  const [pv, lp, nm] = await boxes(row('Shot B'), ['.rx-mpv', '.rx-mlp', '.rx-mnm'])
  assert.deepEqual(pv, [0, 4, 32, 32], 'Play')
  assert.deepEqual(lp, [0, 36, 32, 32], 'Loop under Play')
  assert.equal(nm[0], 40, 'name at 40')
})

test('a natural loop keeps playing until Stop', async () => {
  await row('Loop A').locator('.rx-mpv').click()
  await page.waitForTimeout(5500)
  assert.equal(await label(row('Loop A').locator('.rx-mpv')), 'Stop Loop A', 'still playing past its 4 s length')
  assert.ok((await row('Loop A').getAttribute('class')).includes('rx-mrow-playing'))
  await row('Loop A').locator('.rx-mpv').click()
  await page.waitForTimeout(400)
  assert.equal(await label(row('Loop A').locator('.rx-mpv')), 'Play Loop A')
})

test('a one-shot plays once, then the row goes back to Play', async () => {
  const before = await shots()
  await row('Shot B').locator('.rx-mpv').click()
  await page.waitForTimeout(300)
  assert.equal(await label(row('Shot B').locator('.rx-mpv')), 'Stop Shot B')
  await page.waitForTimeout(2500)
  assert.equal(await label(row('Shot B').locator('.rx-mpv')), 'Play Shot B', 'ended on its own')
  assert.equal((await shots()) - before, 1)
})

test('with Loop on, the one-shot repeats with its gap', async () => {
  await row('Shot B').locator('.rx-mlp').click()
  await page.waitForTimeout(200)
  assert.equal(await row('Shot B').locator('.rx-mlp').getAttribute('aria-pressed'), 'true')
  const before = await shots()
  await row('Shot B').locator('.rx-mpv').click()
  await page.waitForTimeout(5000)
  assert.equal(await label(row('Shot B').locator('.rx-mpv')), 'Stop Shot B')
  assert.ok((await shots()) - before >= 3, 'fired again after each 1 s gap')
})

test('playing another row switches the preview', async () => {
  await row('Loop A').locator('.rx-mpv').click()
  await page.waitForTimeout(500)
  assert.equal(await label(row('Loop A').locator('.rx-mpv')), 'Stop Loop A')
  assert.equal(await label(row('Shot B').locator('.rx-mpv')), 'Play Shot B')
  await row('Loop A').locator('.rx-mpv').click()
  await page.waitForTimeout(300)
})

test('Preset mode: group rows get Play; sounds outside groups get Play and Loop', async () => {
  await panel.getByRole('button', { name: 'Preset', exact: true }).first().click()
  await page.waitForTimeout(1500)
  const pick = panel.locator('.rx-item', { hasText: 'Preview preset' })
  if (await pick.count()) await pick.first().click()
  await page.waitForTimeout(800)
  assert.equal(await drow('Duo').locator('.rx-mpv').count(), 1)
  assert.equal(await drow('Duo').locator('.rx-mlp').count(), 0)
  assert.equal(await drow('Outside C').locator('.rx-mpv').count(), 1)
  const [pv, lp, open] = await boxes(drow('Outside C'), ['.rx-mpv', '.rx-mlp', '.rx-grow'])
  assert.deepEqual([pv[0], lp[0], open[0]], [0, 36, 72], 'Play 0, Loop 36, row 72')
  assert.equal(await drow('Outside C').locator('.rx-mlp').isDisabled(), true, 'natural loop')
  await drow('Outside C').locator('.rx-mpv').click()
  await page.waitForTimeout(800)
  assert.equal(await label(drow('Outside C').locator('.rx-mpv')), 'Stop Outside C')
  await drow('Duo').locator('.rx-mpv').click()
  await page.waitForTimeout(800)
  assert.equal(await label(drow('Duo').locator('.rx-mpv')), 'Stop Duo')
  assert.equal(await label(drow('Outside C').locator('.rx-mpv')), 'Play Outside C')
  await drow('Duo').locator('.rx-mpv').click()
})
