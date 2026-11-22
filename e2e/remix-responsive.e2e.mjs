// End-to-end: Remix down to the 560x560 window minimum (responsive step 2). At 1280 the
// three panes stay as the mock; below 1180 the library slides over the editor (starts
// hidden, opens on the chevron with the search focused, closes on Esc and after a sound is
// picked) and the preview module sits under the canvas; below 860 everything stacks and the
// preview stays pinned while the settings scroll (below 760 high it scrolls in its own row
// instead, so it never covers the canvas). No sideways overflow at any width.
// Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 22050
const BAR = 72 // the app's bottom bar
let app
let page
let cdp
let wavPath

const size = async (width, height) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await page.waitForTimeout(500)
}
const libState = () => page.evaluate(() => document.querySelector('.editor-tab.rx').dataset.rxLib)

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-responsive-${process.pid}.wav`)
  const n = RATE * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 9) * 6000), 44 + i * 2)
  fs.writeFileSync(wavPath, buf)
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  for (const name of ['Rain on tin', 'Fire crackle']) {
    await page.evaluate(([p, nm]) => window.noctivago.library.addSound({ path: p, name: nm, keepCopy: true }), [wavPath, name])
  }
  await page.reload()
  await page.waitForTimeout(2500)
  for (const c of await page.locator('.notify-close').all()) await c.click().catch(() => {})
  cdp = await page.context().newCDPSession(page)
})

after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

test('1280: three panes, library shown, no show-library button', async () => {
  await size(1280, 720)
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(800)
  assert.equal(await libState(), 'on')
  await page.locator('#rx-lib-list').getByText('Rain on tin').click()
  await page.waitForTimeout(1200)
  assert.ok(await page.locator('#rx-lib-show').isHidden())
})

for (const [w, h, pick] of [[1100, 720, 'Fire crackle'], [859, 800, 'Rain on tin'], [859, 720, 'Rain on tin'], [560, 560, 'Fire crackle']]) {
  test(`${w}x${h}: library slides over, preview stays in reach`, async () => {
    await size(w, h)
    const st = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect()
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, title: box('#rx-title').width, play: box('.rx-pplay').bottom }
    })
    assert.equal(await libState(), 'off', 'library starts hidden')
    assert.ok(st.sw <= st.cw, `no sideways overflow (${st.sw} > ${st.cw})`)
    assert.ok(st.title >= 120, `title keeps room (${st.title})`)
    if (!(w < 860 && h < 760)) assert.ok(st.play <= h - BAR, `preview Play above the bottom bar (${st.play})`)

    await page.click('#rx-lib-show')
    await page.waitForTimeout(300)
    const d = await page.evaluate(() => {
      const b = document.querySelector('.rx-lib').getBoundingClientRect()
      return { x: b.x, w: b.width, bottom: b.bottom, focus: document.activeElement?.id }
    })
    assert.ok(d.x >= 0 && d.w > 200 && d.bottom <= h - BAR, `drawer in view (${JSON.stringify(d)})`)
    assert.equal(d.focus, 'rx-lib-search')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    assert.equal(await libState(), 'off', 'Esc closes')

    await page.click('#rx-lib-show')
    await page.locator('#rx-lib-list').getByText(pick).click()
    await page.waitForTimeout(900)
    assert.equal(await libState(), 'off', 'picking a sound closes')
    assert.equal(await page.locator('#rx-title').textContent(), pick)

    if (w < 860 && h >= 760) {
      await page.evaluate(() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight })
      await page.waitForTimeout(300)
      const play = await page.evaluate(() => document.querySelector('.rx-pplay').getBoundingClientRect())
      assert.ok(play.top >= 0 && play.bottom <= h - BAR, `Play pinned after scrolling (${play.top}..${play.bottom})`)
      await page.evaluate(() => { document.querySelector('main').scrollTop = 0 })
    }
    if (w < 860 && h < 760) {
      // Short window: the preview scrolls in its own row and never covers the canvas.
      const st2 = await page.evaluate(() => {
        const pos = getComputedStyle(document.querySelector('.rx-prev')).position
        const c = document.querySelector('.rx-canvas').getBoundingClientRect()
        const p = document.querySelector('.rx-prev').getBoundingClientRect()
        document.querySelector('.rx-pplay').scrollIntoView({ block: 'center' })
        return { pos, canvasBottom: c.bottom, prevTop: p.top }
      })
      assert.equal(st2.pos, 'static', 'preview not pinned below 760 high')
      assert.ok(st2.prevTop >= st2.canvasBottom, `preview below the canvas (${st2.prevTop} < ${st2.canvasBottom})`)
      await page.waitForTimeout(300)
      const play = await page.evaluate(() => document.querySelector('.rx-pplay').getBoundingClientRect())
      assert.ok(play.top >= 0 && play.bottom <= h - BAR, `Play reachable by scrolling (${play.top}..${play.bottom})`)
      await page.evaluate(() => { document.querySelector('main').scrollTop = 0 })
    }
  })
}

test('back to 1280: library returns beside the editor', async () => {
  await size(1280, 720)
  assert.equal(await libState(), 'on')
  assert.ok(await page.locator('.rx-lib').isVisible())
})
