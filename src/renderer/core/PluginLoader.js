// Discovers and loads every enabled plugin (bundled + user-installed, see
// src/main/plugins/registry.js) into the given TabHost. Each plugin is
// loaded independently, wrapped in its own try/catch — a broken plugin logs
// an error and is skipped, it never blocks the rest of the app or other
// plugins from loading.
export async function loadPlugins(tabHost) {
  let plugins
  try {
    plugins = await window.noctivago.plugins.list()
  } catch (err) {
    console.error('Failed to list plugins', err)
    return
  }

  for (const { id, manifest } of plugins) {
    try {
      if (manifest.styles) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = `plugin://${id}/${manifest.styles}`
        document.head.appendChild(link)
      }

      const url = `plugin://${id}/${manifest.main}`
      const module = await import(/* @vite-ignore */ url)
      const PluginClass = module.default
      if (typeof PluginClass !== 'function') {
        throw new Error('Plugin module has no default export class')
      }

      const appApi = {
        tabs: { register: (tabDef) => tabHost.register(tabDef) },
        noctivago: window.noctivago,
        plugin: { id, manifest }
      }

      const instance = new PluginClass(appApi, manifest)
      await instance.onload?.()
    } catch (err) {
      console.error(`Failed to load plugin "${id}"`, err)
    }
  }
}
