import { OFFICIAL_PLUGINS, shouldShowRecommended, missingOfficialPlugins } from '../../../../shared/officialPlugins.js'

// The plugins the Recommended card offers, or [] when it shouldn't show.
// Waits for plugins.list(), which resolves after the one-time migration
// install, so the card never offers what's being downloaded right now.
export async function recommendedPlugins(api) {
  await api.plugins.list()
  const [installed, settings] = await Promise.all([api.plugins.describe(), api.settings.get()])
  const installedIds = installed.map((p) => p.id)
  if (!shouldShowRecommended({ dismissed: settings.recommendedPluginsDismissed, installedIds })) return []
  return missingOfficialPlugins(installedIds)
}

// Installs the chosen plugins one at a time through the plugin store.
// onProgress({ index, total, plugin }) runs before each. Returns
// { installed: [id], failed: [{ id, name, error }] }.
export async function installPlugins(api, ids, onProgress = () => {}) {
  const chosen = OFFICIAL_PLUGINS.filter((p) => ids.includes(p.id))
  const result = { installed: [], failed: [] }
  if (!chosen.length) return result
  // The store only installs what its list names, so load the list first.
  try {
    await api.pluginStore.list()
  } catch (err) {
    return { installed: [], failed: chosen.map((p) => ({ id: p.id, name: p.name, error: err })) }
  }
  for (const [index, plugin] of chosen.entries()) {
    onProgress({ index, total: chosen.length, plugin })
    try {
      await api.pluginStore.install(plugin.id)
      result.installed.push(plugin.id)
    } catch (error) {
      result.failed.push({ id: plugin.id, name: plugin.name, error })
    }
  }
  return result
}
