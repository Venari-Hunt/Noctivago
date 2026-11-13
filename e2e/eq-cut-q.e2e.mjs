// End-to-end: turning an EQ band into a high-pass or low-pass starts it at Q 0.71 (no resonance bump).
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

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-cutq-${process.pid}.wav`)
  const n = RATE * 3
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.3 * 32767), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Cut tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.tab-panel:not(.hidden)').getByText('Cut tone').first().click()
  await page.waitForTimeout(2500)
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

test('a band switched to High pass or Low pass starts at Q 0.71; back to a bell it returns to 1', async () => {
  await page.locator('#editor-mode-panel-sound [data-rx-view="eq"]').click()
  await page.waitForTimeout(800)
  const canvas = page.locator('#editor-eq-canvas')
  const box = await canvas.boundingBox()
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2) // adds a bell band there
  await page.waitForTimeout(300)
  const q = () => page.locator('#editor-eq-q').inputValue().then(Number)
  assert.equal(await q(), 1, 'a new bell starts at Q 1')
  await page.locator('#editor-eq-type').selectOption('highpass')
  assert.equal(await q(), 0.71)
  await page.locator('#editor-eq-type').selectOption('lowpass')
  assert.equal(await q(), 0.71)
  await page.locator('#editor-eq-type').selectOption('peaking')
  assert.equal(await q(), 1)
})
