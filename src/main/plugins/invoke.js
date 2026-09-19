import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getPlugin, isPluginLoaded } from './registry.js'

const loadedModules = new Map()

// Main-process plugin code is ordinary trusted Node — same trust level the
// rest of src/main/*.js already has — loaded only if the plugin's manifest
// explicitly opts in via `mainProcess`. This is the one place a plugin gets
// real power (spawn ffmpeg, touch disk); renderer-side plugin code never
// gets this, only the curated app object passed into it (see TabHost/main.js).
//
// Cached per plugin *version*: after a live update the next call imports the
// new file (a ?v= query makes Node's ESM cache treat it as a new module).
async function loadMainProcessModule(pluginId) {
  const plugin = getPlugin(pluginId)
  const cached = loadedModules.get(pluginId)
  if (cached && plugin && cached.version === plugin.manifest.version) return cached.mod

  if (!plugin) throw new Error(`Unknown plugin "${pluginId}"`)
  // A switched-off or restricted plugin's Node code must not run just
  // because another plugin asked for it.
  if (!isPluginLoaded(pluginId)) throw new Error(`Plugin "${pluginId}" isn't enabled`)
  if (!plugin.manifest.mainProcess) {
    throw new Error(`Plugin "${pluginId}" has no mainProcess module declared in its manifest`)
  }

  const entryPath = path.join(plugin.dir, plugin.manifest.mainProcess)
  const href = `${pathToFileURL(entryPath).href}?v=${encodeURIComponent(plugin.manifest.version)}`
  const mod = await import(href)
  loadedModules.set(pluginId, { version: plugin.manifest.version, mod })
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
