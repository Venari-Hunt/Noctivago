import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../../shared/pluginManifest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Bundled ("official") plugins ship in the repo's plugins/ folder. In a
// packaged build they're copied to resources/plugins via electron-builder's
// extraResources; in dev they're read straight from the repo (out/main/ is
// two levels under the repo root: out/main -> out -> repo root).
function bundledPluginsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'plugins') : path.join(__dirname, '../../plugins')
}

// User-installed plugins, parallel to Obsidian's .obsidian/plugins/.
function userPluginsDir() {
  const dir = path.join(app.getPath('userData'), 'plugins')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function scanDir(dir, source) {
  const found = []
  if (!fs.existsSync(dir)) return found
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
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
      found.push({ id: manifest.id, dir: pluginDir, manifest, source })
    } catch (err) {
      console.error(`Failed to read plugin manifest at ${manifestPath}`, err)
    }
  }
  return found
}

let cachedPlugins = null

// Scans both plugin roots and merges into one id -> plugin list. Bundled
// plugins win on id collision, so a dropped-in user folder can't shadow a
// trusted bundled plugin's identity. Cached for the session — plugins aren't
// hot-reloaded in v1.
export function getPlugins() {
  if (!cachedPlugins) {
    const user = scanDir(userPluginsDir(), 'user')
    const bundled = scanDir(bundledPluginsDir(), 'bundled')
    const byId = new Map()
    for (const plugin of user) byId.set(plugin.id, plugin)
    for (const plugin of bundled) byId.set(plugin.id, plugin)
    cachedPlugins = [...byId.values()]
  }
  return cachedPlugins
}

export function getPluginDir(id) {
  return getPlugins().find((p) => p.id === id)?.dir ?? null
}

export function getPlugin(id) {
  return getPlugins().find((p) => p.id === id) ?? null
}
