// End-to-end: Mixer undo/redo history records volume, mute and in/out of the mix
// (plan: vault "Undo history plan", Steps 3). Real app, throwaway profile.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
let wavPath
const settle = (ms = 400) => page.waitForTimeout(ms)
const pill = () => page.locator('.preset-pill')
const rowOf = (name) => page.locator('.sound-row', { hasText: name })
const undoTitle = () => page.locator('#mx-undo').getAttribute('title')
const savedVolume = () => page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds.find((s) => s.volume != null).volume))
const savedIds = () => page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds.length))

function writeTone(file) {
  const rate = 22050
  const n = rate * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

// A key press with focus on a neutral spot (not a field), as a user would.
async function key(combo) {
  await page.locator('#tab-content').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(combo)
  await settle()
}

// Polls the saved preset's first volume until it equals `want` (or differs from it when `not`).
async function waitSavedVolume(want, { not = false } = {}) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const v = await savedVolume()
    if (not ? v !== want : v === want) return v
    await page.waitForTimeout(150)
  }
  throw new Error(`saved volume never ${not ? 'left' : 'reached'} ${want}`)
}

async function loadPresetFromPill() {
  await pill().click()
  await settle()
  await page.getByText('E2E preset').first().click()
  await settle(1500)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-undo-${process.pid}.wav`)
  writeTone(wavPath)
  app = await launchApp()
  page = app.page
  await page.evaluate(async (p) => {
    const a = await window.noctivago.library.addSound({ path: p, name: 'Rain tone', keepCopy: true })
    await window.noctivago.library.addSound({ path: p, name: 'Wind tone', keepCopy: true })
    await window.noctivago.presets.save({ name: 'E2E preset', sounds: [{ soundId: a.id, volume: 0.5 }] })
    await window.noctivago.presets.save({ name: 'Other preset', sounds: [{ soundId: a.id, volume: 0.4 }] })
  }, wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await loadPresetFromPill()
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

describe('Mixer undo history', () => {
  test('loading a preset leaves the history empty', async () => {
    assert.equal(await undoTitle(), 'Nothing to undo')
    assert.equal(await page.locator('#mx-undo').isDisabled(), true)
  })

  test('a volume drag is one entry; Ctrl+Z restores the exact value, Ctrl+Shift+Z re-applies, autosave follows', async () => {
    assert.equal(await savedVolume(), 0.5)
    await page.evaluate(() => {
      const el = document.querySelector('.sound-row .sound-row-volume')
      for (const v of ['600', '700', '800', '900']) {
        el.value = v
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await settle(200)
    assert.equal(await undoTitle(), 'Undo volume of Rain tone')
    const dragged = await waitSavedVolume(0.5, { not: true })
    await key('Control+z')
    assert.equal(await page.locator('#mx-undo').isDisabled(), true, 'one drag = one entry')
    await waitSavedVolume(0.5)
    await key('Control+Shift+z')
    await waitSavedVolume(dragged)
    await key('Control+z')
  })

  test('mute is undone and redone', async () => {
    await rowOf('Rain tone').getByRole('button', { name: 'Mute', exact: true }).click()
    await settle()
    assert.equal(await rowOf('Rain tone').locator('xpath=self::*[contains(@class,"sound-row-muted")]').count(), 1)
    assert.equal(await undoTitle(), 'Undo mute Rain tone')
    await key('Control+z')
    assert.equal(await page.locator('.sound-row-muted').count(), 0)
    await key('Control+Shift+z')
    assert.equal(await page.locator('.sound-row-muted').count(), 1)
    await key('Control+z')
    assert.equal(await page.locator('.sound-row-muted').count(), 0)
  })

  test('adding a sound to the mix is undone and redone', async () => {
    assert.equal(await rowOf('Wind tone').count(), 0)
    await page.locator('.mx-item', { hasText: 'Wind tone' }).locator('.mx-sw').click()
    await page.waitForSelector('.sound-row:has-text("Wind tone")')
    assert.equal(await undoTitle(), 'Undo add Wind tone to the mix')
    await key('Control+z')
    assert.equal(await rowOf('Wind tone').count(), 0)
    assert.equal(await savedIds(), 1)
    await key('Control+Shift+z')
    await page.waitForSelector('.sound-row:has-text("Wind tone")')
    await key('Control+z')
    assert.equal(await rowOf('Wind tone').count(), 0)
  })

  test('taking a sound out is undone; loading the preset again clears the history', async () => {
    await rowOf('Rain tone').locator('.sound-row-meta-line').click()
    await settle()
    assert.equal(await undoTitle(), 'Undo remove Rain tone from the mix')
    await key('Control+z')
    assert.equal(await page.locator('#mx-meta').innerText().then((t) => /^1 sound/.test(t)), true)
    assert.equal(await page.locator('.sound-row-leaving').count(), 0)
    assert.equal(await page.locator('#mx-redo').isDisabled(), false, 'redo entry remains until a load')
    await page.waitForFunction(() => document.querySelector('.preset-pill')?.classList.contains('norm'), null, { timeout: 10000 })
    await pill().click()
    await settle()
    await page.locator('.pcard-name', { hasText: 'Other preset' }).locator('visible=true').first().click()
    await settle(1500)
    assert.equal(await page.locator('#mx-undo').isDisabled(), true)
    assert.equal(await page.locator('#mx-redo').isDisabled(), true)
  })
})
