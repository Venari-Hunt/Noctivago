// Desktop 2.0 step 19: shoots every tab and Settings page of the running dev
// app at 480, 800 and 1280 wide and checks what a script can check:
// the checks in scripts/ui-audit-checks.mjs (overflow, names, targets,
// contrast, grid, radius, type, color, overlap, clipped text).
// Start the app with: npm run dev -- --remoteDebuggingPort 9222
// Usage: node scripts/ui-audit.mjs <out-dir> [--widths 480,800,1280] [--only mixer,export] [--port 9222]
// Writes <out-dir>/<screen>-<width>.png, report.json and contact.html.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CHECK } from './ui-audit-checks.mjs'

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
      const { findings } = await cdp.evaluate(CHECK)
      const problems = {}
      for (const f of findings) (problems[f.check] ??= []).push(f.where + (f.detail ? ' ' + f.detail : ''))
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
