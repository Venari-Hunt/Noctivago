import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getPlugin } from './registry.js'

const loadedModules = new Map()

// Main-process plugin code is ordinary trusted Node — same trust level the
// rest of src/main/*.js already has — loaded only if the plugin's manifest
// explicitly opts in via `mainProcess`. This is the one place a plugin gets
// real power (spawn ffmpeg, touch disk); renderer-side plugin code never
// gets this, only the curated app object passed into it (see TabHost/main.js).
async function loadMainProcessModule(pluginId) {
  if (loadedModules.has(pluginId)) return loadedModules.get(pluginId)

  const plugin = getPlugin(pluginId)
  if (!plugin) throw new Error(`Unknown plugin "${pluginId}"`)
  if (!plugin.manifest.mainProcess) {
    throw new Error(`Plugin "${pluginId}" has no mainProcess module declared in its manifest`)
  }

  const entryPath = path.join(plugin.dir, plugin.manifest.mainProcess)
  const mod = await import(pathToFileURL(entryPath).href)
  loadedModules.set(pluginId, mod)
  return mod
}

// One generic dispatcher for every plugin's main-process capability, rather
// than each plugin needing its own hand-written IPC channel in ipc.js — keeps
// the core channel list small and reviewable regardless of plugin count.
export async function invokePlugin(pluginId, method, args) {
  const mod = await loadMainProcessModule(pluginId)
  const fn = mod[method]
  if (typeof fn !== 'function') {
    throw new Error(`Plugin "${pluginId}" has no exported function "${method}"`)
  }
  return fn(...args)
}
