import { createRoot } from 'react-dom/client'
import { SettingsPage } from './components/SettingsPage.jsx'

// Settings is a page of its own (a tab with no tab-bar button, opened by the
// nav's Settings button), not a dialog over a dimmed app. onShow re-reads
// settings and the plugin list by giving the page a fresh key.
export function createSettingsTab() {
  let root = null
  let session = 0
  const render = () => root?.render(<SettingsPage key={session} noctivago={window.noctivago} />)
  return {
    id: 'settings',
    title: 'Settings',
    hideButton: true,
    mount(section) {
      root = createRoot(section)
      render()
    },
    onShow() {
      session += 1
      render()
    }
  }
}
