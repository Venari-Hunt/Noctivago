// Settings pages added by plugins (app.settings.addPage in PluginLoader.js).
// One page per plugin; adding again replaces it. The Settings window
// subscribes so a page shows up even if its plugin finishes loading after
// the window opened.
const pages = new Map()
const listeners = new Set()
// Same array until something changes: useSyncExternalStore re-renders
// forever if the snapshot is a new object on every read.
let snapshot = []

function emit() {
  snapshot = [...pages.values()]
  for (const listener of listeners) listener()
}

// page: { title, mount(container), unmount?() }
export function addPluginSettingsPage(pluginId, page) {
  if (typeof page?.mount !== 'function') throw new Error('A settings page needs a mount(container) function')
  const entry = { pluginId, title: String(page.title || pluginId), mount: page.mount, unmount: page.unmount }
  pages.set(pluginId, entry)
  emit()
  return () => {
    if (pages.get(pluginId) !== entry) return
    pages.delete(pluginId)
    emit()
  }
}

export function listPluginSettingsPages() {
  return snapshot
}

export function getPluginSettingsPage(pluginId) {
  return pages.get(pluginId) ?? null
}

export function subscribePluginSettingsPages(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
