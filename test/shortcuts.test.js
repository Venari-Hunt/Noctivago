import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { matchShortcut, SHORTCUTS } from '../src/renderer/core/shortcuts.js'

const ev = (key, o = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o })

describe('matchShortcut', () => {
  test('Space plays, but not in a field, on a button, or over a dialog', () => {
    assert.deepEqual(matchShortcut(ev(' ')), { id: 'play' })
    assert.equal(matchShortcut(ev(' '), { typing: true }), null)
    assert.equal(matchShortcut(ev(' '), { onControl: true }), null)
    assert.equal(matchShortcut(ev(' '), { modalOpen: true }), null)
  })
  test('Ctrl combos', () => {
    assert.deepEqual(matchShortcut(ev('f', { ctrlKey: true })), { id: 'search' })
    assert.deepEqual(matchShortcut(ev('S', { ctrlKey: true })), { id: 'save' })
    assert.deepEqual(matchShortcut(ev(',', { ctrlKey: true })), { id: 'settings' })
    assert.deepEqual(matchShortcut(ev('3', { ctrlKey: true })), { id: 'tab', tab: 2 })
    assert.equal(matchShortcut(ev('z', { ctrlKey: true })), null)
  })
  test('F11 and ?', () => {
    assert.deepEqual(matchShortcut(ev('F11'), { typing: true }), { id: 'fullscreen' })
    assert.deepEqual(matchShortcut(ev('?')), { id: 'help' })
    assert.equal(matchShortcut(ev('?'), { typing: true }), null)
  })
  test('Ctrl+M is the Remix marker key', () => {
    assert.deepEqual(matchShortcut(ev('m', { ctrlKey: true })), { id: 'marker' })
  })
  test('every listed shortcut has a title and keys', () => {
    for (const s of SHORTCUTS) assert.ok(s.title && s.keys.length)
  })
})
