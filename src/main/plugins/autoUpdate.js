import { getPlugins } from './registry.js'
import { listCatalog, checkLatest, install } from './store.js'
import { canInstallFromStore } from '../../shared/pluginEnablement.js'
import { getSettings } from '../settings.js'

// Keeps installed plugins current without being asked (Settings > Community
// plugins > "Update plugins automatically", on by default). Checks a little
// after launch, then every few hours since the app often runs all night.
// Only downloads and swaps the plugin's folder; the main window then swaps
// the running plugin in live once it's idle (renderer/core/PluginLoader.js),
// and says so with an in-app notification, because nothing here asks first.
const FIRST_CHECK_MS = 20 * 1000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let mainWindow = null
let timer = null
let running = null

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

// Returns { updated: [{ id, name, from, to }], failed: [{ id, name, error }] }.
// Plugins not in the store list (hand-dropped folders, dev fixtures) and ones
// Restricted mode would refuse are skipped.
export async function updateInstalledPlugins() {
  const { plugins: listed } = await listCatalog()
  const byId = new Map(listed.map((p) => [p.id, p]))
  const { restrictedMode } = getSettings()
  const updated = []
  const failed = []
  for (const plugin of getPlugins()) {
    const entry = byId.get(plugin.id)
    if (plugin.source !== 'user' || !entry) continue
    if (!canInstallFromStore(entry.repo, { restrictedMode })) continue
    const from = plugin.manifest.version
    try {
      const latest = await checkLatest(plugin.id)
      if (!latest.updateAvailable) continue
      const { version } = await install(plugin.id)
      updated.push({ id: plugin.id, name: entry.name, from, to: version })
    } catch (err) {
      failed.push({ id: plugin.id, name: entry.name, error: err.message })
    }
  }
  return { updated, failed }
}

async function check() {
  if (!getSettings().autoUpdatePlugins) return
  try {
    const result = await updateInstalledPlugins()
    if (result.updated.length || result.failed.length) send('plugins:autoUpdated', result)
  } catch (err) {
    // Offline or the list is unreachable: say nothing, try again next time.
    console.error('Plugin auto-update check failed', err)
  }
}

function runCheck() {
  if (!running) running = check().finally(() => (running = null))
  return running
}

export function initPluginAutoUpdate(win) {
  mainWindow = win
  clearTimeout(timer)
  timer = setTimeout(function tick() {
    runCheck()
    timer = setTimeout(tick, CHECK_EVERY_MS)
  }, FIRST_CHECK_MS)
}

// Tell the main window the plugin folders changed outside its own actions
// (the startup migration finishing late), so it re-syncs.
export function notifyPluginsChanged(payload = {}) {
  send('plugins:changed', payload)
}
