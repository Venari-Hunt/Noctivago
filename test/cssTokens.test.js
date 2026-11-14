// Renderer CSS uses tokens (scripts/css-lint.mjs). The baseline holds the raw
// values that were there on 2026-11-14; only a new one fails. Fixing one:
// lower or drop its count in test/fixtures/css-lint-baseline.json.
// Regenerate: CSS_LINT_UPDATE=1 node --test test/cssTokens.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CSS_FILE, lintCss, lintKey, declarations } from '../scripts/css-lint.mjs'

const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'css-lint-baseline.json')

const count = (findings) => {
  const c = {}
  for (const f of findings) c[lintKey(f)] = (c[lintKey(f)] ?? 0) + 1
  return c
}

test('the lint reads rules and flags raw values, not tokens', () => {
  const css = ':root { --a: #fff; } .x { color: #abc; padding: 8px var(--space-2); border-radius: 50%; margin: 0 1px; } @media (max-width: 1px) { .y { gap: 6px; } }'
  assert.equal(declarations(css).length, 5)
  assert.deepEqual(lintCss(css).map(lintKey), ['raw-color | .x | color | #abc', 'raw-spacing | .x | padding | 8px', 'raw-spacing | .y | gap | 6px'])
})

test('no new raw colors, spacing or radii in the renderer CSS', () => {
  const now = count(lintCss(fs.readFileSync(CSS_FILE, 'utf8')))
  if (process.env.CSS_LINT_UPDATE === '1' || !fs.existsSync(BASELINE)) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
    fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(now).sort()), null, 2) + '\n')
    return
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const fresh = Object.entries(now).filter(([k, n]) => n > (base[k] ?? 0)).map(([k, n]) => `${k} (${n}, baseline ${base[k] ?? 0})`)
  assert.deepEqual(fresh, [], 'use a token from :root (colors, --space-*, --radius*) instead of a raw value')
})
