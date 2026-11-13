// End-to-end: the Remix Trim view draws the picked sound's waveform (guards the 2026-11-13 "waveforms not loading" report).
// Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 44100
let app
let page
let wavPath
const errors = []

before(async () => {
  // A 3 s 440 Hz tone that swells from silence to loud: the waveform is a widening wedge.
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-wave-${process.pid}.wav`)
  const n = RATE * 3
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * (i / n) * 0.8 * 32767), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && m.text().startsWith('Editor:')) errors.push(m.text()) })
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Wave tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.tab-panel:not(.hidden)').getByText('Wave tone').first().click()
  await page.waitForTimeout(3000)
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

// Share of canvas columns where the waveform color reaches at least `rows` pixels tall.
const waveColumns = () => page.evaluate(() => {
  const c = document.getElementById('editor-canvas')
  const { width: w, height: h } = c
  const d = c.getContext('2d').getImageData(0, 0, w, h).data
  // The waveform fill is the one opaque mid-gray; count its pixels per column.
  const isWave = (i) => d[i + 3] === 255 && Math.abs(d[i] - d[i + 1]) < 12 && d[i] > 80 && d[i] < 140
  const tall = []
  for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) if (isWave((y * w + x) * 4)) n++; tall.push(n) }
  return { w, h, tall }
})

test('the Trim view draws the waveform, quiet at the start and tall at the end', async () => {
  const { w, h, tall } = await waveColumns()
  const at = (f) => Math.max(...tall.slice(Math.floor(w * f) - 5, Math.floor(w * f) + 5))
  assert.ok(at(0.9) > h * 0.4, `waveform near the end should fill most of the height (got ${at(0.9)} of ${h})`)
  assert.ok(at(0.1) < at(0.9) / 3, `the swell should show: start ${at(0.1)}, end ${at(0.9)}`)
  assert.equal((await page.locator('#editor-waveform-status').textContent()).trim(), '', 'no waveform status message')
  assert.deepEqual(errors, [], 'no page errors')
})

test('a canvas with a fractional CSS width still draws (owner window, 2026-11-13: Invalid array length)', async () => {
  await page.addStyleTag({ content: '#editor-canvas { width: 620.5px !important; flex: none !important; }' })
  // A fresh load of the sound at that width (the owner hit it on load).
  await page.reload()
  await page.waitForSelector('.mx-item')
  await page.addStyleTag({ content: '#editor-canvas { width: 620.5px !important; flex: none !important; }' })
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.tab-panel:not(.hidden)').getByText('Wave tone').first().click()
  await page.waitForTimeout(3000)
  const widthCss = await page.evaluate(() => document.getElementById('editor-canvas').getBoundingClientRect().width)
  assert.ok(widthCss % 1 !== 0, `the test needs a fractional width (got ${widthCss})`)
  const { w, h, tall } = await waveColumns()
  const end = Math.max(...tall.slice(Math.floor(w * 0.9) - 5, Math.floor(w * 0.9) + 5))
  assert.ok(end > h * 0.4, `waveform drawn at a fractional width (got ${end} of ${h})`)
  assert.deepEqual(errors, [], 'no page errors')
})
