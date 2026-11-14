// App-wide visual audit (owner, 2026-11-14: "can this be done app-wide, to avoid inconsistencies and weird
// stuff"). Walks every tab, every Settings page and the shortcuts dialog at 800 and 1280 px with a small
// library loaded and a sound open in Remix, runs scripts/ui-audit-checks.mjs on each, and checks "same
// component, same size" across all of them. e2e/ui-audit-baseline.json holds today's findings: only a NEW
// finding fails. Fixing one: remove its line from the baseline (or regenerate it).
// Regenerate: set UI_AUDIT_UPDATE=1. The full report goes to <tmp>/noctivago-ui-audit.json.
// Needs the plugin builds in ../noctivago-plugin-repos (remix, browse-sounds, export, community).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp } from './launch.mjs'
import { CHECK, inconsistencies, findingKey } from '../scripts/ui-audit-checks.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const BASELINE = path.join(here, 'ui-audit-baseline.json')
const REPORT = path.join(os.tmpdir(), 'noctivago-ui-audit.json')
const WIDTHS = [800, 1280]
const HEIGHT = 900
const PLUGINS = ['remix', 'browse-sounds', 'export', 'community'].filter((id) => fs.existsSync(path.join(here, '..', '..', 'noctivago-plugin-repos', `noctivago-${id}`, 'manifest.json')))
const SETTINGS = ['General', 'Library', 'Core plugins', 'Community plugins', 'Help', 'Advanced', 'Privacy', 'About']
const RATE = 22050
let app
let page
let cdp
const files = []
const screens = []

const makeWav = (name, div) => {
  const file = path.join(os.tmpdir(), `noct-audit-${name}-${process.pid}.wav`)
  const n = RATE * 3
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / div) * 6000), 44 + i * 2)
  fs.writeFileSync(file, buf)
  files.push(file)
  return file
}

const closeOverlays = async () => {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(150)
}

async function audit(screen, go) {
  for (const width of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
    await go()
    await page.waitForTimeout(600)
    const { findings, sizes } = await page.evaluate(CHECK)
    screens.push({ screen, width, findings, sizes })
  }
}

before(async () => {
  const [a, b] = [makeWav('rain', 9), makeWav('wind', 27)]
  app = await launchApp({ plugins: PLUGINS })
  page = app.page
  const presetId = await page.evaluate(async ([fa, fb]) => {
    const n = window.noctivago
    const ra = await n.library.addSound({ path: fa, name: 'Audit rain', keepCopy: true })
    const rb = await n.library.addSound({ path: fb, name: 'Audit wind', keepCopy: true })
    await n.presets.save({ name: 'Audit mix', sounds: [{ soundId: ra.id, volume: 0.6 }, { soundId: rb.id, volume: 0.4 }] })
    return (await n.presets.list()).find((p) => p.name === 'Audit mix').id
  }, [a, b])
  await page.reload()
  await page.waitForSelector('#tab-bar .tab-button')
  await page.waitForTimeout(1500)
  // Load the mix, so the Mixer shows its cards (the main state), not an empty preset.
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('noctivago:remix-load-preset', { detail: { presetId: id } })), presetId)
  await page.waitForTimeout(1500)
  await app.dismissToasts()
  cdp = await page.context().newCDPSession(page)

  const tabs = await page.evaluate(() => [...document.querySelectorAll('#tab-bar .tab-button[data-tab-id]')].map((b) => b.dataset.tabId))
  for (const id of tabs) {
    await audit(id, async () => {
      await closeOverlays()
      await page.evaluate((t) => document.querySelector(`#tab-bar .tab-button[data-tab-id="${t}"]`).click(), id)
      // Remix: open the first sound, so its editor is audited, not the empty state.
      if (id.includes('remix') || id.includes('editor')) {
        const item = page.locator('.tab-panel:not(.hidden) .rx-item').first()
        if (await item.count()) await item.click().catch(() => {})
      }
    })
  }
  for (const p of SETTINGS) {
    await audit('settings-' + p.toLowerCase().replace(/ /g, '-'), async () => {
      await closeOverlays()
      if (!(await page.locator('.tab-panel[data-tab-id=settings]:not(.hidden)').count())) await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Settings' && !b.closest('.tab-panel'))?.click())
      await page.waitForTimeout(300)
      await page.evaluate((name) => [...document.querySelectorAll('.tab-panel[data-tab-id=settings] button, .tab-panel[data-tab-id=settings] a')].find((b) => b.textContent.trim() === name)?.click(), p)
    })
  }
  // A dialog: Add sound (the dialog a picked file opens), shown as the app shows it.
  await audit('add-sound-dialog', async () => {
    await closeOverlays()
    await page.evaluate(() => document.querySelector('#tab-bar .tab-button[data-tab-id="mixer"]').click())
    await page.evaluate(() => document.getElementById('add-sound-dialog').classList.remove('hidden'))
  })
  await page.evaluate(() => document.getElementById('add-sound-dialog').classList.add('hidden'))
  await closeOverlays()
  await cdp.send('Emulation.clearDeviceMetricsOverride')
})

after(async () => {
  await app?.close()
  for (const f of files) fs.rmSync(f, { force: true })
})

test('every screen was audited', () => {
  assert.ok(screens.length >= (SETTINGS.length + 2) * WIDTHS.length, `${screens.length} screens`)
})

test('no new visual findings beyond the baseline', () => {
  const found = new Map()
  for (const s of screens) for (const f of s.findings) found.set(findingKey(s.screen, f), `${s.width}px ${f.detail}`)
  for (const f of inconsistencies(screens)) found.set(findingKey('app', f), f.detail)
  const keys = [...found.keys()].sort()
  const counts = {}
  for (const k of keys) { const c = k.split(' | ')[1]; counts[c] = (counts[c] ?? 0) + 1 }
  fs.writeFileSync(REPORT, JSON.stringify({ counts, findings: Object.fromEntries([...found].sort()) }, null, 2))
  console.log('ui-audit:', JSON.stringify(counts), '->', REPORT)
  if (process.env.UI_AUDIT_UPDATE === '1' || !fs.existsSync(BASELINE)) {
    fs.writeFileSync(BASELINE, JSON.stringify(keys, null, 2) + '\n')
    console.log(`ui-audit: wrote ${keys.length} findings to the baseline`)
    return
  }
  const base = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')))
  const fresh = keys.filter((k) => !base.has(k))
  const fixed = [...base].filter((k) => !found.has(k))
  if (fixed.length) console.log(`ui-audit: ${fixed.length} baseline findings are gone; remove them from e2e/ui-audit-baseline.json:\n  ${fixed.join('\n  ')}`)
  assert.deepEqual(fresh.map((k) => `${k} (${found.get(k)})`), [], 'new findings')
})
