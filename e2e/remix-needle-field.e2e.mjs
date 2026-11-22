// End-to-end: the Remix Trim view's Needle field shows where the needle is (paused and live while
// playing), typing a time moves the needle, bad text stays and is flagged, and Needle/Start/End/
// Length sit on one baseline. Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
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

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-needlefield-${process.pid}.wav`)
  const n = RATE * 30
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 9) * 3000), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Needle field sound', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForTimeout(2500)
  for (const c of await page.locator('.notify-close').all()) await c.click().catch(() => {})
})

after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

test('Needle field: shows the needle, follows playback, typing moves it, aligned row', async () => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(800)
  if (await page.locator('#rx-lib-show').isVisible()) await page.click('#rx-lib-show')
  const panel = page.locator('.tab-panel:not(.hidden)')
  await panel.locator('#rx-lib-list').getByText('Needle field sound').first().click()
  await page.waitForTimeout(1500)

  const needle = page.locator('#editor-needle-input')
  assert.ok(await needle.isVisible(), 'Needle field is visible')

  // Left-most of the row, one baseline, one grid.
  const boxes = await page.evaluate(() =>
    ['needle', 'start', 'end', 'length'].map((k) => {
      const i = document.querySelector(`#editor-${k}-input`)
      const r = i.getBoundingClientRect()
      const l = i.closest('label').getBoundingClientRect()
      return { k, x: r.x, bottom: r.bottom, h: r.height, w: r.width, labelTop: l.top }
    })
  )
  for (let i = 1; i < boxes.length; i++) {
    assert.ok(boxes[i].x > boxes[i - 1].x, `${boxes[i].k} is right of ${boxes[i - 1].k}`)
    assert.equal(boxes[i].bottom, boxes[0].bottom, `${boxes[i].k} shares the baseline`)
    assert.equal(boxes[i].h, boxes[0].h, `${boxes[i].k} same height`)
    assert.equal(boxes[i].w, boxes[0].w, `${boxes[i].k} same width`)
    assert.equal(boxes[i].labelTop, boxes[0].labelTop, `${boxes[i].k} label top aligned`)
  }
  const gaps = boxes.slice(1).map((b, i) => Math.round(b.x - (boxes[i].x + boxes[i].w)))
  assert.ok(gaps.every((g) => g === gaps[0]), `equal gaps ${gaps}`)
  await page.locator('.editor-times').screenshot({ path: path.join(os.tmpdir(), 'needle-field-row.png') })

  // Playing: the field follows the needle.
  await page.locator('#editor-play-pause').click()
  await page.waitForTimeout(2600)
  const live = await needle.inputValue()
  await page.locator('#editor-play-pause').click()
  await page.waitForTimeout(300)
  assert.notEqual(live, '0:00', `needle field moved while playing (${live})`)

  // Typing moves the needle.
  await needle.fill('0:20')
  await needle.press('Enter')
  await needle.blur()
  await page.waitForTimeout(400)
  assert.equal(await needle.inputValue(), '0:20')
  assert.equal(await needle.getAttribute('aria-invalid'), null)
  const pct = await page.evaluate(() => parseFloat(document.querySelector('#editor-sticky-progress-thumb')?.style.left || 'NaN'))
  assert.ok(pct > 55 && pct < 80, `progress thumb moved to about 20s of 30s (${pct}%)`)

  // Bad input keeps its text and is flagged.
  await needle.fill('abc')
  await needle.blur()
  assert.equal(await needle.inputValue(), 'abc')
  assert.equal(await needle.getAttribute('aria-invalid'), 'true')
})
