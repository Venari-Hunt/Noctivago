// Windows draws min/max/close in titleBarOverlay's colors (src/main/index.js),
// over the page's own title bar (main.css). Main can't read CSS, so this keeps
// the two in step (owner, 2026-11-17: the buttons sat on a darker block).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/renderer/styles/main.css', import.meta.url), 'utf8')

const token = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase()

test('window buttons use the title bar colors', () => {
  const overlay = main.match(/titleBarOverlay:\s*\{\s*color:\s*'([^']+)',\s*symbolColor:\s*'([^']+)'/)
  assert.ok(overlay, 'titleBarOverlay not found in src/main/index.js')
  assert.equal(overlay[1].toLowerCase(), token('bg'), 'overlay color = --bg')
  assert.equal(overlay[2].toLowerCase(), token('text-dim'), 'symbolColor = --text-dim')
})
