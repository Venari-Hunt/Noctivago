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
let loudPath
const settle = (ms = 400) => page.waitForTimeout(ms)
const pill = () => page.locator('.preset-pill')
const rowOf = (name) => page.locator('.sound-row', { hasText: name })
const undoTitle = () => page.locator('#mx-undo').getAttribute('title')
const savedVolume = () => page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds.find((s) => s.volume != null).volume))
const savedIds = () => page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'E2E preset').sounds.length))

function writeTone(file, { loud = false } = {}) {
  const rate = 22050
  const n = rate * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  // loud = a full-scale square wave, so the sound's clip light turns red.
  for (let i = 0; i < n; i++) buf.writeInt16LE(loud ? (Math.floor(i / 20) % 2 ? 32767 : -32768) : Math.round(Math.sin(i / 20) * 3000), 44 + i * 2)
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
  loudPath = path.join(os.tmpdir(), `noctivago-e2e-undo-loud-${process.pid}.wav`)
  writeTone(loudPath, { loud: true })
  app = await launchApp()
  page = app.page
  await page.evaluate(async ({ p, loud }) => {
    const a = await window.noctivago.library.addSound({ path: p, name: 'Rain tone', keepCopy: true })
    await window.noctivago.library.addSound({ path: p, name: 'Wind tone', keepCopy: true })
    const l = await window.noctivago.library.addSound({ path: loud, name: 'Thunder loud', keepCopy: true })
    await window.noctivago.presets.save({ name: 'E2E preset', sounds: [{ soundId: a.id, volume: 0.5 }] })
    await window.noctivago.presets.save({ name: 'Other preset', sounds: [{ soundId: a.id, volume: 0.4 }] })
    await window.noctivago.presets.save({ name: 'Loud preset', sounds: [{ soundId: l.id, volume: 1 }] })
  }, { p: wavPath, loud: loudPath })
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await loadPresetFromPill()
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
  fs.rmSync(loudPath, { force: true })
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

// Step 4: rename, tags, Clip fix (the reorder drop has no live UI today: the center
// list is never draggable, so it is covered by recording only). Starts on "Other preset".
describe('Mixer undo history: edits', () => {
  const nameOf = () => page.locator('.sound-row .sound-row-name').first().innerText()
  const tagNames = () => page.locator('.sound-row .tag-chip-name').allInnerTexts()

  test('rename is undone and redone', async () => {
    // A double-click would also toggle the card in and out of the mix; the right-click menu is clean.
    await page.locator('.sound-row').first().click({ button: 'right' })
    await page.getByText('Rename…', { exact: true }).click()
    await page.locator('.sound-row-name-input').fill('Heavy rain')
    await page.keyboard.press('Enter')
    await settle()
    assert.equal(await nameOf(), 'Heavy rain')
    assert.equal(await undoTitle(), 'Undo rename Rain tone')
    await key('Control+z')
    assert.equal(await nameOf(), 'Rain tone')
    await key('Control+Shift+z')
    assert.equal(await nameOf(), 'Heavy rain')
    await key('Control+z')
    assert.equal(await nameOf(), 'Rain tone')
  })

  test('tags are undone and redone', async () => {
    assert.deepEqual(await tagNames(), [])
    await page.locator('.sound-row').first().click({ button: 'right' })
    await page.getByText('Edit tags…', { exact: true }).click()
    await page.locator('.tag-input').fill('storm')
    await page.keyboard.press('Enter')
    await settle()
    assert.deepEqual(await tagNames(), ['storm'])
    assert.equal(await undoTitle(), 'Undo tags of Rain tone')
    await key('Control+z')
    assert.deepEqual(await tagNames(), [])
    await key('Control+Shift+z')
    assert.deepEqual(await tagNames(), ['storm'])
    await key('Control+z')
    assert.deepEqual(await tagNames(), [])
  })

  test('a Clip report fix is one entry: Ctrl+Z restores the volume, Ctrl+Shift+Z lowers it again', async () => {
    await pill().click()
    await settle()
    await page.locator('.pcard-name', { hasText: 'Loud preset' }).locator('visible=true').first().click()
    await settle(1500)
    const loudVolume = () => page.evaluate(() => window.noctivago.presets.list().then((l) => l.find((p) => p.name === 'Loud preset').sounds[0].volume))
    assert.equal(await loudVolume(), 1)
    await page.waitForSelector('.sound-row [data-meter-sound].clipped', { timeout: 15000 })
    await page.locator('.sound-row [data-meter-sound].clipped').first().click()
    await page.locator('.clip-report .btn-primary').click()
    await settle()
    assert.equal(await undoTitle(), 'Undo Clip fix')
    const lowered = await (async () => {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const v = await loudVolume()
        if (v < 1) return v
        await page.waitForTimeout(150)
      }
      throw new Error('fix never saved a lower volume')
    })()
    await key('Control+z')
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && (await loudVolume()) !== 1) await page.waitForTimeout(150)
    assert.equal(await loudVolume(), 1)
    await key('Control+Shift+z')
    const deadline2 = Date.now() + 8000
    while (Date.now() < deadline2 && (await loudVolume()) !== lowered) await page.waitForTimeout(150)
    assert.equal(await loudVolume(), lowered)
  })
})

