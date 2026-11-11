// Launches the built app (npm run build first) on a throwaway profile so the
// owner's library is never touched, and drives it over the DevTools port
// (the same way scripts/cdp-shot.mjs does). Muted: no sound during tests.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function waitForPort(port, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('app did not open its DevTools port')
}

// Copies a local plugin build (../noctivago-plugin-repos/noctivago-<id>, built
// with npm run build) into the profile, as scripts/dev-plugin.mjs does.
function installPlugin(profile, id) {
  const src = path.join(root, '..', 'noctivago-plugin-repos', `noctivago-${id}`)
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
  const dest = path.join(process.env.APPDATA, profile, 'plugins', id)
  fs.mkdirSync(dest, { recursive: true })
  for (const f of new Set(['manifest.json', manifest.main, manifest.styles].filter(Boolean))) fs.copyFileSync(path.join(src, f), path.join(dest, f))
  fs.writeFileSync(path.join(dest, '.origin.json'), JSON.stringify({ repo: `Venari-Hunt/noctivago-${id}` }))
}

export async function launchApp({ plugins = [] } = {}) {
  const port = 9300 + (process.pid % 500)
  const profile = `noctivago-e2e-${process.pid}`
  for (const id of plugins) installPlugin(profile, id)
  const electronPath = createRequire(root + '/package.json')('electron')
  const child = spawn(electronPath, [root, `--remote-debugging-port=${port}`, '--mute-audio'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NOCTIVAGO_PROFILE: profile },
    stdio: ['ignore', 'inherit', 'inherit']
  })
  await waitForPort(port)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('index.html')) ?? browser.contexts()[0].pages()[0]
  await page.waitForSelector('#tab-bar .tab-button')
  return {
    page,
    async close() {
      await browser.close().catch(() => {})
      child.kill()
      await new Promise((r) => setTimeout(r, 500))
      fs.rmSync(path.join(process.env.APPDATA || os.homedir(), profile), { recursive: true, force: true })
    }
  }
}
