import { renderWatchedFolderList } from '../ui/WatchedFolderList.js'

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
  const minimizeToTrayCheckbox = document.getElementById('settings-minimize-to-tray-enabled')

  const watchedFolderList = document.getElementById('watched-folder-list')
  const addWatchedFolderBtn = document.getElementById('add-watched-folder')
  const addDialog = document.getElementById('add-watched-folder-dialog')
  const addDialogPath = document.getElementById('add-watched-folder-path')
  const addDialogKeepCopy = document.getElementById('add-watched-folder-keep-copy')
  const addDialogStatus = document.getElementById('add-watched-folder-status')
  const addDialogCancel = document.getElementById('add-watched-folder-cancel')
  const addDialogConfirm = document.getElementById('add-watched-folder-confirm')
  let pickedWatchFolder = null

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
    minimizeToTrayCheckbox.checked = settings.minimizeToTrayEnabled
    checkStatus.textContent = ''
    refreshWatchedFolders()
    modal.classList.remove('hidden')
  })

  addWatchedFolderBtn.addEventListener('click', async () => {
    const folder = await window.noctivago.library.pickWatchFolder()
    if (!folder) return
    pickedWatchFolder = folder
    addDialogPath.textContent = folder
    addDialogKeepCopy.checked = false
    addDialogStatus.textContent = ''
    addDialogConfirm.disabled = false
    modal.classList.add('hidden')
    addDialog.classList.remove('hidden')
  })

  addDialogCancel.addEventListener('click', () => {
    pickedWatchFolder = null
    addDialog.classList.add('hidden')
    modal.classList.remove('hidden')
  })

  addDialogConfirm.addEventListener('click', async () => {
    if (!pickedWatchFolder) return
    addDialogConfirm.disabled = true
    addDialogStatus.textContent = 'Scanning…'
    const { addedCount } = await window.noctivago.library.addWatchedFolder(pickedWatchFolder, {
      keepCopy: addDialogKeepCopy.checked
    })
    pickedWatchFolder = null
    addDialog.classList.add('hidden')
    modal.classList.remove('hidden')
    await refreshWatchedFolders()
    checkStatus.textContent =
      addedCount > 0 ? `Watching folder — imported ${addedCount} sound${addedCount === 1 ? '' : 's'}.` : 'Watching folder.'
  })

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'))

  autoUpdateCheckbox.addEventListener('change', () => {
    window.noctivago.settings.setAutoUpdateEnabled(autoUpdateCheckbox.checked)
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
