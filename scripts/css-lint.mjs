// Token lint for the renderer CSS (app-wide visual audit, owner 2026-11-14):
// flags a raw hex color, or a raw px padding, margin, gap or radius, in a rule
// that is not a token definition. Colors belong in :root tokens; spacing in
// --space-*; radii in --radius*. test/cssTokens.test.js runs it in CI against
// test/fixtures/css-lint-baseline.json, so only a NEW raw value fails.
// Usage: node scripts/css-lint.mjs [file.css] (prints every finding).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CSS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'styles', 'main.css')

const SPACING = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/
const RADIUS = /^border(-(top|bottom)-(left|right))?-radius$/
const HEX = /#[0-9a-fA-F]{3,8}\b/

// Px values in a spacing or radius declaration: 0, 1px and 2px hairlines,
// percentages and var() are fine.
function rawPx(value) {
  const noVars = value.replace(/var\([^)]*\)/g, '')
  return (noVars.match(/-?\d*\.?\d+px/g) ?? []).filter((v) => !['0px', '1px', '2px', '-1px'].includes(v))
}

// Splits CSS into { selector, prop, value } declarations (comments dropped,
// @media blocks flattened, :root and other token-only rules skipped).
export function declarations(css) {
  const out = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) {
    const selector = m[1].trim().replace(/^@media[^{]*\{?/, '').replace(/\s+/g, ' ').trim()
    if (!selector || selector.startsWith('@') || /(^|,)\s*(:root|html)\b/.test(selector) || /^\d+%$|^(from|to)$/.test(selector)) continue
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':')
      if (i < 0) continue
      const prop = part.slice(0, i).trim()
      const value = part.slice(i + 1).trim()
      if (!prop || prop.startsWith('--')) continue
      out.push({ selector, prop, value })
    }
  }
  return out
}

export function lintCss(css) {
  const findings = []
  for (const d of declarations(css)) {
    const hex = d.value.match(HEX)
    if (hex) findings.push({ ...d, rule: 'raw-color', raw: hex[0].toLowerCase() })
    if (SPACING.test(d.prop) || RADIUS.test(d.prop)) for (const px of rawPx(d.value)) findings.push({ ...d, rule: RADIUS.test(d.prop) ? 'raw-radius' : 'raw-spacing', raw: px })
  }
  return findings
}

export const lintKey = (f) => `${f.rule} | ${f.selector} | ${f.prop} | ${f.raw}`

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2] ?? CSS_FILE
  const found = lintCss(fs.readFileSync(file, 'utf8'))
  for (const f of found) console.log(lintKey(f))
  console.log(`${found.length} findings`)
}
