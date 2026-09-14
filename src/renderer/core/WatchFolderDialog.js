// Owns the single "watch a folder" dialog shared by its two entry points -
// the toolbar's "+" add-sound menu (a one-off action, like the other two
// items there) and the Settings modal's "Watched folders" section (where
// the resulting list actually lives, since it's a background behavior, not
// a one-off add). installWatchFolderDialog() wires the dialog's own
// Cancel/Confirm once; openWatchFolderPicker() is what either entry point
// calls to trigger it - keeps the pick+scan+import flow in one place
// instead of duplicated per trigger.
let els = null
let picked = null
let reshowSettingsModal = false

export function installWatchFolderDialog() {
  els = {
    dialog: document.getElementById('add-watched-folder-dialog'),
    path: document.getElementById('add-watched-folder-path'),
    keepCopy: document.getElementById('add-watched-folder-keep-copy'),
    status: document.getElementById('add-watched-folder-status'),
    cancel: document.getElementById('add-watched-folder-cancel'),
    confirm: document.getElementById('add-watched-folder-confirm'),
    settingsModal: document.getElementById('settings-modal')
  }

  els.cancel.addEventListener('click', () => {
    picked = null
    els.dialog.classList.add('hidden')
    if (reshowSettingsModal) els.settingsModal.classList.remove('hidden')
  })

  els.confirm.addEventListener('click', async () => {
    if (!picked) return
    els.confirm.disabled = true
    els.status.textContent = 'Scanning…'
    const { addedCount } = await window.noctivago.library.addWatchedFolder(picked, {
      keepCopy: els.keepCopy.checked
    })
    picked = null
    els.dialog.classList.add('hidden')
    if (reshowSettingsModal) els.settingsModal.classList.remove('hidden')
    document.dispatchEvent(new CustomEvent('watched-folder-added', { detail: { addedCount } }))
  })
}

// Opens the native folder picker, then the confirm dialog if a folder was
// chosen. If the Settings modal happens to already be open (the dialog's
// usual home), hides it behind this one and restores it after - otherwise
// (the toolbar "+" entry point) leaves everything else alone.
export async function openWatchFolderPicker() {
  const folder = await window.noctivago.library.pickWatchFolder()
  if (!folder) return
  picked = folder
  els.path.textContent = folder
  els.keepCopy.checked = false
  els.status.textContent = ''
  els.confirm.disabled = false
  reshowSettingsModal = !els.settingsModal.classList.contains('hidden')
  if (reshowSettingsModal) els.settingsModal.classList.add('hidden')
  els.dialog.classList.remove('hidden')
}
