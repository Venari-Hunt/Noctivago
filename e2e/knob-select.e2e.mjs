// End-to-end: one wheel rule for every knob (owner, 2026-11-14, core/knobSelect.js).
// The plain wheel over an unselected knob leaves it alone (the panel scrolls); a click
// selects it (focus ring) and then the wheel turns it; Esc unselects. Checked on the
// Mixer's volume knob and both Remix knob builds (layout.js attachKnob and the React
// FilterControls knob). Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 22050
let app
let page
let wavPath

const value = (knob) => knob.locator('input[type="range"]').evaluate((el) => Number(el.value))
const selected = (knob) => knob.evaluate((el) => el.contains(document.activeElement))

// Hover, wheel one notch up, report the change.
async function wheelChange(knob) {
  const box = await knob.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 24))
  const from = await value(knob)
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(150)
  return (await value(knob)) - from
}

async function checkRule(knob, name) {
  await page.keyboard.press('Escape')
  assert.equal(await selected(knob), false, `${name}: starts unselected`)
  assert.equal(await wheelChange(knob), 0, `${name}: unselected, the wheel leaves it alone`)
  // A click near the top of the ring selects it without a drag.
  const ring = (await knob.locator('.rx-ring').count()) ? knob.locator('.rx-ring') : knob
  const box = await ring.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + 8)
  assert.equal(await selected(knob), true, `${name}: a click selects it`)
  const outline = await knob.evaluate((el) => getComputedStyle(el.matches('.knob') ? el : el.querySelector('.rx-ring')).outlineStyle)
  assert.equal(outline, 'solid', `${name}: selected shows the ring`)
  assert.ok((await wheelChange(knob)) > 0, `${name}: selected, the wheel turns it up`)
  await page.keyboard.press('Escape')
  assert.equal(await selected(knob), false, `${name}: Esc unselects`)
  assert.equal(await wheelChange(knob), 0, `${name}: unselected again, the wheel leaves it alone`)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-knob-${process.pid}.wav`)
  const n = RATE * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 9) * 3000), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Knob tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  for (const c of await page.locator('.notify-close').all()) await c.click().catch(() => {})
  await page.locator('.mx-item', { hasText: 'Knob tone' }).first().locator('.mx-sw').click()
  await page.waitForSelector('.sound-row .knob')
})

after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

test('Mixer volume knob: click to select, then the wheel turns it', async () => {
  await checkRule(page.locator('.sound-row', { hasText: 'Knob tone' }).locator('.knob'), 'Mixer')
})

test('Remix knobs: both builds follow the same rule', async () => {
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(800)
  await page.locator('#rx-lib-list').getByText('Knob tone').click()
  await page.waitForTimeout(1500)
  // Gain (Tone) is the React FilterControls knob, Speed is a layout.js attachKnob knob.
  for (const [acc, label, name] of [['tone', 'Gain', 'Remix filter knob'], ['speed', 'Speed', 'Remix layout knob']]) {
    const box = page.locator(`.rx-acc[data-acc="${acc}"]:visible`).first()
    const knob = box.locator('.rx-kn', { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) }).first()
    if (!(await knob.isVisible())) await box.locator('.rx-acch').first().click()
    await knob.scrollIntoViewIfNeeded()
    await checkRule(knob, name)
  }
})
