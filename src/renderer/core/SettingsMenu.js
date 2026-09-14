import { renderWatchedFolderList } from '../ui/WatchedFolderList.js'
import { openWatchFolderPicker } from './WatchFolderDialog.js'
import { openUpdateModal, openWhatsNewModal } from './UpdateModal.js'
import { parseDuration } from '../util/time.js'

// Always shows all three segments, zero-padded (unlike util/time.js's own
// formatDuration, which omits the hour segment entirely when h=0) - matches
// the field's own "hh:mm:ss" placeholder exactly, so what's shown always
// looks like a valid value to re-type from.
function formatHms(totalSeconds) {
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Wires the toolbar's gear button + Settings modal. Core, not a plugin -
// mirrors the other app-wide bits (dev badge, slider reset) wired directly
// from main.js rather than living inside a tab.
export function installSettingsMenu() {
  const openBtn = document.getElementById('open-settings')
  const modal = document.getElementById('settings-modal')
  const closeBtn = document.getElementById('settings-close')
  const autoUpdateCheckbox = document.getElementById('settings-auto-update-enabled')
  const updateIntervalInput = document.getElementById('settings-auto-update-interval')
  const checkNowBtn = document.getElementById('settings-check-now')
  const whatsNewBtn = document.getElementById('settings-whats-new')
  const checkStatus = document.getElementById('settings-check-status')
  const autoInstallUpdatesCheckbox = document.getElementById('settings-auto-install-updates')
  const minimizeToTrayCheckbox = document.getElementById('settings-minimize-to-tray-enabled')
  const eagerlyBakeOnImportCheckbox = document.getElementById('settings-eagerly-bake-on-import')
  const ytDlpCookiesBrowserSelect = document.getElementById('settings-ytdlp-cookies-browser')

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
    updateIntervalInput.value = formatHms(settings.autoUpdateIntervalSeconds)
    autoInstallUpdatesCheckbox.checked = settings.autoInstallUpdates
    minimizeToTrayCheckbox.checked = settings.minimizeToTrayEnabled
    eagerlyBakeOnImportCheckbox.checked = settings.eagerlyBakeOnImport
    ytDlpCookiesBrowserSelect.value = settings.ytDlpCookiesBrowser ?? 'none'
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

  // Commits on blur/Enter (like the sound-rename field elsewhere in this
  // app), not on every keystroke - a half-typed "hh:mm:ss" shouldn't get
  // saved or reformatted mid-entry. An unparseable or non-positive value
  // just reverts the field to whatever's still actually persisted, rather
  // than silently accepting garbage.
  async function commitUpdateInterval() {
    const seconds = parseDuration(updateIntervalInput.value)
    if (seconds != null && seconds > 0) {
      const settings = await window.noctivago.settings.setAutoUpdateIntervalSeconds(seconds)
      updateIntervalInput.value = formatHms(settings.autoUpdateIntervalSeconds)
    } else {
      const settings = await window.noctivago.settings.get()
      updateIntervalInput.value = formatHms(settings.autoUpdateIntervalSeconds)
    }
  }
  updateIntervalInput.addEventListener('blur', commitUpdateInterval)
  updateIntervalInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') updateIntervalInput.blur()
  })

  autoInstallUpdatesCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setAutoInstallUpdatesEnabled(autoInstallUpdatesCheckbox.checked)
  })

  minimizeToTrayCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setMinimizeToTrayEnabled(minimizeToTrayCheckbox.checked)
  })

  eagerlyBakeOnImportCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setEagerlyBakeOnImportEnabled(eagerlyBakeOnImportCheckbox.checked)
  })

  ytDlpCookiesBrowserSelect.addEventListener('change', () => {
    window.noctivago.settings.setYtDlpCookiesBrowser(ytDlpCookiesBrowserSelect.value)
  })

  checkNowBtn.addEventListener('click', () => {
    // Opens the in-app Update modal, which runs the check and shows the
    // result (update found + release notes / already up to date / check
    // failed) plus the download progress bar - replacing the native OS
    // dialogs this flow used to pop.
    openUpdateModal()
  })

  whatsNewBtn.addEventListener('click', () => {
    // Same "What's new" screen that auto-pops once after an update installs,
    // now reachable on demand - shows the current version's changelog entry.
    openWhatsNewModal()
  })
}
