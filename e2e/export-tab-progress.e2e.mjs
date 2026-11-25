// End-to-end: while an export runs and another tab is in front, the Export tab button shows the
// percent (micro-interactions mock, row "Export"; app.tabs.setProgress). It clears when the run ends.
// Needs the Export plugin built in ../noctivago-plugin-repos. Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
let wavPath
let outDir
const panel = () => page.locator('.tab-panel:not(.hidden)')
const exportTab = () => page.locator('#tab-bar .tab-button', { hasText: 'Export' })

function writeTone(file) {
  const rate = 22050
  const n = rate * 3
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-tabpct-${process.pid}.wav`)
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-e2e-tabpct-'))
  writeTone(wavPath)
  app = await launchApp({ plugins: ['export'], pickPath: outDir })
  page = app.page
  await page.evaluate(async (p) => {
    const sound = await window.noctivago.library.addSound({ path: p, name: 'E2E tone', keepCopy: true })
    await window.noctivago.presets.save({ name: 'E2E mix', sounds: [{ soundId: sound.id, volume: 0.5 }] })
  }, wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
  fs.rmSync(outDir, { recursive: true, force: true })
})

describe('Export tab percent', () => {
  test('another tab in front: the Export tab shows the percent, and it clears at the end', async () => {
    await exportTab().click()
    await page.waitForSelector('#export-run')
    await page.locator('#export-preset').selectOption({ label: 'E2E mix' })
    // Long enough to be caught mid-run, short enough to finish quickly.
    await page.locator('#export-length').fill('2:00:00')
    await page.locator('#export-length').blur()
    await panel().getByText('Audio only', { exact: true }).click()
    await panel().locator('#export-formats').getByText('FLAC', { exact: true }).click()
    await page.waitForTimeout(300)
    await page.locator('#export-run').click()
    await page.locator('#tab-bar .tab-button', { hasText: 'Mixer' }).click()
    const badge = exportTab().locator('.tab-progress')
    await badge.waitFor({ state: 'visible', timeout: 20000 })
    assert.match(await badge.innerText(), /^\d{1,3}%$/)
    // In front, the tab itself shows the ring, so the badge hides.
    await exportTab().click()
    assert.equal(await badge.isVisible(), false)
    await page.locator('#tab-bar .tab-button', { hasText: 'Mixer' }).click()
    await badge.waitFor({ state: 'detached', timeout: 240000 })
  })
})
