// End-to-end: plugin install works in place (micro-interactions mock, row "Plugin install and
// update"): Install morphs into Installing, then a drawn check with Installed, then the plugin's
// controls; a failed install shows the reason in soft red. Runs against a local fake store
// (NOCTIVAGO_PLUGIN_LIST_URL / NOCTIVAGO_PLUGIN_RELEASE_BASE, dev builds only).
// Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp } from './launch.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const hello = path.join(root, 'dev-plugins', 'hello-world')
const SHOT = process.env.PLUGIN_MORPH_SHOT // optional folder for pictures of each state

// The fake store: one plugin that installs (hello-world's files under a new id, served slowly so
// the spinner shows) and one whose release is missing.
const LIST = [
  { id: 'e2e-morph', name: 'Morph Test', author: 'e2e', description: 'Installs fine.', repo: 'e2e/morph' },
  { id: 'e2e-missing', name: 'Missing Release', author: 'e2e', description: 'Has no release.', repo: 'e2e/missing' }
]
const manifest = { ...JSON.parse(fs.readFileSync(path.join(hello, 'manifest.json'), 'utf8')), id: 'e2e-morph', name: 'Morph Test', minAppVersion: '0.0.1' }
const server = http.createServer((req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type })
    res.end(body)
  }
  const url = req.url.split('?')[0]
  if (url === '/list.json') return send(200, JSON.stringify(LIST))
  if (url === '/stats.json') return send(200, '{}')
  if (url === '/e2e/morph/manifest.json') return setTimeout(() => send(200, JSON.stringify(manifest)), 900)
  if (url === '/e2e/morph/index.js') return send(200, fs.readFileSync(path.join(hello, 'index.js')), 'text/javascript')
  send(404, 'not found', 'text/plain')
})

let app
let page

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  process.env.NOCTIVAGO_PLUGIN_LIST_URL = `${base}/list.json`
  process.env.NOCTIVAGO_PLUGIN_STATS_URL = `${base}/stats.json`
  process.env.NOCTIVAGO_PLUGIN_RELEASE_BASE = base
  app = await launchApp()
  page = app.page
  await app.dismissToasts()
  await page.evaluate(() => window.noctivago.plugins.setRestrictedMode(false))
  await page.keyboard.press('Control+,')
  await page.locator('.subnav button', { hasText: 'Community plugins' }).click()
  await page.getByRole('button', { name: 'Browse' }).click()
})
after(async () => {
  await app?.close()
  server.close()
})

const actions = () => page.locator('.store-detail-actions')
const shot = (name) => (SHOT ? actions().screenshot({ path: path.join(SHOT, name + '.png') }).catch(() => {}) : null)

// Opens a plugin's detail and clicks Install; an unchecked or unknown release asks for a second click.
async function install(name) {
  await page.locator('.store-list-item', { hasText: name }).first().click()
  await actions().getByRole('button', { name: /^Install/ }).click()
  const anyway = page.getByRole('button', { name: 'Install anyway' })
  if (await anyway.isVisible().catch(() => false)) await anyway.click()
}

describe('Plugin install button', () => {
  test('Install: Installing spinner, then Installed with a check, then the plugin controls', async () => {
    await install('Morph Test')
    await page.locator('.store-detail-actions .morph.busy', { hasText: 'Installing' }).waitFor({ timeout: 3000 })
    await shot('1-installing')
    await page.locator('.store-detail-actions .morph.done', { hasText: 'Installed' }).waitFor({ timeout: 8000 })
    assert.equal(await page.locator('.store-detail-actions .morph.done .pill-check').count(), 1, 'drawn check')
    await page.waitForTimeout(500)
    await shot('2-installed')
    await page.locator('.store-detail-actions .morph').waitFor({ state: 'detached', timeout: 4000 })
    await actions().getByRole('button', { name: 'Uninstall' }).waitFor()
    await shot('3-controls')
  })

  test('a missing release: soft red reason on the chip, then Install comes back', async () => {
    await install('Missing Release')
    await page.locator('.store-detail-actions .morph.fail').waitFor({ timeout: 8000 })
    const text = await page.locator('.store-detail-actions .morph.fail').innerText()
    assert.ok(text.trim().length > 0 && text.length <= 41, `short reason, got "${text}"`)
    await page.waitForTimeout(400)
    await shot('4-failed')
    await page.locator('.store-detail-actions .morph').waitFor({ state: 'detached', timeout: 6000 })
    await actions().getByRole('button', { name: /^Install/ }).waitFor()
  })
})
