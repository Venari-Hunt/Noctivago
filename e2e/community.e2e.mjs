// End-to-end: the Community plugin against e2e/fakeCommunity.mjs (a local stand-in for the
// Cloudflare Worker; the build has no real server URL, so without NOCTIVAGO_COMMUNITY_URL
// the plugin hides its tab). A bundle exported by the app itself is what "Import" downloads.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'
import { startFakeCommunity } from './fakeCommunity.mjs'

let app
let page
let fake
let wavPath
let bundlePath
const settle = (ms = 500) => page.waitForTimeout(ms)
const panel = () => page.locator('.tab-panel:not(.hidden)')
const openCommunity = async () => {
  await page.locator('#tab-bar .tab-button', { hasText: 'Community' }).click()
  await settle(1200)
}

function writeTone(file) {
  const rate = 22050
  const n = rate * 2
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-cm-${process.pid}.wav`)
  bundlePath = path.join(os.tmpdir(), `noctivago-e2e-cm-${process.pid}.ncvpreset`)
  writeTone(wavPath)
  fake = await startFakeCommunity()
  app = await launchApp({ plugins: ['community'], communityUrl: fake.url, pickPath: bundlePath })
  page = app.page
  // Make a bundle with the app's own exporter, serve it, then clear the library so Import has work to do.
  await page.evaluate(async (p) => {
    const s = await window.noctivago.library.addSound({ path: p, name: 'Rain bed', keepCopy: true })
    const pr = await window.noctivago.presets.save({ name: 'Source mix', sounds: [{ soundId: s.id, volume: 0.5 }] })
    await window.noctivago.presets.export(pr.id)
    await window.noctivago.presets.delete(pr.id)
  }, wavPath)
  fake.state.bundle = fs.readFileSync(bundlePath)
  await page.reload()
  await app.dismissToasts()
})
after(async () => {
  await app?.close()
  await fake?.close()
  fs.rmSync(wavPath, { force: true })
  fs.rmSync(bundlePath, { force: true })
})

describe('Community', () => {
  test('the tab appears once a server is configured, and Browse lists the preset card', async () => {
    await openCommunity()
    const text = await panel().innerText()
    for (const w of ['Browse', 'My uploads', 'Share', 'Fake rain', 'Tester', '1 sound', 'Import', 'Report']) assert.ok(text.includes(w), w)
  })

  test('a search with no match shows no cards, and a matching one brings the card back', async () => {
    const box = panel().locator('input[type="search"], input[type="text"]').first()
    await box.fill('zzzz')
    await panel().getByRole('button', { name: 'Search' }).click()
    await settle()
    assert.ok(!(await panel().innerText()).includes('Fake rain'))
    await box.fill('rain')
    await panel().getByRole('button', { name: 'Search' }).click()
    await settle()
    assert.ok((await panel().innerText()).includes('Fake rain'))
  })

  test('Import downloads the bundle, asks to confirm, and creates the preset with its sound', async () => {
    await panel().getByRole('button', { name: 'Import' }).first().click()
    await page.locator('#preset-import-confirm').waitFor({ timeout: 15000 })
    assert.ok((await page.locator('.modal:not(.hidden)').innerText()).includes('Rain bed'))
    await page.locator('#preset-import-confirm').click()
    await page.waitForFunction(() => window.noctivago.presets.list().then((l) => l.some((p) => p.name === 'Fake rain')), null, { timeout: 15000 })
    const presets = await page.evaluate(() => window.noctivago.presets.list().then((l) => l.map((p) => ({ name: p.name, sounds: p.sounds.length }))))
    const imported = presets.filter((p) => p.name === 'Fake rain')
    assert.equal(imported.length, 1)
    assert.equal(imported[0].sounds, 1)
    assert.ok(fake.state.hits.some((h) => h.endsWith('/bundle')))
  })

  test('My uploads opens without errors', async () => {
    await panel().getByRole('button', { name: 'My uploads' }).click()
    await settle(1000)
    assert.ok(fake.state.hits.includes('GET /v1/presets/mine'))
  })

  test('Share refuses without the rights box, then uploads the chosen preset', async () => {
    await panel().getByRole('button', { name: 'Share', exact: true }).first().click()
    await page.locator('#community-share-preset').selectOption({ label: /Fake rain/ }).catch(async () => {
      const label = await page.locator('#community-share-preset option', { hasText: 'Fake rain' }).first().textContent()
      await page.locator('#community-share-preset').selectOption({ label })
    })
    await page.locator('#community-share-name').fill('Shared by e2e')
    await page.locator('#community-share-author').fill('Tester')
    await panel().getByRole('button', { name: 'Share', exact: true }).last().click()
    await settle(800)
    assert.equal(fake.state.uploads.length, 0, 'nothing is sent without the rights box')
    await page.locator('#community-share-rights').check()
    await panel().getByRole('button', { name: 'Share', exact: true }).last().click()
    await page.waitForFunction(() => true)
    for (let i = 0; i < 30 && fake.state.uploads.length === 0; i++) await settle(500)
    assert.equal(fake.state.uploads.length, 1)
    assert.equal(fake.state.uploads[0].name, 'Shared by e2e')
  })
})
