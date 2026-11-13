// End-to-end: on the Remix tab, Space plays and pauses the Remix preview (not the Mixer).
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
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-space-${process.pid}.wav`)
  const n = RATE * 5
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.3 * 32767), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Space tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.tab-panel:not(.hidden)').getByText('Space tone').first().click()
  await page.waitForTimeout(2500)
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

test('Space on the Remix tab plays and pauses the Remix preview', async () => {
  const label = () => page.locator('#editor-play-pause').getAttribute('title')
  const before = await label()
  await page.locator('#editor-scroll-top').evaluate((el) => el.blur()).catch(() => {})
  await page.mouse.click(5, 5) // focus the page body, not a control
  await page.keyboard.press('Space')
  await page.waitForTimeout(600)
  const playing = await label()
  assert.notEqual(playing, before, `play button still says "${before}" after Space`)
  await page.keyboard.press('Space')
  await page.waitForTimeout(600)
  assert.equal(await label(), before, 'second Space pauses again')
})
