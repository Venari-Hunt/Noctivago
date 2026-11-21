// End-to-end: drag a card in the Mixer center to change the mix order (owner,
// 2026-11-21: bring drag back). The order saves into the preset, survives a
// reload, and is one undo entry. Real app, throwaway profile.
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
const rowOf = (name) => page.locator('.sound-row', { hasText: name })
const shown = () => page.locator('.sound-row .sound-row-name').allInnerTexts()
const undoTitle = () => page.locator('#mx-undo').getAttribute('title')
const savedOrder = () =>
  page.evaluate(async () => {
    const [presets, library] = await Promise.all([window.noctivago.presets.list(), window.noctivago.library.list()])
    const name = new Map(library.map((e) => [e.id, e.name]))
    return presets.find((p) => p.name === 'Drag preset').sounds.map((s) => name.get(s.soundId))
  })

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

async function waitSavedOrder(want) {
  const deadline = Date.now() + 8000
  let got
  while (Date.now() < deadline) {
    got = await savedOrder()
    if (JSON.stringify(got) === JSON.stringify(want)) return
    await page.waitForTimeout(150)
  }
  assert.deepEqual(got, want, 'saved preset order')
}

async function key(combo) {
  await page.locator('#tab-content').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(combo)
  await settle()
}

// Grab the card by its meta line (an empty spot, not a control) and drop it on
// the left or right half of the target card.
async function drag(from, to, side) {
  const target = rowOf(to)
  const box = await target.boundingBox()
  await rowOf(from).locator('.sound-row-meta-line').dragTo(target, {
    targetPosition: { x: side === 'after' ? box.width - 12 : 12, y: box.height / 2 }
  })
  await settle()
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-drag-${process.pid}.wav`)
  writeTone(wavPath)
  app = await launchApp()
  page = app.page
  await page.evaluate(async (p) => {
    const ids = []
    for (const name of ['Alpha tone', 'Beta tone', 'Gamma tone']) {
      ids.push((await window.noctivago.library.addSound({ path: p, name, keepCopy: true })).id)
    }
    await window.noctivago.presets.save({ name: 'Drag preset', sounds: ids.map((soundId) => ({ soundId, volume: 0.5 })) })
  }, wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('.preset-pill').click()
  await settle()
  await page.getByText('Drag preset').first().click()
  await page.waitForSelector('.sound-row:has-text("Gamma tone")')
  await settle(1500)
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

describe('Mixer: drag cards to change the mix order', () => {
  test('cards show in the preset order and are draggable in Mix order', async () => {
    assert.deepEqual(await shown(), ['Alpha tone', 'Beta tone', 'Gamma tone'])
    assert.equal(await page.locator('.sound-row-draggable').count(), 3)
  })

  test('dropping on the right half of the last card moves it to the end and saves', async () => {
    await drag('Alpha tone', 'Gamma tone', 'after')
    assert.deepEqual(await shown(), ['Beta tone', 'Gamma tone', 'Alpha tone'])
    assert.equal(await undoTitle(), 'Undo mix order')
    await waitSavedOrder(['Beta tone', 'Gamma tone', 'Alpha tone'])
  })

  test('dropping on the left half puts it before the target', async () => {
    await drag('Alpha tone', 'Beta tone', 'before')
    assert.deepEqual(await shown(), ['Alpha tone', 'Beta tone', 'Gamma tone'])
    await drag('Gamma tone', 'Beta tone', 'before')
    assert.deepEqual(await shown(), ['Alpha tone', 'Gamma tone', 'Beta tone'])
    await waitSavedOrder(['Alpha tone', 'Gamma tone', 'Beta tone'])
  })

  test('Ctrl+Z undoes one move, Ctrl+Shift+Z redoes it', async () => {
    await key('Control+z')
    assert.deepEqual(await shown(), ['Alpha tone', 'Beta tone', 'Gamma tone'])
    await waitSavedOrder(['Alpha tone', 'Beta tone', 'Gamma tone'])
    await key('Control+Shift+z')
    assert.deepEqual(await shown(), ['Alpha tone', 'Gamma tone', 'Beta tone'])
    await waitSavedOrder(['Alpha tone', 'Gamma tone', 'Beta tone'])
  })

  test('dragging from the knob turns the knob, never moves the card', async () => {
    await rowOf('Alpha tone').locator('.knob').first().dragTo(rowOf('Beta tone'), { targetPosition: { x: 12, y: 40 } })
    await settle()
    assert.deepEqual(await shown(), ['Alpha tone', 'Gamma tone', 'Beta tone'])
  })

  test('the order survives a reload', async () => {
    await page.waitForFunction(() => document.querySelector('.preset-pill')?.classList.contains('norm'), null, { timeout: 10000 })
    await page.reload()
    await page.waitForSelector('.sound-row:has-text("Gamma tone")')
    await settle(1000)
    assert.deepEqual(await shown(), ['Alpha tone', 'Gamma tone', 'Beta tone'])
  })

  test('other sortings show no drag: the order you see is the order you change', async () => {
    await page.selectOption('#mx-sort', 'name')
    await settle()
    assert.equal(await page.locator('.sound-row-draggable').count(), 0)
    await page.selectOption('#mx-sort', 'mix')
    await settle()
    assert.equal(await page.locator('.sound-row-draggable').count(), 3)
  })
})
