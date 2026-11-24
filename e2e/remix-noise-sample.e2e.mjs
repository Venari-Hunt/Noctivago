// End-to-end: Noise reduction's sample is drawn on the Remix Trim waveform, can be
// dragged to a new spot (the From/To fields follow and Noise reduction turns on),
// and the "Show sample on waveform" switch hides and shows it.
// Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 44100
const SECONDS = 10
let app
let page
let wavPath
const errors = []

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-noise-sample-${process.pid}.wav`)
  const n = RATE * SECONDS
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.3 * 32767), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1500, height: 950 })
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Noise sample tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.tab-panel:not(.hidden)').getByText('Noise sample tone').first().click()
  await page.waitForTimeout(2500)
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

const field = (label) => page.locator(`input[aria-label="${label}"]`)
const canvasShot = () => page.evaluate(() => document.getElementById('editor-canvas').toDataURL())

test('the sample shows on the Trim waveform, drags to a new spot and re-samples', async () => {
  // Set a sample from the Repair tab's Noise reduction card (1.0 s to 3.0 s), then go back to Trim.
  await page.locator('#editor-mode-panel-sound [data-rx-view="spec"]').click()
  await page.waitForTimeout(1000)
  await field('Sample from').fill('1')
  await field('Sample to').fill('3')
  await page.locator('#editor-mode-panel-sound [data-rx-view="trim"]').click()
  await page.waitForTimeout(500)
  const withBand = await canvasShot()

  // The band is drawn: hiding it with the switch changes the picture, showing it brings it back.
  await page.locator('#editor-mode-panel-sound [data-rx-view="spec"]').click()
  await page.waitForTimeout(500)
  await page.locator('#editor-noise-show').evaluate((el) => el.click())
  await page.locator('#editor-mode-panel-sound [data-rx-view="trim"]').click()
  await page.waitForTimeout(500)
  const withoutBand = await canvasShot()
  assert.notEqual(withBand, withoutBand, 'hiding the sample changes the waveform picture')
  await page.locator('#editor-mode-panel-sound [data-rx-view="spec"]').click()
  await page.waitForTimeout(500)
  await page.locator('#editor-noise-show').evaluate((el) => el.click())
  await page.locator('#editor-mode-panel-sound [data-rx-view="trim"]').click()
  await page.waitForTimeout(500)
  assert.equal(await canvasShot(), withBand, 'showing it again restores the band')

  // Drag the band from the middle of 1-3 s (at 2 s) to 5 s: it moves 3 s and keeps its 2 s length.
  const canvas = page.locator('#editor-canvas')
  const box = await canvas.boundingBox()
  const xFor = (sec) => box.x + (box.width * sec) / SECONDS
  const y = box.y + box.height * 0.75
  await page.mouse.move(xFor(2), y)
  await page.mouse.down()
  await page.mouse.move(xFor(3.5), y, { steps: 6 })
  await page.mouse.move(xFor(5), y, { steps: 6 })
  await page.mouse.up()
  await page.locator('#editor-mode-panel-sound [data-rx-view="spec"]').click()
  await page.waitForTimeout(500)
  const from = Number(await field('Sample from').inputValue())
  const to = Number(await field('Sample to').inputValue())
  assert.ok(Math.abs(from - 4) <= 0.2 && Math.abs(to - 6) <= 0.2, `the drag moved the sample to about 4-6 s (got ${from} to ${to})`)
  assert.ok(Math.abs(to - from - 2) <= 0.05, `the length stays 2 s (got ${(to - from).toFixed(2)})`)
  assert.equal(await page.locator('.rx-nr-row input[type=checkbox]').isChecked(), true, 'dragging the sample turns Noise reduction on')
  assert.deepEqual(errors, [], 'no page errors')
})
