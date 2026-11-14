// End-to-end: Remix timing markers. Ctrl+M drops one at the playhead (chip + tick on the
// progress bar), it survives a reload, a trim handle snaps to it, Ctrl turns snapping off,
// and a chip's x deletes it. Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 44100
let app
let page
let wavPath

async function openSound() {
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.tab-panel:not(.hidden)').getByText('Marker tone').first().click()
  await page.waitForTimeout(2500)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-markers-${process.pid}.wav`)
  const n = RATE * 10
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.3 * 32767), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.setViewportSize({ width: 1280, height: 900 }) // the desktop layout, canvases in view
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Marker tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await openSound()
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

const chips = () => page.locator('#rx-mlist .rx-mchip')

test('Ctrl+M adds a marker at the playhead: a chip and a tick on the progress bar', async () => {
  const bar = await page.locator('#editor-sticky-progress').boundingBox()
  await page.mouse.click(bar.x + bar.width * 0.4, bar.y + bar.height / 2) // seek to 40% of 10 s
  await page.waitForTimeout(300)
  await page.mouse.click(5, 5)
  await page.keyboard.press('Control+m')
  await page.waitForTimeout(300)
  assert.equal(await chips().count(), 1)
  const text = await chips().first().innerText()
  assert.match(text, /Marker 1/)
  assert.match(text, /0:0[34]\.\d/, `marker should sit near 4 s, chip says: ${text}`)
  assert.equal(await page.locator('#editor-sticky-progress .rx-mt').count(), 1)
  await page.screenshot({ path: path.join(os.tmpdir(), 'remix-markers-trim.png') })
})

test('the same spot twice does not add a second marker', async () => {
  await page.keyboard.press('Control+m')
  await page.waitForTimeout(200)
  assert.equal(await chips().count(), 1)
})

test('markers come back after a reload', async () => {
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await openSound()
  assert.equal(await chips().count(), 1)
})

// The loop start handle sits at the canvas's left edge; the marker is near 40% of the width.
async function dragStart(toX, ctrl) {
  const box = await page.locator('#editor-canvas').boundingBox()
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 1, y)
  await page.mouse.down()
  if (ctrl) await page.keyboard.down('Control')
  await page.mouse.move(box.x + toX / 2, y, { steps: 4 })
  await page.mouse.move(box.x + toX, y, { steps: 4 })
  await page.mouse.up()
  if (ctrl) await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  return box
}

test('a trim handle snaps to a marker, and Ctrl turns snapping off', async () => {
  const box = await page.locator('#editor-canvas').boundingBox()
  const markerX = box.width * 0.4 // the marker is at 4.0 s of 10 s
  // 7 px short of the marker (inside the 8 px reach) is about 3.9 s: the start input floors to
  // 0:03 unless the handle snapped to 4.0 s.
  await dragStart(markerX - 7, false)
  assert.equal(await page.locator('#editor-start-input').inputValue(), '0:04', 'start snaps to the marker at 4 s')
  await page.screenshot({ path: path.join(os.tmpdir(), 'remix-markers-snapped.png') })
  // Back to 0, then the same drag with Ctrl held: free.
  await page.locator('#editor-start-input').fill('0:00')
  await page.locator('#editor-start-input').press('Enter')
  await page.waitForTimeout(300)
  await dragStart(markerX - 7, true)
  assert.equal(await page.locator('#editor-start-input').inputValue(), '0:03', 'Ctrl drags free')
})

test('delete from the chip removes the marker and its tick', async () => {
  await chips().first().locator('.rx-mx').click()
  await page.waitForTimeout(200)
  assert.equal(await chips().count(), 0)
  assert.equal(await page.locator('#editor-sticky-progress .rx-mt').count(), 0)
})

test('on Spectrum a repair box edge snaps to a marker, and Ctrl draws free', async () => {
  await page.locator('#editor-start-input').fill('0:00')
  await page.locator('#editor-start-input').press('Enter')
  await page.waitForTimeout(300)
  const bar = await page.locator('#editor-sticky-progress').boundingBox()
  await page.mouse.click(bar.x + bar.width * 0.4, bar.y + bar.height / 2)
  await page.waitForTimeout(300)
  await page.mouse.click(5, 5)
  await page.keyboard.press('Control+m')
  await page.waitForTimeout(300)
  assert.equal(await chips().count(), 1)

  await page.locator('#editor-mode-panel-sound [data-rx-view="spec"]').click()
  await page.waitForTimeout(2500)
  const canvas = page.locator('#editor-spectral-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  const markerX = box.width * 0.4
  const drawBox = async (ctrl) => {
    await page.mouse.move(box.x + markerX - 6, box.y + box.height * 0.4)
    if (ctrl) await page.keyboard.down('Control') // before the press: the box's first corner snaps too
    await page.mouse.down()
    await page.mouse.move(box.x + markerX + 100, box.y + box.height * 0.6, { steps: 8 })
    await page.mouse.up()
    if (ctrl) await page.keyboard.up('Control')
    await page.waitForTimeout(300)
    const text = await page.locator('#editor-spectral-selection').innerText()
    return Number(text.match(/^(\d+\.\d+)–/)[1])
  }
  const snapped = await drawBox(false)
  assert.equal(snapped, 4, 'a box started 6 px short of the marker starts exactly on it')
  await page.screenshot({ path: path.join(os.tmpdir(), 'remix-markers-spectrum.png') })
  await page.locator('#editor-spectral-canvas').press('Delete') // drop that box
  await page.waitForTimeout(200)
  const free = await drawBox(true)
  assert.ok(free < 3.99 && free > 3.5, `Ctrl draws free, start was ${free}`)
})
