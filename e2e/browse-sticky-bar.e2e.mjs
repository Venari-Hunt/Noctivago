// End-to-end: Browse Sounds' player bar (play, progress, volume) stays visible
// while the results scroll, shows with nothing playing, and keeps the last
// sound as the current one so Play resumes it (owner, 2026-11-21).
//
// The app has no Freesound key in dev, so a second instance of the real built
// plugin (../noctivago-plugin-repos/noctivago-browse-sounds, npm run build) is
// mounted into the Browse Sounds panel with a fake search; the app's layout and
// the plugin's own CSS are the real ones. Audio plays a short generated tone
// (the app runs with --mute-audio).
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp } from './launch.mjs'

// Set SHOT_DIR to also save screenshots of the bar (1280 and 560 wide).
const SHOT_DIR = process.env.SHOT_DIR || ''

let app
let page
const settle = (ms = 400) => page.waitForTimeout(ms)
const PANEL = '.tab-panel:not(.hidden)'
const bar = () => page.locator(`${PANEL} #browse-pvbar`)

// One second of a quiet tone, as a data: URL.
function toneDataUrl() {
  const rate = 8000
  const n = rate
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 6) * 800), 44 + i * 2)
  return `data:audio/wav;base64,${buf.toString('base64')}`
}

// The app's own scroller is <main>; the tab panel sits inside it.
const SCROLLER = 'main'

// Is the bar fully inside the scroller's visible area right now?
async function barInView() {
  return page.evaluate(([panelSel, scrollerSel]) => {
    const scroller = document.querySelector(scrollerSel)
    const el = document.querySelector(`${panelSel} #browse-pvbar`)
    const p = scroller.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    return {
      visible: b.width > 0 && b.height > 0 && getComputedStyle(el).display !== 'none',
      inside: b.top >= p.top - 1 && b.bottom <= p.bottom + 1,
      scrollTop: scroller.scrollTop,
      scrollable: scroller.scrollHeight > scroller.clientHeight + 50
    }
  }, [PANEL, SCROLLER])
}

const scrollPanel = (to) => page.evaluate(([sel, where]) => {
  const scroller = document.querySelector(sel)
  scroller.scrollTop = where === 'bottom' ? scroller.scrollHeight : where === 'middle' ? scroller.scrollHeight / 2 : 0
}, [SCROLLER, to])

before(async () => {
  app = await launchApp({ plugins: ['browse-sounds'] })
  page = app.page
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Browse Sounds' }).click()
  await settle(1000)
  await page.evaluate(async (tone) => {
    // Every preview plays the generated tone; the last Audio is kept for inspection.
    const RealAudio = window.Audio
    window.Audio = function (src) {
      const audio = new RealAudio(tone)
      audio._wanted = src
      window.__lastAudio = audio
      return audio
    }
    const href = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).find((h) => h.startsWith('plugin://browse-sounds/'))
    const base = href.slice(0, href.lastIndexOf('/') + 1)
    const { default: Plugin } = await import(/* @vite-ignore */ `${base}main.js`)
    const sounds = Array.from({ length: 40 }, (_, i) => ({
      id: 1000 + i,
      name: `Rain on a roof ${i + 1}`,
      username: 'tester',
      license: 'http://creativecommons.org/publicdomain/zero/1.0/',
      pageUrl: 'https://freesound.org/s/' + (1000 + i),
      previewUrl: 'https://example.invalid/p' + i + '.mp3',
      description: '',
      tags: ['rain', 'roof'],
      durationSeconds: 12,
      numRatings: 0,
      avgRating: null
    }))
    const fakeApi = {
      freesound: { isAvailable: async () => true, search: async () => ({ ok: true, results: sounds, count: sounds.length, hasMore: false }) },
      library: { list: async () => [] }
    }
    const plugin = new Plugin({ noctivago: fakeApi, tabs: { register: () => () => {} }, settings: { addPage: () => () => {} } })
    const panel = document.querySelector('.tab-panel:not(.hidden)')
    panel.replaceChildren()
    plugin.mount(panel)
    window.__plugin = plugin
  }, toneDataUrl())
  await page.waitForSelector(`${PANEL} #browse-query:not([disabled])`)
  await page.fill(`${PANEL} #browse-query`, 'rain')
  await page.click(`${PANEL} #browse-search-btn`)
  await page.waitForSelector(`${PANEL} .bs-tile`)
  await settle(300)
})

after(async () => {
  await app?.close()
})

