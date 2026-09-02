// Owns the "add from link" dialog - hands a plain http(s) URL to
// library:addSoundFromUrl over IPC, which downloads it via the bundled
// ffmpeg (its own http/https client) and transcodes straight to .wav, then
// imports it through the exact same addSound() path any other file goes
// through (see library.js). Same install-once / open-on-demand shape as
// RecordDialog.js/WatchFolderDialog.js, and only one entry point (the
// toolbar "+" menu) so no reshow-behind logic is needed.
let els = null

function resetState() {
  els.url.value = ''
  els.name.value = ''
  els.status.textContent = ''
  els.confirm.disabled = false
}

async function confirmAdd() {
  const url = els.url.value.trim()
  if (!url) return
  els.confirm.disabled = true
  els.status.textContent = 'Downloading…'
  const name = els.name.value.trim()
  try {
    await window.noctivago.library.addSoundFromUrl({ url, name })
    els.dialog.classList.add('hidden')
    document.dispatchEvent(new CustomEvent('library:linked'))
  } catch (err) {
    els.status.textContent = `Couldn't add that link: ${err.message}`
    els.confirm.disabled = false
  }
}

export function installAddLinkDialog() {
  els = {
    dialog: document.getElementById('add-link-dialog'),
    url: document.getElementById('add-link-url'),
    name: document.getElementById('add-link-name'),
    status: document.getElementById('add-link-status'),
    cancel: document.getElementById('add-link-cancel'),
    confirm: document.getElementById('add-link-confirm')
  }

  els.confirm.addEventListener('click', confirmAdd)
  els.cancel.addEventListener('click', () => {
    els.dialog.classList.add('hidden')
  })
}

export function openAddLinkDialog() {
  resetState()
  els.dialog.classList.remove('hidden')
}
