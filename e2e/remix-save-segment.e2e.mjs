// End-to-end: Remix Trim "Save segment as new" makes a second library sound that is only the
// trimmed part (a baked clip of that length), leaves the open sound unchanged, and both survive
// a reload. The Trim view has no in-place "Save segment" button; the in-place save is the
// sticky Save (covered in remix-edit-paths). Needs the Remix build in ../noctivago-plugin-repos.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { launchApp } from './launch.mjs'

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static')
const RATE = 22050
let app
let page
let panel
let file
let since
const profileDir = () => path.join(process.env.APPDATA, `noctivago-e2e-${process.pid}`)
const list = () => page.evaluate(async () => (await window.noctivago.library.list()).map((s) => ({ id: s.id, name: s.name, loopStart: s.loopStart, loopEnd: s.loopEnd, playMode: s.playMode, loopClipReady: s.loopClipReady })))
const val = (sel) => page.locator(sel).first().inputValue()
const fill = async (sel, text) => {
  const el = page.locator(sel).first()
  await el.fill(text)
  await el.dispatchEvent('change')
}
const wavSeconds = (f) => {
  const r = spawnSync(ffmpeg, ['-i', f], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr)
  return +m[1] * 3600 + +m[2] * 60 + +m[3]
}

before(async () => {
  file = path.join(os.tmpdir(), `noct-seg-${process.pid}.wav`)
  const n = RATE * 20
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 9) * 6000), 44 + i * 2)
  fs.writeFileSync(file, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate((f) => window.noctivago.library.addSound({ path: f, name: 'Seg Source', keepCopy: true }), file)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  panel = page.locator('.tab-panel:not(.hidden)')
  await panel.getByText('Seg Source').first().click()
  await page.waitForTimeout(2000)
})

after(async () => {
  await app?.close()
  fs.rmSync(file, { force: true })
})

test('Save segment as new adds a second sound with only the 2 s to 8 s segment', async () => {
  await fill('#editor-start-input', '0:02')
  await fill('#editor-end-input', '0:08')
  assert.equal(await val('#editor-length-input'), '0:06')
  const before = (await list()).find((s) => s.name === 'Seg Source')
  assert.equal((await list()).length, 1)
  since = Date.now()
  await page.locator('#editor-save-segment').click()
  await page.waitForFunction(() => /Saved the segment as a new sound/.test(document.querySelector('#editor-save-status')?.textContent ?? ''), null, { timeout: 30000 })
  const after = await list()
  assert.equal(after.length, 2, 'a second library entry')
  const copy = after.find((s) => s.name !== 'Seg Source')
  assert.ok(Math.abs(copy.loopStart - 2) < 0.05 && Math.abs(copy.loopEnd - 8) < 0.05, `segment ${copy.loopStart}-${copy.loopEnd}`)
  assert.equal(copy.playMode, 'loop')
  assert.equal(copy.loopClipReady, true, 'the clip was baked')
  const orig = after.find((s) => s.name === 'Seg Source')
  assert.equal(orig.id, before.id)
  assert.equal(orig.loopStart, before.loopStart, 'original loop start unchanged')
  assert.equal(orig.loopEnd, before.loopEnd, 'original loop end unchanged')
  const clips = fs.readdirSync(profileDir(), { recursive: true }).map((f) => path.join(profileDir(), f)).filter((f) => /\.wav$/i.test(f) && fs.statSync(f).mtimeMs >= since)
  assert.equal(clips.length, 1, `one fresh clip: ${clips.join(', ')}`)
  const secs = wavSeconds(clips[0])
  assert.ok(Math.abs(secs - 6) < 0.6, `clip is ${secs} s, want about 6`)
})

test('both sounds survive a reload, the original still untrimmed by the segment', async () => {
  await page.reload()
  await page.waitForSelector('.mx-item')
  const all = await list()
  assert.equal(all.length, 2)
  const copy = all.find((s) => s.name !== 'Seg Source')
  assert.ok(Math.abs(copy.loopStart - 2) < 0.05 && Math.abs(copy.loopEnd - 8) < 0.05)
  assert.equal(copy.loopClipReady, true)
})
