import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDevToolsShortcut } from '../src/shared/devToolsShortcut.js'

const press = (over) => ({ type: 'keyDown', control: true, shift: true, alt: false, meta: false, key: 'I', ...over })

test('Ctrl+Shift+I matches, upper or lower case', () => {
  assert.equal(isDevToolsShortcut(press()), true)
  assert.equal(isDevToolsShortcut(press({ key: 'i' })), true)
})

test('anything else does not', () => {
  assert.equal(isDevToolsShortcut(press({ shift: false })), false)
  assert.equal(isDevToolsShortcut(press({ control: false })), false)
  assert.equal(isDevToolsShortcut(press({ alt: true })), false)
  assert.equal(isDevToolsShortcut(press({ key: 'J' })), false)
  assert.equal(isDevToolsShortcut(press({ type: 'keyUp' })), false)
})
