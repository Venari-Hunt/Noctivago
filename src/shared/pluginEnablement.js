// Which installed plugins load, Obsidian-style. Electron-free so the main
// process (registry.js) and the Settings window share one set of rules.
//
// - Core plugins ship with the app. Each can be switched off.
// - Community plugins were installed from the store (or dropped into the
//   plugins folder by hand). Restricted mode, on by default, keeps them from
//   loading. Official plugins (published from the Venari-Hunt GitHub
//   account) are exempt, so the app's own downloadable plugins keep working.

export const OFFICIAL_REPO_OWNER = 'Venari-Hunt'

export function isOfficialRepo(repo) {
  if (typeof repo !== 'string') return false
  const owner = repo.split('/')[0]
  return owner.toLowerCase() === OFFICIAL_REPO_OWNER.toLowerCase()
}

export function pluginKind(plugin) {
  return plugin.source === 'bundled' ? 'core' : 'community'
}

// 'enabled' | 'disabled' (switched off by the user) | 'restricted' (a
// third-party plugin while Restricted mode is on).
export function pluginLoadState(plugin, { disabledIds = [], restrictedMode = true } = {}) {
  if (disabledIds.includes(plugin.id)) return 'disabled'
  if (pluginKind(plugin) === 'community' && restrictedMode && !isOfficialRepo(plugin.repo)) return 'restricted'
  return 'enabled'
}

// Restricted mode only blocks third-party installs; official ones go through.
export function canInstallFromStore(repo, { restrictedMode = true } = {}) {
  return !restrictedMode || isOfficialRepo(repo)
}
