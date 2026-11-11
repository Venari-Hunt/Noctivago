// End-to-end: the real plugins (built from ../noctivago-plugin-repos) in the real app,
// on a throwaway profile with one generated test sound. Browse Sounds needs the
// network for Freesound/YouTube, so only its empty state is checked here.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

let app
let page
let wavPath
const problems = []
const settle = (ms = 400) => page.waitForTimeout(ms)
const panel = () => page.locator('.tab-panel:not(.hidden)')
const openTab = async (name) => {
  await page.locator('#tab-bar .tab-button', { hasText: name }).click()
  await settle(1000)
}

function writeNoise(file) {
  const rate = 22050
  const n = rate * 3
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-plugins-${process.pid}.wav`)
  writeNoise(wavPath)
  app = await launchApp({ plugins: ['remix', 'export', 'composite', 'browse-sounds'] })
  page = app.page
  // The dev fixture "broken-plugin-example" fails on purpose; anything else is a real problem.
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !t.includes('broken-plugin') && !t.includes('sound:// stream error') && !t.includes('404')) problems.push(t)
  })
  page.on('response', (r) => {
    // A sound with no baked loop clip yet answers 404 to ?variant=clip; the app falls back to the original.
    if (r.status() >= 400 && !r.url().includes('variant=clip')) problems.push(`HTTP ${r.status()} ${r.url()}`)
  })
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'E2E sound', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.sound-row')
  await settle(2500)
  // The dev fixture's start-up error toast would sit over the buttons.
  for (const close of await page.locator('.notify-close').all()) await close.click()
})
after(async () => {
  await app?.close()
  fs.rmSync(wavPath, { force: true })
})

describe('plugin tabs', () => {
  test('Remix, Export, Composite and Browse Sounds all show up as tabs', async () => {
    await page.waitForSelector('#tab-bar .tab-button:has-text("Remix")', { state: 'attached', timeout: 15000 })
    const tabs = await page.locator('#tab-bar .tab-button').allTextContents()
    for (const name of ['Remix', 'Export', 'Composite', 'Browse Sounds']) assert.ok(tabs.some((t) => t.includes(name)), name)
  })

  test('Browse Sounds opens on its empty state with the search box', async () => {
    await openTab('Browse Sounds')
    const text = await panel().innerText()
    assert.ok(text.includes('Find sounds for your mix'))
    assert.ok(text.includes('Freesound') && text.includes('YouTube'))
  })

  test('Export shows the form and the summary card', async () => {
    await openTab('Export')
    const text = await panel().innerText()
    for (const word of ['Length', 'Fade', 'WAV', 'FLAC', 'MP3', 'This export', 'Export']) assert.ok(text.includes(word), word)
    assert.match(text, /WAV, about \d+ MB/)
  })
})

describe('Remix', () => {
  test('opens with its mode chips and the sound list', async () => {
    await openTab('Remix')
    const text = await panel().innerText()
    for (const word of ['Sound', 'Group', 'Preset', 'E2E sound', 'Pick a sound to edit']) assert.ok(text.includes(word), word)
  })

  test('picking a sound shows the studio: views, transport and accordions', async () => {
    await panel().getByText('E2E sound').first().click()
    await settle(2000)
    const text = await panel().innerText()
    for (const word of ['Trim', 'Loop seam', 'EQ', 'Spectrum', 'Save as copy', 'Playback', 'Speed and pitch', 'Tone', 'Parametric EQ', 'Cleanup', 'Space', 'Drift']) {
      assert.ok(text.includes(word), word)
    }
    assert.match(text, /0:03/) // the 3 s test sound's length
  })

  test('the Loop seam view has the crossfade control', async () => {
    await panel().getByRole('button', { name: 'Loop seam', exact: true }).first().click()
    await settle()
    const text = await panel().innerText()
    assert.ok(text.includes('Crossfade'))
    assert.ok(text.includes('Listen to the seam'))
  })

  test('the EQ view has Before / After / Both and the band controls', async () => {
    await panel().getByRole('button', { name: 'EQ', exact: true }).first().click()
    await settle()
    const text = await panel().innerText()
    for (const word of ['Add band', 'Before', 'After', 'Both', 'Heatmap', 'Freq', 'Gain', 'Q']) assert.ok(text.includes(word), word)
  })

  test('adding an EQ band keeps the app responsive and shows band controls', async () => {
    await panel().getByRole('button', { name: 'Add band' }).first().click()
    await settle()
    assert.ok(await panel().getByRole('button', { name: 'Delete band' }).first().isVisible())
  })

  test('the Spectrum view offers Reduce by and box controls', async () => {
    await panel().getByRole('button', { name: 'Spectrum', exact: true }).first().click()
    await settle()
    const text = await panel().innerText()
    for (const word of ['No box selected', 'Reduce by', 'Delete box', 'Clear all boxes']) assert.ok(text.includes(word), word)
  })

  test('Group and Preset modes switch the screen', async () => {
    await panel().getByRole('button', { name: 'Group', exact: true }).first().click()
    await settle()
    assert.ok((await panel().innerText()).includes('Group'))
    await panel().getByRole('button', { name: 'Preset', exact: true }).first().click()
    await settle()
    assert.ok((await panel().innerText()).includes('Preset'))
  })
})

describe('Remix leave guard', () => {
  test('leaving with an unsaved EQ band asks first; No stays, Yes leaves', async () => {
    await page.locator('#tab-bar .tab-button', { hasText: 'Composite' }).click()
    await settle()
    assert.ok(await page.locator('#editor-leave-confirm-yes').isVisible())
    await page.locator('#editor-leave-confirm-no').click()
    await settle()
    assert.equal(await page.evaluate(() => document.querySelector('.tab-button-active')?.dataset.tabId), 'remix')
    await page.locator('#tab-bar .tab-button', { hasText: 'Composite' }).click()
    await page.locator('#editor-leave-confirm-yes').click()
    await settle(800)
    assert.equal(await page.evaluate(() => document.querySelector('.tab-button-active')?.dataset.tabId), 'composite')
  })
})

describe('Composite', () => {
  test('welds a sound into a new one that appears in the Mixer', async () => {
    await openTab('Composite')
    await panel().locator('#composite-name').fill('E2E weld')
    // Two lanes start empty; a weld needs a sound in each.
    for (const lane of await panel().locator('.cp-tl select').all()) await lane.selectOption({ label: 'E2E sound' })
    await settle(800)
    await panel().getByRole('button', { name: 'Make sound' }).click()
    await page.waitForFunction(() => window.noctivago.library.list().then((l) => l.some((e) => e.name === 'E2E weld')), null, { timeout: 30000 })
    await openTab('Mixer')
    const names = await page.evaluate(() => window.noctivago.library.list().then((l) => l.map((e) => e.name)))
    assert.ok(names.includes('E2E weld'), `library has: ${names.join(', ')}`)
  })
})

describe('whole run', () => {
  test('no unexpected errors or failed requests in any tab', () => {
    assert.deepEqual(problems, [])
  })
})
