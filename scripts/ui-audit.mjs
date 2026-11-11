// Desktop 2.0 step 19: shoots every tab and Settings page of the running dev
// app at 480, 800 and 1280 wide and checks what a script can check:
// sideways overflow, controls with no name, targets under 24 px (WCAG 2.2
// AA 2.5.8) and text under 4.5:1 contrast (3:1 for 18 px+ or 14 px bold).
// Start the app with: npm run dev -- --remoteDebuggingPort 9222
// Usage: node scripts/ui-audit.mjs <out-dir> [--widths 480,800,1280] [--only mixer,export] [--port 9222]
// Writes <out-dir>/<screen>-<width>.png, report.json and contact.html.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const out = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'))
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
if (!out) throw new Error('Usage: node scripts/ui-audit.mjs <out-dir> [--widths 480,800,1280] [--only ids] [--port 9222]')
const widths = opt('widths', '480,800,1280').split(',').map(Number)
const only = opt('only', '')?.split(',').filter(Boolean)
const port = Number(opt('port', 9222))
const HEIGHT = 900

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) throw new Error('No page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket failed')) })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const t = setTimeout(() => { pending.delete(n); reject(new Error(method + ' timed out')) }, 20000)
    pending.set(n, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  return { send, evaluate, close: () => ws.close() }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Runs in the page. Returns problems on the visible tab panel (or overlay).
const CHECK = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05 && r.bottom > 0 && r.top < innerHeight }
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || (el.id && document.querySelector('label[for="' + el.id + '"]')?.textContent) || el.closest('label')?.textContent || '').trim()
  const where = (el) => { const t = el.closest('[data-tab-id]')?.dataset.tabId || ''; const c = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''; return t + ' ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + c }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const rgba = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.5) return c } return [17, 17, 20, 1] }
  const scope = [...document.querySelectorAll('.modal-overlay, [role=dialog]')].find((d) => visible(d) && getComputedStyle(d).position === 'fixed') || document.querySelector('.tab-panel:not(.hidden)') || document.body
  const problems = { overflow: [], unnamed: [], small: [], contrast: [] }
  const se = document.scrollingElement
  if (se.scrollWidth > se.clientWidth + 1) problems.overflow.push('page scrolls sideways: ' + se.scrollWidth + ' > ' + se.clientWidth)
  for (const el of scope.querySelectorAll('*')) {
    if (!visible(el)) continue
    const s = getComputedStyle(el)
    if ((s.overflowX === 'visible') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && el.children.length && !['svg', 'SVG'].includes(el.tagName)) {
      const r = el.getBoundingClientRect()
      if (r.right > innerWidth + 1) problems.overflow.push(where(el) + ' runs past the window (' + Math.round(r.right) + ' > ' + innerWidth + ')')
    }
  }
  for (const el of scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=tab]')) {
    if (!visible(el) || el.disabled) continue
    if (!name(el)) problems.unnamed.push(where(el))
    const r = el.getBoundingClientRect()
    if ((r.width < 24 || r.height < 24) && !['checkbox', 'radio', 'range'].includes(el.type) && !el.closest('p, li, .notify-message')) problems.small.push(where(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  for (const el of scope.querySelectorAll('*')) {
    if (!visible(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own) continue
    const s = getComputedStyle(el)
    if (el.closest('button:disabled, [aria-disabled=true], input:disabled, select:disabled')) continue
    const fg = rgba(s.color); if (!fg) continue
    const bg = bgOf(el)
    const a = fg[3] * parseFloat(s.opacity || 1)
    const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a))
    const L1 = lum(mix), L2 = lum(bg.slice(0, 3))
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
    if (ratio < need) problems.contrast.push(where(el) + ' "' + el.textContent.trim().slice(0, 30) + '" ' + ratio.toFixed(2) + ':1')
  }
  for (const k of Object.keys(problems)) problems[k] = [...new Set(problems[k])]
  return problems
})()`

async function main() {
  await mkdir(out, { recursive: true })
  const cdp = await connect()
  const screens = await cdp.evaluate(`[...document.querySelectorAll('.tab-button[data-tab-id]')].map(b => b.dataset.tabId)`)
  const settingsPages = ['General', 'Library', 'Core plugins', 'Community plugins', 'Privacy', 'About']
  const list = [...screens.map((id) => ({ id, go: `document.querySelector('.tab-button[data-tab-id="${id}"]').click()` })),
    ...settingsPages.map((p) => ({ id: 'settings-' + p.toLowerCase().replace(/ /g, '-'), go: `(async () => { const s = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Settings' && !b.closest('.tab-panel')); if (!document.querySelector('.tab-panel[data-tab-id=settings]:not(.hidden)')) s?.click(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('.tab-panel[data-tab-id=settings] button, .tab-panel[data-tab-id=settings] a')].find(b => b.textContent.trim() === ${JSON.stringify(p)})?.click() })()` }))]
    .filter((s) => !only?.length || only.includes(s.id))
  const report = []
  for (const s of list) {
    for (const width of widths) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
      await cdp.evaluate(s.go)
      await wait(700)
      const problems = await cdp.evaluate(CHECK)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const file = `${s.id}-${width}.png`
      await writeFile(path.join(out, file), Buffer.from(shot.data, 'base64'))
      report.push({ screen: s.id, width, file, problems })
      const n = Object.values(problems).reduce((a, v) => a + v.length, 0)
      console.log(`${s.id} @${width}: ${n ? Object.entries(problems).filter(([, v]) => v.length).map(([k, v]) => k + ' ' + v.length).join(', ') : 'clean'}`)
    }
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  cdp.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const rows = [...new Set(report.map((r) => r.screen))].map((screen) => `<section><h2>${screen}</h2><div class="row">${report.filter((r) => r.screen === screen).map((r) => `<figure><a href="${r.file}"><img src="${r.file}" loading="lazy" style="width:${Math.round(r.width / 3.2)}px"></a><figcaption>${r.width} px${Object.entries(r.problems).filter(([, v]) => v.length).map(([k, v]) => `<details><summary>${k} ${v.length}</summary><ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}</figcaption></figure>`).join('')}</div></section>`).join('')
  await writeFile(path.join(out, 'contact.html'), `<!doctype html><meta charset="utf-8"><title>Noctivago contact sheet</title><style>body{background:#111114;color:#e8e8ea;font:13px system-ui;margin:16px}h2{font-size:14px;margin:24px 0 8px}.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}img{display:block;border-radius:8px;border:1px solid #2a2a30}figcaption{margin-top:4px;color:#a0a0a8;max-width:400px}summary{cursor:pointer}ul{margin:4px 0;padding-left:16px}</style><h1>Noctivago 2.0 dev build: every screen at ${widths.join(', ')} px</h1>${rows}`)
  console.log('wrote', path.join(out, 'contact.html'))
}
main().catch((e) => { console.error(e.message); process.exit(1) })
