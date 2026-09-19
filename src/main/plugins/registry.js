import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../../shared/pluginManifest.js'
import { pluginKind, pluginLoadState, isOfficialRepo } from '../../shared/pluginEnablement.js'
import { getSettings } from '../settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Written by the plugin store next to an installed plugin's manifest:
// { repo } - the GitHub repo it came from, which decides whether it counts
// as official under Restricted mode. A hand-dropped folder has none.
export const ORIGIN_FILE = '.origin.json'

// The app ships no plugins: the official ones are downloads from their own
// repos (see shared/officialPlugins.js). A dev build also loads the test
// fixtures in the repo's dev-plugins/ folder (hello-world, and
// broken-plugin-example, which proves a plugin that throws can't take the
// app down) as core plugins. out/main/ is two levels under the repo root.
function bundledPluginsDir() {
  return app.isPackaged ? null : path.join(__dirname, '../../dev-plugins')
}

// User-installed plugins, parallel to Obsidian's .obsidian/plugins/.
export function userPluginsDir() {
  const dir = path.join(app.getPath('userData'), 'plugins')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readOriginRepo(pluginDir) {
  try {
    const { repo } = JSON.parse(fs.readFileSync(path.join(pluginDir, ORIGIN_FILE), 'utf-8'))
    return typeof repo === 'string' ? repo : null
  } catch {
    return null
  }
}

function scanDir(dir, source) {
  const found = []
  if (!dir || !fs.existsSync(dir)) return found
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Dot-folders are the plugin store's in-progress downloads (store.js).
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const pluginDir = path.join(dir, entry.name)
    const manifestPath = path.join(pluginDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      const { ok, errors } = validateManifest(manifest)
      if (!ok) {
        console.error(`Skipping plugin at ${pluginDir}: invalid manifest.json - ${errors.join('; ')}`)
        continue
      }
      const repo = source === 'user' ? readOriginRepo(pluginDir) : null
      found.push({ id: manifest.id, dir: pluginDir, manifest, source, repo })
    } catch (err) {
      console.error(`Failed to read plugin manifest at ${manifestPath}`, err)
    }
  }
  return found
}

let cachedPlugins = null

// Scans both plugin roots and merges into one id -> plugin list. Bundled
// plugins win on id collision, so a dropped-in user folder can't shadow a
// trusted bundled plugin's identity. Cached until the plugin store changes a
// folder (invalidatePlugins); the renderer then re-syncs and swaps plugins
// in and out live (renderer/core/PluginLoader.js).
export function getPlugins() {
  if (!cachedPlugins) {
    const user = scanDir(userPluginsDir(), 'user')
    const bundled = scanDir(bundledPluginsDir(), 'bundled')
    const byId = new Map()
    // Bundled first, so installed plugins' tabs come after the built-in ones.
    for (const plugin of bundled) byId.set(plugin.id, plugin)
    for (const plugin of user) if (!byId.has(plugin.id)) byId.set(plugin.id, plugin)
    cachedPlugins = [...byId.values()]
  }
  return cachedPlugins
}

export function invalidatePlugins() {
  cachedPlugins = null
}

function enablementOptions() {
  const { disabledPlugins, restrictedMode } = getSettings()
  return { disabledIds: disabledPlugins, restrictedMode }
}

// The plugins that should be running right now. Not frozen: toggles,
// Restricted mode and installs apply live, the renderer re-syncs to this.
export function getLoadablePlugins() {
  const options = enablementOptions()
  return getPlugins().filter((p) => pluginLoadState(p, options) === 'enabled')
}

// Gate for main-process plugin code: a switched-off or restricted plugin's
// Node code never runs.
export function isPluginLoaded(id) {
  return getLoadablePlugins().some((p) => p.id === id)
}

// Every installed plugin, for Settings > Core/Community plugins. `state` is
// what the saved settings say now; the renderer knows what's actually
// running (a busy plugin's swap can be waiting).
export function describePlugins() {
  const options = enablementOptions()
  return getPlugins().map((p) => ({
    id: p.id,
    manifest: p.manifest,
    kind: pluginKind(p),
    repo: p.repo,
    official: p.source === 'bundled' || isOfficialRepo(p.repo),
    state: pluginLoadState(p, options),
    loaded: isPluginLoaded(p.id)
  }))
}

export function getPluginDir(id) {
  return getPlugins().find((p) => p.id === id)?.dir ?? null
}

export function getPlugin(id) {
  return getPlugins().find((p) => p.id === id) ?? null
}
