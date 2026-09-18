import { createRoot } from 'react-dom/client'
import { SettingsWindow } from './components/SettingsWindow.jsx'

// Wires the toolbar's gear button to the Settings window. The #settings-modal
// element keeps owning visibility (a plain `hidden` class), because the
// watch-folder dialog hides and re-shows it while it's open.
export function installSettingsMenu() {
  const modal = document.getElementById('settings-modal')
  const root = createRoot(modal)
  let session = 0

  function close() {
    modal.classList.add('hidden')
    root.render(null)
  }

  document.getElementById('open-settings').addEventListener('click', () => {
    // A fresh key per opening re-reads settings and the plugin list.
    session += 1
    root.render(<SettingsWindow key={session} noctivago={window.noctivago} onClose={close} />)
    modal.classList.remove('hidden')
  })
}
