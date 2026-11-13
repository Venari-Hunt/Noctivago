// End-to-end: a real 5 s WAV export through the Export plugin and ffmpeg. The folder
// dialog is answered by NOCTIVAGO_E2E_FOLDER (src/main/devMode.js, unpackaged only).
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
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-export-${process.pid}.wav`)
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-e2e-out-'))
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

const FORMATS = [
  ['WAV', 'wav'],
  ['FLAC', 'flac'],
  ['MP3', 'mp3'],
  ['Opus', 'opus']
]

describe('Export', () => {
  for (const [tile, ext] of FORMATS) {
    test(`a 5 second ${tile} export finishes and writes a real file`, async () => {
      await page.locator('#tab-bar .tab-button', { hasText: 'Export' }).click()
      await page.waitForSelector('#export-length')
      // After a finished run the tab shows the result; "Export another" returns to the form.
      const another = panel().getByRole('button', { name: /Export another/ })
      if (await another.isVisible().catch(() => false)) await another.click()
      await page.waitForSelector('#export-run')
      await page.locator('#export-preset').selectOption({ label: 'E2E mix' })
      await page.locator('#export-length').fill('0:00:05')
      await page.locator('#export-length').blur()
      await panel().getByText('Audio only', { exact: true }).click()
      await panel().locator('#export-formats').getByText(tile, { exact: true }).click()
      await page.waitForTimeout(400)
      await page.locator('#export-run').click()
      await panel().getByText('Export finished').waitFor({ timeout: 60000 })
      const files = fs.readdirSync(outDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.' + ext))
      assert.ok(files.length > 0, `no .${ext} file under the output folder`)
      const f = files[files.length - 1]
      assert.ok(fs.statSync(path.join(f.parentPath, f.name)).size > 5000, 'the file has real audio in it')
    })
  }
})

describe('Export: Open folder and Cancel export', () => {
  const reset = async () => {
    await page.locator('#tab-bar .tab-button', { hasText: 'Export' }).click()
    const another = panel().getByRole('button', { name: /Export another/ })
    if (await another.isVisible().catch(() => false)) await another.click()
    await page.waitForSelector('#export-run')
    await page.locator('#export-preset').selectOption({ label: 'E2E mix' })
    await panel().getByText('Audio only', { exact: true }).click()
    await panel().locator('#export-formats').getByText('FLAC', { exact: true }).click()
  }

  test('a finished export offers Open folder, and the app can reveal only files that exist', async () => {
    await reset()
    await page.locator('#export-length').fill('0:00:05')
    await page.locator('#export-length').blur()
    await page.locator('#export-run').click()
    await panel().getByText('Export finished').waitFor({ timeout: 60000 })
    await panel().getByRole('button', { name: /Open folder/ }).waitFor()
    assert.equal(await page.evaluate(() => window.noctivago.export.reveal('C:\no\such\file.flac')), false)
  })

  test('Cancel export stops a long export, shows Export cancelled, and leaves no file behind', async () => {
    await reset()
    for (const e of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) if (e.isFile() && e.name.endsWith('.flac')) fs.rmSync(path.join(e.parentPath, e.name))
    await page.locator('#export-length').fill('8:00:00')
    await page.locator('#export-length').blur()
    await page.locator('#export-run').click()
    const cancel = panel().getByRole('button', { name: /Cancel export/ })
    await cancel.waitFor({ timeout: 20000 })
    await page.waitForTimeout(1500)
    await cancel.click()
    await panel().getByRole('heading', { name: 'Export cancelled' }).waitFor({ timeout: 30000 })
    assert.equal(await panel().getByRole('button', { name: /Open folder/ }).count(), 0)
    const files = fs.readdirSync(outDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.flac'))
    assert.equal(files.length, 0, 'the partial file was removed')
  })
})
