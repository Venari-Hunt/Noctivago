import { renderWatchedFolderList } from '../ui/WatchedFolderList.js'
import { openWatchFolderPicker } from './WatchFolderDialog.js'

// Wires the toolbar's gear button + Settings modal. Core, not a plugin -
// mirrors the other app-wide bits (dev badge, slider reset) wired directly
// from main.js rather than living inside a tab.
export function installSettingsMenu() {
  const openBtn = document.getElementById('open-settings')
  const modal = document.getElementById('settings-modal')
  const closeBtn = document.getElementById('settings-close')
  const autoUpdateCheckbox = document.getElementById('settings-auto-update-enabled')
  const checkNowBtn = document.getElementById('settings-check-now')
  const checkStatus = document.getElementById('settings-check-status')
  const autoInstallUpdatesCheckbox = document.getElementById('settings-auto-install-updates')
  const minimizeToTrayCheckbox = document.getElementById('settings-minimize-to-tray-enabled')

  const watchedFolderList = document.getElementById('watched-folder-list')
  const addWatchedFolderBtn = document.getElementById('add-watched-folder')

  async function refreshWatchedFolders() {
    const folders = await window.noctivago.library.listWatchedFolders()
    renderWatchedFolderList(watchedFolderList, folders, {
      onRemove: async (id) => {
        await window.noctivago.library.removeWatchedFolder(id)
        refreshWatchedFolders()
      }
    })
  }

  openBtn.addEventListener('click', async () => {
    const settings = await window.noctivago.settings.get()
    autoUpdateCheckbox.checked = settings.autoUpdateEnabled
    autoInstallUpdatesCheckbox.checked = settings.autoInstallUpdates
    minimizeToTrayCheckbox.checked = settings.minimizeToTrayEnabled
    checkStatus.textContent = ''
    refreshWatchedFolders()
    modal.classList.remove('hidden')
  })

  addWatchedFolderBtn.addEventListener('click', openWatchFolderPicker)

  // Fires after a successful add from *either* entry point (this button or
  // the toolbar "+" menu) - refreshes the list here only if it's actually
  // visible right now, since it also refreshes fresh on every openBtn click.
  document.addEventListener('watched-folder-added', ({ detail }) => {
    if (modal.classList.contains('hidden')) return
    refreshWatchedFolders()
    checkStatus.textContent =
      detail.addedCount > 0
        ? `Watching folder — imported ${detail.addedCount} sound${detail.addedCount === 1 ? '' : 's'}.`
        : 'Watching folder.'
  })

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'))

  autoUpdateCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setAutoUpdateEnabled(autoUpdateCheckbox.checked)
  })

  autoInstallUpdatesCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setAutoInstallUpdatesEnabled(autoInstallUpdatesCheckbox.checked)
  })

  minimizeToTrayCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setMinimizeToTrayEnabled(minimizeToTrayCheckbox.checked)
  })

  checkNowBtn.addEventListener('click', () => {
    // The actual result (update found / already up to date / check failed)
    // surfaces as a native dialog from the main process - same as every
    // other update-related prompt in this app - so this status line is
    // just a lightweight "yes, it's running" acknowledgement, not the
    // final answer.
    checkStatus.textContent = 'Checking…'
    window.noctivago.autoUpdate.checkNow()
    setTimeout(() => {
      checkStatus.textContent = ''
    }, 3000)
  })
}