describe('Browse Sounds player bar', () => {
  test('shows with nothing playing: idle name, progress at the start, volume works', async () => {
    assert.ok(await bar().isVisible())
    assert.equal(await page.locator(`${PANEL} #browse-pv-name`).innerText(), 'Nothing playing')
    assert.equal(await page.locator(`${PANEL} #browse-pv-seek`).inputValue(), '0')
    assert.equal(await page.locator(`${PANEL} #browse-pv-time`).innerText(), '0:00 / 0:00')
    assert.ok(await page.locator(`${PANEL} #browse-pv-play`).isDisabled(), 'Play waits for a sound')
    const volume = page.locator(`${PANEL} #browse-pv-volume`)
    assert.ok(await volume.isEnabled(), 'volume is adjustable before anything plays')
    await volume.fill('60')
    assert.equal(await volume.inputValue(), '60')
    await volume.fill('100')
  })

  test('stays in view at the top, middle and bottom of the scrolled results', async () => {
    for (const where of ['top', 'middle', 'bottom']) {
      await scrollPanel(where)
      await settle(150)
      const s = await barInView()
      assert.ok(s.scrollable, 'the results are long enough to scroll')
      assert.ok(s.visible && s.inside, `bar in view at ${where} (scrollTop ${s.scrollTop})`)
    }
    const s = await barInView()
    assert.ok(s.scrollTop > 100, 'the panel really scrolled')
    if (SHOT_DIR) {
      fs.mkdirSync(SHOT_DIR, { recursive: true })
      await scrollPanel('middle')
      await settle(150)
      await page.screenshot({ path: path.join(SHOT_DIR, 'browse-bar-idle-scrolled.png') })
    }
  })

  test('playing a sound fills the bar; the volume reaches the audio while scrolled away', async () => {
    await scrollPanel('top')
    await page.locator(`${PANEL} .bs-tile .bs-pv`).first().click()
    await settle(500)
    assert.equal(await page.locator(`${PANEL} #browse-pv-name`).innerText(), 'Rain on a roof 1')
    assert.equal(await page.locator(`${PANEL} #browse-pv-play`).getAttribute('aria-label'), 'Pause preview')
    assert.ok(await page.evaluate(() => !window.__lastAudio.paused))
    await scrollPanel('bottom')
    await settle(150)
    const s = await barInView()
    assert.ok(s.visible && s.inside, 'bar in view while playing and scrolled to the bottom')
    await page.locator(`${PANEL} #browse-pv-volume`).fill('40')
    assert.equal(await page.evaluate(() => Math.round(window.__lastAudio.volume * 100)), 40)
  })

  test('the last sound stays current after it ends, and Play resumes it', async () => {
    // The tone is one second long: wait for it to finish.
    await page.waitForFunction(() => window.__lastAudio.paused, null, { timeout: 5000 })
    await settle(200)
    assert.equal(await page.locator(`${PANEL} #browse-pv-name`).innerText(), 'Rain on a roof 1', 'the finished sound is still current')
    assert.equal(await page.locator(`${PANEL} #browse-pv-seek`).inputValue(), '0', 'progress is back at the start')
    assert.equal(await page.locator(`${PANEL} #browse-pv-play`).getAttribute('aria-label'), 'Play preview')
    const same = await page.evaluate(() => (window.__first = window.__lastAudio) && true)
    assert.ok(same)
    await page.locator(`${PANEL} #browse-pv-play`).click()
    await settle(300)
    assert.ok(await page.evaluate(() => !window.__lastAudio.paused && window.__lastAudio === window.__first), 'Play on the bar restarts the same sound')
  })

  test('pause, then a new search and leaving the tab keep the sound; Play resumes where it was', async () => {
    await page.locator(`${PANEL} #browse-pv-play`).click()
    assert.ok(await page.evaluate(() => window.__lastAudio.paused))
    await page.fill(`${PANEL} #browse-query`, 'wind')
    await page.click(`${PANEL} #browse-search-btn`)
    await page.waitForSelector(`${PANEL} .bs-tile`)
    await settle(300)
    assert.equal(await page.locator(`${PANEL} #browse-pv-name`).innerText(), 'Rain on a roof 1', 'a new search keeps the last sound')
    assert.ok(await page.locator(`${PANEL} #browse-pv-play`).isEnabled())
    await page.evaluate(() => window.__plugin.pausePreview()) // what leaving the tab does
    await page.locator(`${PANEL} #browse-pv-play`).click()
    await settle(300)
    assert.ok(await page.evaluate(() => !window.__lastAudio.paused && window.__lastAudio === window.__first), 'Play resumes the same sound')
    assert.equal(await page.locator(`${PANEL} #browse-pv-play`).getAttribute('aria-label'), 'Pause preview')
  })

  test('the bar fits at 560 wide and 1280 wide (screenshots with SHOT_DIR)', async () => {
    for (const width of [1280, 560]) {
      await page.setViewportSize({ width, height: 800 })
      await settle(400)
      await scrollPanel('middle')
      await settle(150)
      const s = await barInView()
      assert.ok(s.visible && s.inside, `bar in view at ${width} wide`)
      const overflow = await page.evaluate(([sel, scrollerSel]) => {
        const b = document.querySelector(`${sel} #browse-pvbar`).getBoundingClientRect()
        const p = document.querySelector(scrollerSel).getBoundingClientRect()
        return b.right > p.right + 1 || b.left < p.left - 1
      }, [PANEL, SCROLLER])
      assert.equal(overflow, false, `bar not wider than the panel at ${width}`)
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `browse-bar-${width}.png`) })
    }
  })
})
