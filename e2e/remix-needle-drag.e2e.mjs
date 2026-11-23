// End-to-end: the Repair view's playback needle can be grabbed and dragged (paused and
// playing) at 480x720, 480x620 and 1500x950. Below 760 high the preview module used to be
// pinned over the bottom of the canvas, so the pointer never reached it (Board: "Spectral
// repair needle not draggable"). Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 22050
let app
let page
let cdp
let wavPath

const size = async (width, height) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await page.waitForTimeout(600)
}
const thumbPct = () => page.evaluate(() => parseFloat(document.querySelector('.rx-pthumb, #editor-sticky-progress-thumb, [class*="progress-thumb"]')?.style.left || 'NaN'))

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-needle-${process.pid}.wav`)
  const n = RATE * 8
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / (5 + (i / n) * 40)) * 3000), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Needle sound', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForTimeout(2500)
  for (const c of await page.locator('.notify-close').all()) await c.click().catch(() => {})
  cdp = await page.context().newCDPSession(page)
})

after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

for (const [w, h] of [[1500, 950], [480, 720], [480, 620]]) {
  test(`${w}x${h}: needle drags while paused and while playing, canvas not covered`, async () => {
    await size(w, h)
    await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
    await page.waitForTimeout(800)
    if (await page.locator('#rx-lib-show').isVisible()) await page.click('#rx-lib-show')
    const panel = page.locator('.tab-panel:not(.hidden)')
    await panel.locator('#rx-lib-list').getByText('Needle sound').first().click()
    await page.waitForTimeout(1500)
    await panel.getByRole('button', { name: 'Spectral repair', exact: true }).first().click()
    await page.waitForTimeout(2000)

    // Start playing, then pause: the needle shows in both states.
    await page.locator('#editor-play-pause').click()
    await page.waitForTimeout(1200)
    await page.locator('#editor-play-pause').click()
    await page.waitForTimeout(400)

    for (const state of ['paused', 'playing']) {
      if (state === 'playing') {
        await page.locator('#editor-play-pause').click()
        await page.waitForTimeout(300)
      }
      // Bring the bottom of the canvas into view: the worst case for a pinned strip.
      await page.evaluate(() => document.querySelector('#editor-spectral-canvas').scrollIntoView({ block: 'end' }))
      await page.waitForTimeout(300)
      const box = await page.locator('#editor-spectral-canvas').boundingBox()
      const pct = await thumbPct()
      assert.ok(Number.isFinite(pct), 'progress thumb found')
      const x = box.x + (box.width * pct) / 100
      const y = box.y + box.height - 6
      const top = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id, [x, y])
      assert.equal(top, 'editor-spectral-canvas', `${state}: canvas bottom is not covered (top element: ${top})`)

      const before = await thumbPct()
      const tx = x + (pct < 50 ? box.width * 0.3 : -box.width * 0.3)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move((x + tx) / 2, y, { steps: 4 })
      await page.mouse.move(tx, y, { steps: 4 })
      await page.mouse.up()
      await page.waitForTimeout(200)
      const after = await thumbPct()
      assert.ok(Math.abs(after - before) > 10, `${state}: dragging the needle moved the playhead (${before} -> ${after})`)
      if (state === 'playing') await page.locator('#editor-play-pause').click()
    }
  })
}
