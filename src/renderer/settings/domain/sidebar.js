// The Settings sidebar, Obsidian-style: fixed Options pages, then one page
// per enabled plugin that added settings (see pluginSettingsPages.js).
export const OPTION_PAGES = [
  { id: 'general', title: 'General' },
  { id: 'library', title: 'Library' },
  { id: 'core-plugins', title: 'Core plugins' },
  { id: 'community-plugins', title: 'Community plugins' }
]

export function pluginPageId(pluginId) {
  return `plugin:${pluginId}`
}

// pluginPages: [{ pluginId, title }]. Core and community plugin pages are
// listed in separate groups, the way Obsidian's sidebar does. The Core
// plugins page only shows when there are core plugins: a release ships none
// (they're all downloads), a dev build has the dev-plugins/ test fixtures.
export function buildSidebar(pluginPages, describedPlugins = []) {
  const kindById = new Map(describedPlugins.map((p) => [p.id, p.kind]))
  const hasCore = describedPlugins.some((p) => p.kind === 'core')
  const options = hasCore ? OPTION_PAGES : OPTION_PAGES.filter((p) => p.id !== 'core-plugins')
  const toItem = (p) => ({ id: pluginPageId(p.pluginId), title: p.title })
  const sorted = [...pluginPages].sort((a, b) => a.title.localeCompare(b.title))
  const groups = [{ label: 'Options', items: options }]
  const core = sorted.filter((p) => kindById.get(p.pluginId) !== 'community').map(toItem)
  const community = sorted.filter((p) => kindById.get(p.pluginId) === 'community').map(toItem)
  if (core.length) groups.push({ label: 'Core plugins', items: core })
  if (community.length) groups.push({ label: 'Community plugins', items: community })
  return groups
}
