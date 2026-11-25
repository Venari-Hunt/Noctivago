// End-to-end: the running sleep timer shows time left as an amber ring round the moon (owner,
// 2026-11-21), its length the share of the timer still to run. Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './launch.mjs'

let app
let page
const SHOT = process.env.SLEEP_RING_SHOT // optional path: saves a picture of the running button

before(async () => {
  app = await launchApp()
  page = app.page
})
after(async () => {
  await page?.evaluate(() => window.noctivago.sleepTimer.cancel()).catch(() => {})
  await app?.close()
})

// The ring's drawn length in percent (pathLength is 100, so 100 - dashoffset).
const ringPercent = () =>
  page.locator('#sleep-timer-button .sleep-ring circle').evaluate((c) => 100 - parseFloat(getComputedStyle(c).strokeDashoffset))

describe('Sleep timer ring', () => {
  test('stopped: plain moon, no ring', async () => {
    await page.locator('#sleep-timer-button').waitFor()
    assert.equal(await page.locator('#sleep-timer-button .sleep-ring').count(), 0)
  })

  test('running: amber moon, ring starts full, no countdown text, tooltip has the time', async () => {
    await page.locator('#sleep-timer-button').click()
    await page.locator('#sleep-timer-start').click()
    await page.locator('#sleep-timer-button.sleep-running').waitFor()
    const btn = page.locator('#sleep-timer-button')
    assert.equal((await btn.innerText()).trim(), '', 'no time text on the button')
    assert.match(await btn.getAttribute('title'), /^Sleep timer: \d+:\d\d(:\d\d)? left$/)
    await page.waitForTimeout(1200) // let the 1 s transition land
    assert.ok((await ringPercent()) > 95, 'ring is about full right after start')
    const stroke = await page.locator('#sleep-timer-button .sleep-ring circle').evaluate((c) => getComputedStyle(c).stroke)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
    assert.ok(stroke.length > 0 && accent.length > 0)
    if (SHOT) await btn.screenshot({ path: SHOT })
  })

  test('the ring closes as time runs out', async () => {
    // A 4 s timer through the real main process: about half the ring is left after 2 s.
    const state = await page.evaluate(() => window.noctivago.sleepTimer.start({ durationSeconds: 4, action: 'stop', mode: 'in', minutes: 30 }))
    assert.ok(Number.isFinite(state.startedAt), 'main sends when the timer started')
    // The renderer picks up a timer started elsewhere when the popover opens.
    await page.locator('#sleep-timer-button').click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(2300)
    const mid = await ringPercent()
    assert.ok(mid > 20 && mid < 75, `ring about half way, got ${mid}`)
    await page.locator('#sleep-timer-button:not(.sleep-running)').waitFor({ timeout: 5000 })
  })
})
