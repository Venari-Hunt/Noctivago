import { MockIcon } from '../../components/mockIcons.jsx'

// The right end of the top nav: Settings (it opens the Settings window).
export function NavEnd({ handlers }) {
  return (
    <button className="nav-button" type="button" title="Settings" onClick={handlers.onOpenSettings}>
      <MockIcon name="settings" />
      <span>Settings</span>
    </button>
  )
}
