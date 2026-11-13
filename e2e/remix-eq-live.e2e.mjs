// End-to-end: Remix EQ view while a sound plays. The live spectrum keeps moving after a
// view switch, Before / After / Both can be clicked, and in Saved audio (no pre-EQ tap)
// clicking Before returns to Live edit. Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 44100
let app
let page
let panel
let wavPath

const hashCanvas = async () => {
  const b = await page.locator('#editor-eq-canvas').screenshot()
  let h = 0
  for (let i = 0; i < b.length; i += 7) h = (h * 31 + b[i]) | 0
  return h
}
const isMoving = async () => {
  const seen = new Set()
  for (let i = 0; i < 4; i++) {
    seen.add(await hashCanvas())
    await page.waitForTimeout(350)
  }
  return seen.size > 1
}
const view = (name) => panel.getByRole('button', { name, exact: true }).first().click()

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-eqlive-${process.pid}.wav`)
  const n = RATE * 20
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const f = 300 + 300 * Math.sin((i / RATE) * 2)
    buf.writeInt16LE(Math.round((Math.sin((2 * Math.PI * f * i) / RATE) * 0.3 + (Math.random() - 0.5) * 0.2) * 32767), 44 + i * 2)
  }
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Live sound', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  panel = page.locator('.tab-panel:not(.hidden)')
  await panel.getByText('Live sound').first().click()
  await page.waitForTimeout(2500)
  await view('EQ')
  await page.waitForTimeout(500)
  await page.locator('#editor-play-pause').click()
  await page.waitForTimeout(1200)
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

test('the EQ live spectrum keeps moving after switching views and back', async () => {
  assert.ok(await isMoving(), 'spectrum is static on first show')
  for (const other of ['Spectrum', 'Trim']) {
    await view(other)
    await page.waitForTimeout(1200)
    await view('EQ')
    await page.waitForTimeout(500)
    assert.ok(await isMoving(), `spectrum frozen after ${other} and back`)
  }
})

test('Before / After / Both click and change the graph', async () => {
  for (const mode of ['before', 'after', 'both']) {
    const btn = panel.locator(`[data-tap="${mode}"]:visible`).first()
    await btn.click({ timeout: 3000 })
    await page.waitForTimeout(300)
    assert.equal(await btn.getAttribute('aria-pressed'), 'true', `${mode} not pressed`)
    assert.ok(await isMoving(), `graph static on ${mode}`)
  }
})

test('in Saved audio, clicking Before goes back to Live edit', async () => {
  const toggle = panel.locator('.editor-preview-mode-toggle:visible').first()
  await toggle.click()
  await page.waitForTimeout(3500)
  assert.equal((await toggle.textContent()).trim(), 'Saved audio')
  await page.locator('#editor-play-pause').click()
  await page.waitForTimeout(1200)
  const before = panel.locator('[data-tap="before"]:visible').first()
  assert.equal(await before.getAttribute('aria-disabled'), 'true', 'Before is not marked unavailable on saved audio')
  await before.click({ force: true }) // aria-disabled counts as disabled to Playwright; a real click works
  await page.waitForTimeout(3500)
  assert.equal((await toggle.textContent()).trim(), 'Live edit')
})
