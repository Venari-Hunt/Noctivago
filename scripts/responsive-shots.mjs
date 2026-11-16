// Screenshots every tab, the Mixer with the library hidden, an open Remix sound and
// Settings at several window widths (responsive work, 2026-11-16). npm run build first.
//   node scripts/responsive-shots.mjs <out-dir> [1280,1024,900,800,640,560] [height]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from '../e2e/launch.mjs'
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true })
const widths = (process.argv[3] || '1280,1024,900,800,640').split(',').map(Number)
const height = Number(process.argv[4] || 720)
const wav = path.join(os.tmpdir(), `noct-rs-${process.pid}.wav`)
const rate = 22050, n = rate * 2, buf = Buffer.alloc(44 + n * 2)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
fs.writeFileSync(wav, buf)
const app = await launchApp({ plugins: ['remix'] })
const page = app.page
try {
  for (const name of ['Rain on tin', 'Fire crackle', 'Night crickets', 'Wind gusts']) await page.evaluate(([p, nm]) => window.noctivago.library.addSound({ path: p, name: nm, keepCopy: true }), [wav, name])
  await page.reload(); await page.waitForTimeout(2500)
  for (const c of await page.locator('.notify-close').all()) await c.click().catch(() => {})
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#tab-bar .tab-button')].map((b) => b.dataset.tabId))
  console.log('tabs', tabs.join(','))
  const cdp = await page.context().newCDPSession(page)
  for (const w of widths) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height, deviceScaleFactor: 1, mobile: false })
    for (const t of tabs) {
      await page.evaluate((id) => document.querySelector('#tab-bar .tab-button[data-tab-id="' + id + '"]')?.click(), t)
      await page.waitForTimeout(900)
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      console.log(w, t, over.sw > over.cw ? `OVERFLOW ${over.sw}` : 'ok')
      await page.screenshot({ path: path.join(out, `${w}-${t}.png`) })
    }
    await page.evaluate(() => document.querySelector('#tab-bar .tab-button[data-tab-id="mixer"]')?.click()); await page.waitForTimeout(400)
    await page.evaluate(() => document.querySelector('#mx-rail-hide')?.click()); await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(out, `${w}-mixer-closed.png`) })
    await page.evaluate(() => document.querySelector('#mx-rail-show')?.click())
    await page.evaluate(() => document.querySelector('#tab-bar .tab-button[data-tab-id="remix"]')?.click()); await page.waitForTimeout(500)
    await page.locator('.tab-panel:not(.hidden)').getByText('Rain on tin').first().click().catch((e) => console.log('no row', e.message)); await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(out, `${w}-remix-open.png`) })
    await page.locator('.nav-button').last().click().catch(() => {}); await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(out, `${w}-settings.png`) })
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    await page.evaluate(() => document.querySelector('#tab-bar .tab-button[data-tab-id="remix"]')?.click()); await page.waitForTimeout(500)
    await page.locator(".tab-panel:not(.hidden)").getByText("Rain on tin").first().click().catch((e) => console.log("no row", e.message)); await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(out, `${w}-remix-open.png`) })
    await page.locator(".nav-button").last().click().catch(() => {}); await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(out, `${w}-settings.png`) })
    await page.keyboard.press("Escape"); await page.waitForTimeout(400)
  }
} finally { await app.close(); fs.rmSync(wav, { force: true }) }
