// End-to-end: Settings > Advanced > Troubleshooting. Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './launch.mjs'

let app
let page
const settle = (ms = 400) => page.waitForTimeout(ms)

before(async () => {
  app = await launchApp()
  page = app.page
  // Playwright's key presses go to the page over CDP, past the shortcut hook in the main process, so the shortcut itself is unit-tested (test/devToolsShortcut.test.js) and left to the owner's hands.
  await page.context().grantPermissions(['clipboard-read'])
  await page.keyboard.press('Control+,')
  await settle()
  await page.locator('.subnav button', { hasText: 'Advanced' }).click()
  await settle()
})
after(() => app?.close())

describe('Settings > Advanced > Troubleshooting', () => {
  test('the page lists the three tools, Developer tools off', async () => {
    const text = await page.locator('.scol').innerText()
    for (const name of ['Developer tools', 'Copy logs', 'Report a bug']) assert.ok(text.includes(name), `lists "${name}"`)
    assert.equal(await page.getByRole('switch', { name: 'Developer tools' }).getAttribute('aria-checked'), 'false')
  })

  test('Copy logs puts the versions and the log on the clipboard', async () => {
    await page.locator('.settings-item', { hasText: 'Copy logs' }).getByRole('button').click()
    await page.locator('.settings-item', { hasText: 'Copy logs' }).getByRole('button', { name: 'Copied' }).waitFor()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(text, /^Noctívago \d/)
    assert.ok(text.includes('main.log (last 200 lines):'))
  })

  test('Developer tools switch saves, and the setting survives a read', async () => {
    await page.getByRole('switch', { name: 'Developer tools' }).click()
    await settle()
    assert.equal(await page.getByRole('switch', { name: 'Developer tools' }).getAttribute('aria-checked'), 'true')
    assert.equal((await page.evaluate(() => window.noctivago.settings.get())).developerTools, true)
  })
})
