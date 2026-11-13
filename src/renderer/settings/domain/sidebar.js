// The Settings page's left list: fixed pages only. A plugin's own settings
// (see pluginSettingsPages.js) open from its Options button as a dialog.
export const OPTION_PAGES = [
  { id: 'general', title: 'General', icon: 'settings' },
  { id: 'library', title: 'Library', icon: 'folder' },
  { id: 'core-plugins', title: 'Core plugins', icon: 'shield' },
  { id: 'community-plugins', title: 'Community plugins', icon: 'layers' },
  { id: 'help', title: 'Help', icon: 'circle-help' },
  { id: 'advanced', title: 'Advanced', icon: 'sliders-horizontal' },
  { id: 'privacy', title: 'Privacy', icon: 'lock' },
  { id: 'about', title: 'About', icon: 'info' }
]

// The Core plugins page only shows when there are core plugins: a release
// ships none (they're all downloads), a dev build has the dev-plugins/ test fixtures.
export function buildSidebar(describedPlugins = []) {
  const hasCore = describedPlugins.some((p) => p.kind === 'core')
  return hasCore ? OPTION_PAGES : OPTION_PAGES.filter((p) => p.id !== 'core-plugins')
}
