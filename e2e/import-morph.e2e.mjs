// End-to-end: Presets > Import works in place (micro-interactions mock, row "Import a preset"):
// a file that is not a preset shows the reason on the button in soft red, then the button comes back.
// Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncv-import-'))
const junk = path.join(dir, 'not-a-preset.ncvpreset')
fs.writeFileSync(junk, 'hello, this is not a preset')
const SHOT = process.env.IMPORT_MORPH_SHOT

before(async () => {
  app = await launchApp({ pickPath: junk })
  page = app.page
})
after(async () => {
  await app?.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const btn = () => page.locator('#import-preset')

describe('Import preset button', () => {
  test('at rest it reads Import', async () => {
    await page.locator('.preset-pill').click()
    await btn().waitFor()
    assert.match(await btn().innerText(), /Import/)
    assert.ok(await btn().evaluate((b) => b.classList.contains('morph')))
  })

  test('a bad file: soft red reason on the button, then back to Import', async () => {
    const before = await btn().evaluate((b) => b.getBoundingClientRect().width)
    await btn().click()
    await page.locator('#import-preset.fail').waitFor({ timeout: 3000 })
    await page.waitForTimeout(400) // width and fade settle
    const text = await btn().innerText()
    assert.ok(text.length > 'Import'.length, `shows a reason, got "${text}"`)
    assert.ok((await btn().evaluate((b) => b.getBoundingClientRect().width)) > before, 'button widened to fit the reason')
    if (SHOT) await page.locator('.presets-tools').screenshot({ path: SHOT })
    await page.locator('#import-preset:not(.fail)').waitFor({ timeout: 6000 })
    await page.waitForTimeout(300)
    assert.match(await btn().innerText(), /^\s*Import\s*$/)
  })
})
