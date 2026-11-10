import { MockIcon } from '../../components/mockIcons.jsx'

// The right end of the top nav: Settings (it opens the Settings page).
export function NavEnd({ handlers, settingsOpen }) {
  return (
    <button className={`nav-button${settingsOpen ? ' nav-button-active' : ''}`} type="button" title="Settings" onClick={handlers.onOpenSettings}>
      <MockIcon name="settings" />
      <span>Settings</span>
    </button>
  )
}
