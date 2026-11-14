// The page-side checks shared by scripts/ui-audit.mjs (CDP, running dev app) and
// e2e/ui-audit.e2e.mjs (the app-wide audit with a baseline; owner, 2026-11-14:
// "can this be done app-wide, to avoid inconsistencies and weird stuff").
// CHECK is an expression evaluated in the renderer. It returns the visible
// screen's findings and the sizes of every control, so the caller can also
// check "same component, same size" across screens.
//
// Checks (each finding: { check, where, detail }):
//   overflow   the page or a block runs past the window sideways
//   unnamed    a control has no accessible name
//   small      a target under 24 x 24 px (WCAG 2.2 AA 2.5.8)
//   contrast   text under 4.5:1 (3:1 for large text)
//   grid       a control's height (and an icon-only control's width) is not a multiple of 4 px
//   radius     a corner radius outside the app's set
//   type       a font size outside the app's type scale
//   color      a text, fill or border color that is not a token
//   overlap    two controls cover each other
//   clipped    text cut off with no ellipsis and no tooltip
// "where" holds no numbers, so a finding keeps its identity across runs;
// "detail" holds the numbers.

// The app's sets (src/renderer/styles/main.css :root and the 2.0 mock).
export const RADII = [0, 4, 6, 8, 10, 12, 999]
// 15 is the approved Mixer and Remix mocks' pane heading size.
export const TYPE_SCALE = [11, 12, 13, 14, 15, 16, 20, 28]

