// End-to-end: every <select> opens the styled menu (core/selectMenu.js), not the native popup.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './launch.mjs'

let app
let page
const settle = () => page.waitForTimeout(150)
const menuLabels = () => page.evaluate(() => [...document.querySelectorAll('.select-menu .select-menu-label')].map((n) => n.textContent))
const menuOpen = () => page.evaluate(() => !!document.querySelector('.select-menu'))

before(async () => {
  app = await launchApp()
  page = app.page
})
after(() => app?.close())

describe('styled select menu', () => {
  test('click opens it with icons, a tick on the current option and the select keeps focus', async () => {
    await page.locator('#mx-sort').click()
    await settle()
    assert.equal(await menuOpen(), true)
    assert.ok((await menuLabels()).includes('Loudest first'))
    assert.ok((await page.locator('.select-menu .select-menu-icon svg').count()) >= 3)
    assert.equal(await page.locator('.select-menu .select-menu-tick svg').count(), 1)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'mx-sort')
  })

  test('arrows + Enter change the value and fire change; Esc closes without changing', async () => {
    await page.evaluate(() => {
      window.__changes = 0
      document.querySelector('#mx-sort').addEventListener('change', () => window.__changes++)
    })
    const before = await page.inputValue('#mx-sort')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await settle()
    assert.equal(await menuOpen(), false)
    assert.notEqual(await page.inputValue('#mx-sort'), before)
    assert.equal(await page.evaluate(() => window.__changes), 1)
    const now = await page.inputValue('#mx-sort')
    await page.keyboard.press('Enter') // closed select + Enter opens it
    await settle()
    assert.equal(await menuOpen(), true)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await settle()
    assert.equal(await menuOpen(), false)
    assert.equal(await page.inputValue('#mx-sort'), now)
  })

  test('type-ahead jumps to a label; clicking an option and clicking outside work', async () => {
    await page.keyboard.press('Enter')
    await settle()
    await page.keyboard.type('Loudest')
    await page.keyboard.press('Enter')
    await settle()
    assert.equal(await page.inputValue('#mx-sort'), 'loudest')
    await page.locator('#mx-sort').click()
    await settle()
    await page.locator('.select-menu-item', { hasText: 'Name (A-Z)' }).click()
    await settle()
    assert.equal(await page.inputValue('#mx-sort'), 'name')
    await page.locator('#mx-sort').click()
    await settle()
    await page.mouse.click(5, 5)
    await settle()
    assert.equal(await menuOpen(), false)
  })
})
