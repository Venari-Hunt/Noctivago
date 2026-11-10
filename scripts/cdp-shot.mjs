// Screenshot the running dev app over the Chrome DevTools Protocol.
// Start the app with: npm run dev -- --remoteDebuggingPort 9222
// Usage: node scripts/cdp-shot.mjs <out.png> [--width 1280] [--height 800] [--eval "<js>"] [--port 9222]
// --eval runs in the page first (awaited if it returns a promise), e.g. to switch tabs.
import { writeFile } from 'node:fs/promises'

function parseArgs(argv) {
  const opts = { out: null, width: 1280, height: 800, evalJs: null, port: 9222 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--width') opts.width = Number(argv[++i])
    else if (a === '--height') opts.height = Number(argv[++i])
    else if (a === '--eval') opts.evalJs = argv[++i]
    else if (a === '--port') opts.port = Number(argv[++i])
    else if (!opts.out) opts.out = a
    else throw new Error(`Unknown argument: ${a}`)
  }
  if (!opts.out) throw new Error('Usage: node scripts/cdp-shot.mjs <out.png> [--width N] [--height N] [--eval js] [--port N]')
  if (!(opts.width > 0 && opts.height > 0)) throw new Error('--width and --height must be positive numbers')
  return opts
}

async function findPage(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json`).catch(() => null)
  if (!res) throw new Error(`No DevTools on port ${port}. Is the dev app running with --remoteDebuggingPort ${port}?`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) throw new Error('No page target found')
  return page
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`))
    else p.resolve(msg.result)
  })
  const send = (method, params = {}, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs} ms (window minimized or hidden?)`))
      }, timeoutMs)
      pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e))
      })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ send, close: () => ws.close() }))
    ws.addEventListener('error', () => reject(new Error(`WebSocket failed: ${wsUrl}`)))
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const page = await findPage(opts.port)
  const cdp = await connect(page.webSocketDebuggerUrl)
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false
    })
    if (opts.evalJs) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: opts.evalJs,
        awaitPromise: true,
        returnByValue: true
      })
      if (r.exceptionDetails) throw new Error(`--eval threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    }
    // Let layout and any transition settle after the resize.
    await new Promise((r) => setTimeout(r, 400))
    await cdp.send('Page.bringToFront').catch(() => {})
    // captureBeyondViewport forces a fresh frame, which a hidden (tray) window never paints on its own.
    // Still flaky while hidden, so try a few times.
    let shot
    for (let attempt = 1; !shot; attempt++) {
      try {
        shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 8000)
      } catch (err) {
        if (attempt >= 3) throw err
      }
    }
    await writeFile(opts.out, Buffer.from(shot.data, 'base64'))
    console.log(`${opts.out} (${opts.width}x${opts.height})`)
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    cdp.close()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
