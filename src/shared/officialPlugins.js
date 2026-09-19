// The app's own plugins. They shipped inside the app until the plugin store
// split; now each is a download from its own Venari-Hunt repo. Listed here
// so the one-time migration and the Recommended plugins card work before the
// store list has loaded, or offline. Electron-free.

export const OFFICIAL_PLUGINS = [
  { id: 'remix', name: 'Remix', description: 'Trim, filter and EQ a sound, a Sound Group or the whole mix, with live preview.' },
  { id: 'export', name: 'Export', description: 'Bake a preset down to one audio (or video) file of any length.' },
  { id: 'composite', name: 'Composite', description: 'Combine several sounds into one new sound on a small timeline.' },
  { id: 'browse-sounds', name: 'Browse Sounds', description: 'Search Freesound.org and YouTube and import sounds in one click.' },
  { id: 'community', name: 'Community', description: 'Browse, import and share presets made by other people.' }
]

// Official plugins not installed yet, in list order.
export function missingOfficialPlugins(installedIds) {
  const installed = new Set(installedIds)
  return OFFICIAL_PLUGINS.filter((p) => !installed.has(p.id))
}

// Whether a launch still owes the one-time migration install. Only people
// who used the app before the split had these plugins built in; a fresh
// install gets the Recommended plugins card instead.
export function needsPluginMigration({ migrated, lastRunVersion, soundCount }) {
  if (migrated) return false
  return Boolean(lastRunVersion) || soundCount > 0
}

// The Mixer's Recommended plugins card: shown until dismissed, and only
// while at least one official plugin is missing.
export function shouldShowRecommended({ dismissed, installedIds }) {
  return !dismissed && missingOfficialPlugins(installedIds).length > 0
}
