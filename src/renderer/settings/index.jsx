import { createRoot } from 'react-dom/client'
import { SettingsPage } from './components/SettingsPage.jsx'

// Settings is a page of its own (a tab with no tab-bar button, opened by the
// nav's Settings button), not a dialog over a dimmed app. onShow re-reads
// settings and the plugin list by giving the page a fresh key.
export function createSettingsTab() {
  let root = null
  let session = 0
  let page = null
  const render = () => root?.render(<SettingsPage key={session} noctivago={window.noctivago} initialPage={page} />)
  return {
    id: 'settings',
    title: 'Settings',
    hideButton: true,
    mount(section) {
      root = createRoot(section)
      render()
    },
    // Open on a given page (the ? shortcut opens Help); the page resets on the next normal show.
    showPage(id) {
      page = id
      session += 1
      render()
    },
    onShow() {
      session += 1
      render()
      page = null
    }
  }
}
