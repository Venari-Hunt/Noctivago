// Owns the single "watch a folder" dialog shared by its two entry points -
// the toolbar's "+" add-sound menu (a one-off action, like the other two
// items there) and the Settings page's "Watched folders" section (where
// the resulting list actually lives, since it's a background behavior, not
// a one-off add). installWatchFolderDialog() wires the dialog's own
// Cancel/Confirm once; openWatchFolderPicker() is what either entry point
// calls to trigger it - keeps the pick+scan+import flow in one place
// instead of duplicated per trigger.
let els = null
let picked = null

export function installWatchFolderDialog() {
  els = {
    dialog: document.getElementById('add-watched-folder-dialog'),
    path: document.getElementById('add-watched-folder-path'),
    keepCopy: document.getElementById('add-watched-folder-keep-copy'),
    status: document.getElementById('add-watched-folder-status'),
    cancel: document.getElementById('add-watched-folder-cancel'),
    confirm: document.getElementById('add-watched-folder-confirm')
  }

  els.cancel.addEventListener('click', () => {
    picked = null
    els.dialog.classList.add('hidden')
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
    document.dispatchEvent(new CustomEvent('watched-folder-added', { detail: { addedCount } }))
  })
}

// Opens the native folder picker, then the confirm dialog if a folder was
// chosen. The dialog opens over whatever is showing (Settings or the Mixer).
export async function openWatchFolderPicker() {
  const folder = await window.noctivago.library.pickWatchFolder()
  if (!folder) return
  picked = folder
  els.path.textContent = folder
  els.keepCopy.checked = false
  els.status.textContent = ''
  els.confirm.disabled = false
  els.dialog.classList.remove('hidden')
}
