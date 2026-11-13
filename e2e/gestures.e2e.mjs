// End-to-end: the gestures a text diff cannot see (Desktop 2.0 step 20 parity):
// drag a sound row to reorder, Remix EQ graph gestures, Remix Spectrum box gestures.
// Needs the Remix plugin built in ../noctivago-plugin-repos/noctivago-remix.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
const wavs = []
const settle = (ms = 300) => page.waitForTimeout(ms)

function writeNoise(file, seconds = 4) {
  const rate = 22050
  const n = rate * seconds
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / (5 + (i / n) * 40)) * 3000 + (Math.random() - 0.5) * 4000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

before(async () => {
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    const f = path.join(os.tmpdir(), `noctivago-e2e-gest-${process.pid}-${name}.wav`)
    writeNoise(f)
    wavs.push(f)
    await page.evaluate((a) => window.noctivago.library.addSound(a), { path: f, name, keepCopy: true })
  }
  await page.reload()
  await page.waitForSelector('.mx-item')
  await settle(1500)
  await app.dismissToasts()
})
after(async () => {
  await app?.close()
  for (const f of wavs) fs.rmSync(f, { force: true })
})

const rowNames = () => page.locator('.sound-row .sound-name, .sound-row [class*="name"]').allTextContents()
const orderOf = async () => {
  const txt = await page.locator('.sound-row').allInnerTexts()
  return ['Alpha', 'Bravo', 'Charlie'].map((n) => [n, txt.findIndex((t) => t.includes(n))]).sort((a, b) => a[1] - b[1]).map((p) => p[0])
}

describe('Mixer gestures', () => {
  test('dragging a row onto another reorders the list', async () => {
    for (const n of ['Alpha', 'Bravo', 'Charlie']) {
      await page.locator('.mx-item', { hasText: n }).first().click()
      await settle(200)
    }
    await page.waitForFunction(() => document.querySelectorAll('.sound-row').length === 3)
    const before = await orderOf()
    assert.equal(before.length, 3)
    const last = before[2]
    const first = before[0]
    assert.equal(await page.locator('.sound-row[draggable="true"]').count(), 3, 'rows are not draggable in Mix order')
    // Playwright's mouse drag does not start native HTML5 drag-and-drop in Electron over CDP,
    // so fire the same events the browser would; the row's own handlers do the rest.
    await page.evaluate(([from, to]) => {
      const rowOf = (name) => [...document.querySelectorAll('.sound-row')].find((r) => r.innerText.includes(name))
      const dt = new DataTransfer()
      rowOf(from).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      rowOf(to).dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      rowOf(to).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    }, [last, first])
    await settle(600)
    const after = await orderOf()
    assert.notDeepEqual(after, before, 'order did not change after the drag')
    assert.equal(after.indexOf(last) < after.indexOf(first), true, `${last} should now sit above ${first}`)
  })
})

async function openRemix(name, view) {
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await settle(1000)
  const panel = page.locator('.tab-panel:not(.hidden)')
  await panel.getByText(name).first().click()
  await settle(2000)
  await panel.getByRole('button', { name: view, exact: true }).first().click()
  await settle(800)
}

describe('Remix EQ gestures', () => {
  let canvas
  let box
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy]
  // The selected band's fields; empty when no band is selected.
  const field = (id) => page.locator('#editor-eq-' + id).inputValue()

  test('double-click adds and selects a band; drag moves it; Delete clears it', async () => {
    await openRemix('Alpha', 'EQ')
    // A fixed window size: the graph must be on screen for the mouse to reach it.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })
    await settle(600)
    canvas = page.locator('#editor-eq-canvas')
    await canvas.scrollIntoViewIfNeeded()
    box = await canvas.boundingBox()
    assert.equal(await field('freq'), '', 'a band is already selected')
    const [x, y] = at(0.25, 0.3)
    await page.mouse.dblclick(x, y)
    await settle(400)
    const f0 = await field('freq')
    const g0 = await field('gain')
    assert.notEqual(f0, '', 'double-click did not add a band')
    assert.ok(Number(g0) > 0, 'a click above 0 dB should add a boost, got ' + g0)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 80, y + 40, { steps: 6 })
    await page.mouse.up()
    await settle(400)
    const f1 = await field('freq'); assert.notEqual(f1, f0, 'drag did not move the band (freq ' + f0 + ' to ' + f1 + ')')
    const g1 = await field('gain'); assert.notEqual(g1, g0, 'drag did not change gain (' + g0 + ' to ' + g1 + ')')
    await page.keyboard.press('Delete')
    await settle(400)
    assert.equal(await page.locator('#editor-eq-type').inputValue(), 'off', 'Delete did not turn the band off')
  })

  test('scroll over a node changes its Q', async () => {
    box = await canvas.boundingBox()
    const [x, y] = at(0.4, 0.35)
    await page.mouse.dblclick(x, y)
    await settle(400)
    const q0 = await field('q')
    assert.notEqual(q0, '')
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, -240)
    await settle(300)
    assert.notEqual(await field('q'), q0, 'wheel over a node did not change Q')
  })
})

describe('Remix Spectrum gestures', () => {
  test('drawing a box selects it; Delete box removes it', async () => {
    await page.locator('.tab-panel:not(.hidden)').getByRole('button', { name: 'Spectrum', exact: true }).first().click()
    await settle(2500)
    const canvas = page.locator('#editor-spectral-canvas')
    const box = await canvas.boundingBox()
    const sel = page.locator('#editor-spectral-selection')
    assert.match(await sel.innerText(), /No box selected/)
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 8 })
    await page.mouse.up()
    await settle(500)
    assert.doesNotMatch(await sel.innerText(), /No box selected/, 'drawing did not select a new box')
    assert.equal(await page.locator('#editor-spectral-delete').isDisabled(), false)
    await page.locator('#editor-spectral-delete').click()
    await settle(400)
    assert.match(await sel.innerText(), /No box selected/)
  })
})