// Step 5: the Delete key with a selection, and delete as a history entry.
describe('Mixer undo history: delete', () => {
  let prevTitle
  const libraryNames = () => page.evaluate(() => window.noctivago.library.list().then((l) => l.map((e) => e.name)))
  const volumes = () => page.locator('.sound-row .sound-row-volume').evaluateAll((els) => els.map((el) => el.value))
  // Focus off any field so the key reaches the keymap (a ticked checkbox is a field).
  const press = async (combo) => {
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press(combo)
    await settle()
  }

  test('select 2 sounds, Delete, Ctrl+Z brings both back with volume and mute', async () => {
    // Starts on "Loud preset" (Thunder loud in the mix): add Wind tone, give it a volume, mute Thunder.
    await page.locator('.mx-item', { hasText: 'Wind tone' }).locator('.mx-sw').click()
    await page.waitForSelector('.sound-row:has-text("Wind tone")')
    await app.dismissToasts()
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.sound-row')].find((r) => r.textContent.includes('Wind tone'))
      const el = row.querySelector('.sound-row-volume')
      el.value = '350'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await rowOf('Thunder loud').getByRole('button', { name: 'Mute', exact: true }).click()
    await settle()
    prevTitle = await undoTitle()
    const before = await volumes()
    const namesBefore = await page.locator('.sound-row .sound-row-name').allInnerTexts()
    assert.equal(before.length, 2)
    await page.click('#bulk-select-toggle')
    // Ticked bottom row first: the restored order must follow the mix, not the selection.
    await page.locator('.sound-row-select input').nth(1).check()
    await page.locator('.sound-row-select input').nth(0).check()
    await press('Delete')
    assert.equal(await page.locator('.sound-row').count(), 0)
    assert.equal(await page.locator('.notify', { hasText: 'Deleted 2 sounds' }).count(), 1)
    assert.equal(await undoTitle(), 'Undo delete 2 sounds')
    assert.deepEqual(await libraryNames().then((n) => n.includes('Thunder loud') && n.includes('Wind tone')), true, 'files stay while the toast is open')
    await press('Control+z')
    await page.waitForSelector('.sound-row:has-text("Wind tone")')
    assert.equal(await page.locator('.sound-row').count(), 2)
    assert.equal(await page.locator('.notify', { hasText: 'Deleted 2 sounds' }).count(), 0, 'the toast closes when the delete is undone')
    assert.deepEqual(await page.locator('.sound-row .sound-row-name').allInnerTexts(), namesBefore, 'same row order after undo')
    assert.deepEqual(await volumes(), before)
    assert.equal(await page.locator('.sound-row-muted').count(), 1)
    assert.equal(await rowOf('Thunder loud').locator('xpath=self::*[contains(@class,"sound-row-muted")]').count(), 1)
    assert.equal(await undoTitle(), prevTitle)
    assert.equal(await page.locator('#mx-redo').isDisabled(), false)
  })

  test('Delete does nothing without a selection or in a field', async () => {
    await page.click('#bulk-select-toggle') // leaves select mode, clears the selection
    await press('Delete')
    assert.equal(await page.locator('.sound-row').count(), 2)
  })

  test('after the toast closes the entry is gone and the files are deleted', async () => {
    await page.mouse.move(5, 5) // hovering a toast pauses its timer
    await page.click('#bulk-select-toggle')
    await page.locator('.sound-row-select input').nth(0).check()
    await page.locator('.sound-row-select input').nth(1).check()
    await press('Delete')
    assert.equal(await undoTitle(), 'Undo delete 2 sounds')
    await page.mouse.move(5, 5)
    await page.locator('.notify', { hasText: 'Deleted 2 sounds' }).waitFor({ state: 'detached', timeout: 12000 })
    await settle()
    const names = await libraryNames()
    assert.ok(!names.includes('Thunder loud') && !names.includes('Wind tone'))
    // The delete entry left, and so did the older entries about the two gone sounds (volume, mute, add).
    assert.equal(await undoTitle(), 'Nothing to undo', 'the delete entry and the older entries about the deleted sounds left the history')
    assert.equal(await page.locator('#mx-redo').isDisabled(), true)
    assert.equal(await page.locator('.sound-row').count(), 0)
  })

  test('older entries about a deleted sound are pruned: Ctrl+Z after the toast closes touches nothing and logs no error', async () => {
    await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Gust tone', keepCopy: true }), wavPath)
    await page.reload()
    await page.waitForSelector('.mx-item')
    await app.dismissToasts()
    await page.locator('.mx-item', { hasText: 'Gust tone' }).locator('.mx-sw').click()
    await page.waitForSelector('.sound-row:has-text("Gust tone")')
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.sound-row')].find((r) => r.textContent.includes('Gust tone'))
      const el = row.querySelector('.sound-row-volume')
      el.value = '300'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
    assert.equal(await undoTitle(), 'Undo volume of Gust tone')
    await page.mouse.move(5, 5)
    await page.click('#bulk-select-toggle')
    await rowOf('Gust tone').locator('.sound-row-select input').check()
    await press('Delete')
    assert.equal(await undoTitle(), 'Undo delete Gust tone')
    await page.mouse.move(5, 5)
    await page.locator('.notify', { hasText: 'Deleted "Gust tone"' }).waitFor({ state: 'detached', timeout: 12000 })
    await settle()
    assert.ok(!(await libraryNames()).includes('Gust tone'))
    assert.equal(await page.locator('#mx-undo').isDisabled(), true, 'volume, mix and delete entries about the gone sound are all pruned')
    // Listen only now: startup logs unrelated errors (the broken example plugin, aborted streams).
    const errors = []
    const onPageError = (e) => errors.push(String(e))
    const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text()) }
    page.on('pageerror', onPageError)
    page.on('console', onConsole)
    await press('Control+z')
    await press('Control+Shift+z')
    page.off('pageerror', onPageError)
    page.off('console', onConsole)
    assert.deepEqual(errors, [])
  })
})