export const CHECK = `(() => {
  const RADII = ${JSON.stringify(RADII)}, TYPE = ${JSON.stringify(TYPE_SCALE)}
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05 && r.bottom > 0 && r.top < innerHeight }
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || (el.id && document.querySelector('label[for="' + el.id + '"]')?.textContent) || el.closest('label')?.textContent || '').trim()
  const cls = (el) => (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/).filter((c) => !/active|hover|selected|current|open|playing|hidden|on$|off$|solo|muted|shot|hl$/.test(c)).slice(0, 2).join('.') : ''
  const allCls = (el) => (el.className && typeof el.className === 'string') ? el.className.trim().split(/s+/).filter((c) => !/active|hover|selected|current|open|playing|hidden|on$|off$|solo|muted|shot|hl$/.test(c)).sort().join('.') : ''
  const where = (el) => { const t = el.closest('[data-tab-id]')?.dataset.tabId || el.closest('[role=dialog], .modal-overlay, .modal') && 'dialog' || ''; const c = cls(el); return (t + ' ' + el.tagName.toLowerCase() + (el.id && !/\\d{3,}/.test(el.id) ? '#' + el.id : '') + (c ? '.' + c : '')).trim() }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const rgba = (s) => { const m = s && s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.5) return c } return [17, 17, 20, 1] }
  // Token colors: every --var on :root that resolves to a color, plus white, black and the plugin tokens.
  const probe = document.createElement('i'); document.body.appendChild(probe)
  const tokens = new Set(['255,255,255', '0,0,0'])
  const rootStyle = getComputedStyle(document.documentElement)
  // Computed custom properties on :root (plugin sheets load cross-origin, so their rules are not readable).
  const names = new Set([...rootStyle].filter((p) => p.startsWith('--')))
  for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules } catch { continue } for (const r of rules) if (r.selectorText === ':root' || r.selectorText === 'html') for (const p of r.style) if (p.startsWith('--')) names.add(p) }
  for (const p of names) { probe.style.color = ''; probe.style.color = 'var(' + p + ')'; const c = rgba(getComputedStyle(probe).color); if (c && probe.style.color) tokens.add(c.slice(0, 3).join(',')) }
  probe.remove()
  const isToken = (c) => !c || c[3] === 0 || tokens.has(c.slice(0, 3).join(','))
  const scope = [...document.querySelectorAll('.modal-overlay, [role=dialog], .modal:not(.hidden)')].find((d) => visible(d) && getComputedStyle(d).position === 'fixed') || document.querySelector('.tab-panel:not(.hidden)') || document.body
  const out = []
  const add = (check, el, detail = '') => out.push({ check, where: typeof el === 'string' ? el : where(el), detail })
  const se = document.scrollingElement
  if (se.scrollWidth > se.clientWidth + 1) add('overflow', 'page', se.scrollWidth + ' > ' + se.clientWidth)
  const all = [...scope.querySelectorAll('*')].filter(visible)
  for (const el of all) {
    const s = getComputedStyle(el)
    if (s.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && el.children.length && el.tagName !== 'svg') {
      const r = el.getBoundingClientRect()
      if (r.right > innerWidth + 1) add('overflow', el, Math.round(r.right) + ' > ' + innerWidth)
    }
    const rad = parseFloat(s.borderTopLeftRadius)
    if (rad && !s.borderTopLeftRadius.includes('%')) { const r = el.getBoundingClientRect(); const pill = rad >= Math.min(r.width, r.height) / 2 - 0.5; if (!pill && !RADII.includes(Math.round(rad))) add('radius', el, Math.round(rad) + 'px') }
    if (el.closest('svg')) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    for (const [prop, on] of [['color', own], ['backgroundColor', true], ['borderTopColor', parseFloat(s.borderTopWidth) > 0]]) {
      if (!on) continue
      const c = rgba(s[prop]); if (!isToken(c)) add('color', el, prop + ' rgb(' + c.slice(0, 3).join(',') + ')')
    }
    if (!own) continue
    const fs = parseFloat(s.fontSize)
    if (!TYPE.includes(Math.round(fs * 2) / 2)) add('type', el, fs + 'px')
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis' && !el.title && !el.closest('[title]')) add('clipped', el, el.textContent.trim().slice(0, 30))
    if (el.closest('button:disabled, [aria-disabled=true], input:disabled, select:disabled')) continue
    const fg = rgba(s.color); if (!fg) continue
    const bg = bgOf(el)
    const a = fg[3] * parseFloat(s.opacity || 1)
    const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a))
    const L1 = lum(mix), L2 = lum(bg.slice(0, 3))
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    const bold = parseInt(s.fontWeight) >= 700
    const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : 4.5
    if (ratio < need) add('contrast', el, '"' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2) + ':1')
  }
  const controls = [...scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=tab], [role=slider]')].filter((el) => visible(el))
  const sizes = []
  for (const el of controls) {
    const r = el.getBoundingClientRect()
    const inline = el.closest('p, li, .notify-message')
    if (!el.disabled && !name(el)) add('unnamed', el)
    if ((r.width < 24 || r.height < 24) && !['checkbox', 'radio', 'range'].includes(el.type) && !inline) add('small', el, Math.round(r.width) + 'x' + Math.round(r.height))
    const w = Math.round(r.width), h = Math.round(r.height)
    // Heights sit on the grid; widths too for icon-only controls (a text button or a stretched field sizes to its content or row).
    const iconOnly = !el.textContent.trim() && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
    if (!inline && !['checkbox', 'radio', 'range'].includes(el.type) && (h % 4 || (iconOnly && w % 4))) add('grid', el, w + 'x' + h)
    const s = getComputedStyle(el)
    // A control inside a segmented pair or group is its own kind (its corners and size follow the group).
    const group = (el.parentElement?.className && typeof el.parentElement.className === 'string' && el.parentElement.className.split(/s+/).find((c) => /pair|seg|group|acts/.test(c))) || ''
    if (cls(el) && !inline) sizes.push({ kind: (group ? '.' + group + ' > ' : '') + el.tagName.toLowerCase() + '.' + allCls(el), h, radius: Math.round(parseFloat(s.borderTopLeftRadius) || 0), font: parseFloat(s.fontSize) })
  }
  for (let i = 0; i < controls.length; i++) {
    const a = controls[i].getBoundingClientRect()
    for (let j = i + 1; j < controls.length; j++) {
      const A = controls[i], B = controls[j]
      if (A.contains(B) || B.contains(A)) continue
      const b = B.getBoundingClientRect()
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (x > 4 && y > 4) add('overlap', where(A) + ' / ' + where(B), Math.round(x) + 'x' + Math.round(y))
    }
  }
  const seen = new Set()
  const findings = out.filter((f) => { const k = f.check + '|' + f.where; if (seen.has(k)) return false; seen.add(k); return true })
  return { findings, sizes }
})()`

// "Same component, same size": a control kind (tag + first classes) seen at
// more than one height, radius or font size across all screens.
export function inconsistencies(screens) {
  const by = new Map()
  for (const { screen, sizes } of screens) {
    for (const s of sizes) {
      const k = by.get(s.kind) ?? { h: new Map(), radius: new Map(), font: new Map() }
      for (const p of ['h', 'radius', 'font']) {
        const v = s[p]
        if (!k[p].has(v)) k[p].set(v, screen)
      }
      by.set(s.kind, k)
    }
  }
  const out = []
  for (const [kind, k] of by) {
    for (const p of ['h', 'radius', 'font']) {
      // In a segmented group the corners follow the position (first, middle, last).
      if (p === 'radius' && kind.includes(' > ')) continue
      if (k[p].size > 1) out.push({ check: 'inconsistent', where: `${kind} ${p === 'h' ? 'height' : p}`, detail: [...k[p]].map(([v, s]) => `${v} (${s})`).join(', ') })
    }
  }
  return out
}

export const findingKey = (screen, f) => `${screen} | ${f.check} | ${f.where}`
