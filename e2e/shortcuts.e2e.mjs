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
    for (const title of ['Play or pause', 'Search sounds', 'Save preset changes', 'Open or close Settings', 'Undo the last Mixer change', 'Redo (also Ctrl+Y)', 'Full screen', 'Show shortcuts']) {
      assert.ok(text.includes(title), `Help lists "${title}"`)
    }
    assert.equal(await page.locator('.subnav button.cur').innerText(), 'Help')
    if (process.env.UNDO_HELP_SHOT) await page.locator('.scol').screenshot({ path: process.env.UNDO_HELP_SHOT })
  })

  test('Ctrl+F goes to the Mixer and focuses search', async () => {
    await page.keyboard.press('Control+f')
    await settle()
    assert.equal(await activeTab(), 'mixer')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'mx-rail-search')
  })

  test('keys typed in the search field are left alone (no ?, no Space shortcut)', async () => {
    await page.keyboard.type('a ?b')
    await settle()
    assert.equal(await settingsOpen(), false)
    assert.equal(await page.inputValue('#mx-rail-search'), 'a ?b')
    await page.fill('#mx-rail-search', '')
  })

  test('head Undo and Redo start disabled; Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y do nothing with empty history', async () => {
    const state = () => page.evaluate(() => ['#mx-undo', '#mx-redo'].map((s) => { const b = document.querySelector(s); return [b.disabled, b.title] }))
    assert.deepEqual(await state(), [[true, 'Nothing to undo'], [true, 'Nothing to redo']])
    if (process.env.UNDO_SHOT) await page.locator('.mx-head').screenshot({ path: process.env.UNDO_SHOT })
    await page.locator('#tab-content').click({ position: { x: 5, y: 5 } })
    for (const k of ['Control+z', 'Control+Shift+z', 'Control+y']) await page.keyboard.press(k)
    await settle()
    assert.deepEqual(await state(), [[true, 'Nothing to undo'], [true, 'Nothing to redo']])
    assert.equal(await page.locator('.notify', { hasText: /Undid|Redid/ }).count(), 0)
  })

  test('Ctrl+Z in the search field stays the field\'s own undo (no history toast)', async () => {
    await page.focus('#mx-rail-search')
    await page.keyboard.type('abc')
    await page.keyboard.press('Control+z')
    await settle()
    assert.equal(await page.locator('.notify', { hasText: /Undid|Redid/ }).count(), 0)
    await page.fill('#mx-rail-search', '')
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
  test('sidebar lists Help and Advanced between Community plugins and Privacy', async () => {
    await page.keyboard.press('Control+,')
    await settle()
    const names = await page.locator('.subnav button').allInnerTexts()
    assert.deepEqual(names.slice(-5), ['Community plugins', 'Help', 'Advanced', 'Privacy', 'About'])
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

  test('About > Licenses opens a dialog listing the third-party software', async () => {
    await page.locator('.subnav button', { hasText: 'About' }).click()
    await page.locator('.settings-item', { hasText: 'Licenses' }).getByRole('button', { name: 'Open' }).click()
    const dialog = page.getByRole('dialog', { name: 'Licenses' })
    await dialog.waitFor()
    const text = await dialog.innerText()
    for (const name of ['FFmpeg', 'yt-dlp', 'Signalsmith Stretch']) assert.ok(text.includes(name), name)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await dialog.waitFor({ state: 'detached' })
  })
})
