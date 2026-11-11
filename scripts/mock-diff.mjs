// Compares the approved desktop mock with the running dev app, region by region:
// every visible control's label and icon, in order. Prints what is missing, extra
// or different. Run it before calling any redesign step done.
//
//   node scripts/mock-diff.mjs [--screen mixer] [--width 1280] [--only nav,player]
//
// Needs the dev app running with --remoteDebuggingPort 9222 (see CLAUDE.md) and
// Edge (the mock is opened in a throwaway headless Edge on port 9333).
// Icons are compared by their drawing (path data), not by name, so an old-app
// icon where the mock has a Phosphor one shows up as a difference.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i > -1 ? process.argv[i + 1] : fallback
}
const screen = arg('screen', 'mixer')
const width = Number(arg('width', 1280))
const only = arg('only', '')?.split(',').filter(Boolean)
const MOCK = 'C:/Users/jluca/Projects/Global Management/design-system/dist/tool/mock-noctivago-desktop.html'
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync)

// [name, mock selector, app selector]. Add a row when a step adds a region.
const REGIONS = [
  ['nav', '.nav', '.nav'],
  ['player', '.player', '.toolbar'],
  ['mixer toolbar', '.tools', '.sound-list-controls'],
  // Remix (step 11). Open the Remix tab and a sound in the app first; this
  // script only switches the mock's screen (remix, remix-empty, remix-random,
  // remix-scheduled).
  ['remix bar', '.rbar', '.rx-bar'],
  ['remix canvas', '.rcanvas', '.rx-canvas'],
  ['remix side', '.rside', '.rx-side'],
  // Browse Sounds (step 14). Open the Browse tab in the app in the matching
  // state first (browse = results with a preview playing, browse-first,
  // browse-fail).
  ['browse search', '.tools', '.bs-tools'],
  ['browse sources', '.tools.sub', '.bs-tools.bs-sub'],
  ['browse empty', '.empty', '.bs-empty:not(.hidden)'],
  ['browse card', '.tile.rcard', '.bs-tile'],
  ['browse preview', '.pvbar', '.bs-pvbar']
]

// Runs inside each page. Returns the visible controls in DOM order.
const COLLECT = `((sel) => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' }
  // Remix has one grid per scope (Sound, Group, Preset); take the one on screen.
  const all = [...document.querySelectorAll(sel)]
  const root = all.find(visible) || all[0]
  if (!root) return null
  const drawing = (svg) => {
    if (!svg) return null
    const use = svg.querySelector('use')
    const html = use ? document.getElementById(use.getAttribute('href').slice(1))?.innerHTML : svg.innerHTML
    const d = [...(html || '').matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join('|')
    return d || null
  }
  const text = (el) => {
    const clone = el.cloneNode(true)
    clone.querySelectorAll('svg').forEach((s) => s.remove())
    return clone.textContent.replace(/\\s+/g, ' ').trim()
  }
  const controls = [...root.querySelectorAll('button, select, input, a, [role=button]')].filter(visible)
  return controls.map((el) => ({
    kind: el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? ':' + el.type : ''),
    label: el.getAttribute('aria-label') || text(el) || el.getAttribute('placeholder') || el.title || '',
    title: el.title || '',
    icon: drawing(el.querySelector('svg')),
    box: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })()
  }))
})`
const SYMBOLS = `(() => Object.fromEntries([...document.querySelectorAll('symbol')].map((s) => [s.id.replace(/^i-/, ''), [...s.innerHTML.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join('|')])))()`

async function cdp(port, targetFilter) {
  let target
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find((t) => t.type === 'page' && targetFilter(t))
    } catch {}
    if (!target) await new Promise((r) => setTimeout(r, 250))
  }
  if (!target) throw new Error(`no page on port ${port}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const send = (method, params = {}) => new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description ?? ''))
    return r.result.result.value
  }
  return { send, evaluate, close: () => ws.close() }
}

async function main() {
  if (!EDGE) throw new Error('Edge not found')
  killMockEdge() // a leftover from a crashed run would answer on 9333
  const url = pathToFileURL(MOCK).href + `?screen=${screen}&width=${width}`
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9333', `--window-size=${width + 40},900`, '--user-data-dir=' + process.env.TEMP + '/mock-diff-edge', '--no-first-run', url], { stdio: 'ignore' })
  try {
    const mock = await cdp(9333, (t) => t.url.includes('mock-noctivago-desktop'))
    await new Promise((r) => setTimeout(r, 800))
    const app = await cdp(9222, () => true)
    await app.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 500))
    const symbols = await mock.evaluate(SYMBOLS)
    const nameOf = (d) => (d ? Object.keys(symbols).find((n) => symbols[n] === d) ?? 'NOT-A-MOCK-ICON' : '-')
    let problems = 0
    for (const [name, mockSel, appSel] of REGIONS) {
      if (only?.length && !only.includes(name)) continue
      const m = await mock.evaluate(`${COLLECT}(${JSON.stringify(mockSel)})`)
      const a = await app.evaluate(`${COLLECT}(${JSON.stringify(appSel)})`)
      if (!m && !a) continue // a region this screen does not have
      console.log(`\n== ${name} (mock ${mockSel} vs app ${appSel})`)
      if (!m || !a) { console.log(`  region missing: ${!m ? 'mock' : 'app'}`); problems++; continue }
      const norm = (x) => x.toLowerCase().replace(/…$/, '').replace(/s*d+ sounds? · saves as you go$/, '').trim()
      const same = (x, y) => norm(x) === norm(y)
      const used = new Set()
      for (const mc of m) {
        const j = a.findIndex((ac, i) => !used.has(i) && (same(ac.label, mc.label) || same(ac.title, mc.label) || (mc.icon && ac.icon === mc.icon && !mc.label)))
        if (j < 0) { console.log(`  MISSING in app: "${mc.label}" [${mc.kind}] icon ${nameOf(mc.icon)}`); problems++; continue }
        used.add(j)
        const ac = a[j]
        const notes = []
        if (mc.icon !== ac.icon) notes.push(`icon: mock ${nameOf(mc.icon)}, app ${nameOf(ac.icon)}`)
        if (mc.kind !== 'input:range' && Math.abs(mc.box[1] - ac.box[1]) > 2) notes.push(`height: mock ${mc.box[1]}, app ${ac.box[1]}`)
        if (notes.length) { console.log(`  DIFF "${mc.label}": ${notes.join('; ')}`); problems++ }
      }
      a.forEach((ac, i) => { if (!used.has(i)) console.log(`  EXTRA in app (mock lacks it): "${ac.label || ac.title}" [${ac.kind}]`) })
      if (!problems) console.log('  matches')
    }
    console.log(`\n${problems} difference(s) from the mock`)
    await app.send('Emulation.clearDeviceMetricsOverride')
    mock.close(); app.close()
    process.exitCode = problems ? 1 : 0
  } finally {
    edge.kill()
    killMockEdge()
  }
}

// edge.kill() only ends the launcher; the headless browser lives on and the
// next run would read its old screen. End every process on our profile.
function killMockEdge() {
  spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*mock-diff-edge*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
}
main().catch((e) => { console.error(e.message); process.exit(2) })
