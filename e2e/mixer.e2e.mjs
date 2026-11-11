// End-to-end: Mixer basics with one generated test sound (a quiet 2 s tone).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
let wavPath
const settle = (ms = 300) => page.waitForTimeout(ms)

function writeTone(file) {
  const rate = 22050
  const n = rate * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-${process.pid}.wav`)
  writeTone(wavPath)
  app = await launchApp()
  page = app.page
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'E2E tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('#tab-bar .tab-button')
  await page.waitForSelector('.sound-row')
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

const rows = () => page.locator('.sound-row', { hasText: 'E2E tone' })

describe('Mixer', () => {
  test('the added sound is listed once', async () => {
    assert.equal(await rows().count(), 1)
  })

  test('search filters the list', async () => {
    await page.keyboard.press('Control+f')
    await page.keyboard.type('zzzz-no-match')
    await settle()
    assert.equal(await rows().count(), 0)
    await page.fill('#sound-search', '')
    await settle()
    assert.equal(await rows().count(), 1)
  })

  test('Delete shows a toast with Undo, and Undo brings the sound back', async () => {
    await rows().locator('.sound-row-remove').click()
    await settle()
    assert.equal(await rows().count(), 0)
    const toast = page.locator('.notify', { hasText: 'Deleted "E2E tone"' })
    assert.equal(await toast.count(), 1)
    await toast.getByRole('button', { name: 'Undo' }).click()
    await settle()
    assert.equal(await rows().count(), 1)
  })

  test('without Undo the sound is gone for good after the toast closes (6 s)', async () => {
    await page.mouse.move(5, 5) // hovering a toast pauses its timer
    await rows().locator('.sound-row-remove').click()
    await page.mouse.move(5, 5)
    const toast = page.locator('.notify', { hasText: 'Deleted "E2E tone"' })
    await toast.waitFor({ state: 'detached', timeout: 12000 })
    const names = await page.evaluate(() => window.noctivago.library.list().then((l) => l.map((e) => e.name)))
    assert.ok(!names.includes('E2E tone'))
    assert.equal(await rows().count(), 0)
  })
})
