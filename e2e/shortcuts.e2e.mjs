// End-to-end: the real app, a throwaway profile. Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './launch.mjs'

let app
let page
const activeTab = () => page.evaluate(() => document.querySelector('#tab-bar .tab-button-active')?.dataset.tabId ?? null)
const settingsOpen = () => page.evaluate(() => !document.querySelector('.sets')?.closest('.tab-panel')?.classList.contains('hidden'))
const settle = () => page.waitForTimeout(250)

before(async () => {
  app = await launchApp()
  page = app.page
})
after(() => app?.close())

describe('keyboard shortcuts', () => {
  test('Ctrl+1 and Ctrl+2 switch tabs', async () => {
    await page.keyboard.press('Control+2')
    await settle()
    assert.notEqual(await activeTab(), 'mixer')
    await page.keyboard.press('Control+1')
    await settle()
    assert.equal(await activeTab(), 'mixer')
  })

  test('Ctrl+, opens Settings and a second press goes back', async () => {
    await page.keyboard.press('Control+,')
    await settle()
    assert.equal(await settingsOpen(), true)
    await page.keyboard.press('Control+,')
    await settle()
    assert.equal(await settingsOpen(), false)
  })

  test('? opens Settings > Help and lists every shortcut', async () => {
    await page.keyboard.press('Shift+?')
    await settle()
    assert.equal(await settingsOpen(), true)
    const text = await page.locator('.scol').innerText()
    for (const title of ['Play or pause', 'Search sounds', 'Save preset changes', 'Open or close Settings', 'Full screen', 'Show shortcuts']) {
      assert.ok(text.includes(title), `Help lists "${title}"`)
    }
    assert.equal(await page.locator('.subnav button.cur').innerText(), 'Help')
  })

  test('Ctrl+F goes to the Mixer and focuses search', async () => {
    await page.keyboard.press('Control+f')
    await settle()
    assert.equal(await activeTab(), 'mixer')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'sound-search')
  })

  test('keys typed in the search field are left alone (no ?, no Space shortcut)', async () => {
    await page.keyboard.type('a ?b')
    await settle()
    assert.equal(await settingsOpen(), false)
    assert.equal(await page.inputValue('#sound-search'), 'a ?b')
    await page.fill('#sound-search', '')
  })

  test('F11 reaches the main process without an error', async () => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e))
    await page.keyboard.press('F11')
    await settle()
    await page.keyboard.press('F11')
    await settle()
    assert.deepEqual(errors, [])
  })
})

describe('Settings pages', () => {
  test('sidebar lists Help between Community plugins and Privacy', async () => {
    await page.keyboard.press('Control+,')
    await settle()
    const names = await page.locator('.subnav button').allInnerTexts()
    assert.deepEqual(names.slice(-4), ['Community plugins', 'Help', 'Privacy', 'About'])
  })

  test('About links the GitHub profile', async () => {
    await page.locator('.subnav button', { hasText: 'About' }).click()
    const href = await page.locator('a.btn', { hasText: 'GitHub' }).getAttribute('href')
    assert.equal(href, 'https://github.com/Venari-Hunt')
  })

  test('Privacy page names the online features', async () => {
    await page.locator('.subnav button', { hasText: 'Privacy' }).click()
    const text = await page.locator('.scol').innerText()
    for (const word of ['Freesound', 'YouTube', 'Community', 'updates']) assert.ok(text.includes(word), word)
  })
})
