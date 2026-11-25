// End-to-end: a Mixer card's ring lights in 220 ms and goes dark in 170 ms (micro-interactions mock,
// row "Sound in or out of the mix"); its length never animates, so dragging the knob stays direct.
// Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './launch.mjs'

let app
let page

before(async () => {
  app = await launchApp()
  page = app.page
})
after(() => app?.close())

// A card shaped like the Mixer's, built in the real page so the real stylesheet applies.
const timing = (on) =>
  page.evaluate((on) => {
    const li = document.createElement('li')
    li.className = 'sound-row' + (on ? ' sound-row-on' : '')
    li.innerHTML = '<svg><circle class="knob-value"/></svg><span class="sound-row-name">x</span>'
    document.querySelector('.sound-list, #sound-list, body').appendChild(li)
    const s = getComputedStyle(li.querySelector('.knob-value'))
    const out = { property: s.transitionProperty, duration: s.transitionDuration }
    li.remove()
    return out
  }, on)

describe('Mixer card in/out of the mix', () => {
  test('ring lights in 220 ms', async () => {
    const t = await timing(true)
    assert.match(t.property, /stroke/)
    assert.match(t.duration, /0\.22s/)
  })

  test('ring goes dark in 170 ms, and its length never animates', async () => {
    const t = await timing(false)
    assert.match(t.duration, /0\.17s/)
    assert.doesNotMatch(t.property, /dasharray|all/)
  })
})
