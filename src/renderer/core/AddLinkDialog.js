// Owns the "add from link" dialog - hands a plain http(s) URL to
// library:addSoundFromUrl over IPC. Main-process side (library.js) tries the
// bundled ffmpeg's own http/https client first (fast, works for a direct
// audio file URL); if that fails, it falls back to yt-dlp for a video-site
// page URL (YouTube, etc. - v0.1.132, owner's own "do it" answer to the
// earlier parked idea) - either way this dialog doesn't need to know which
// path was used, it just shows "Downloading..." and reports success/failure.
// Same install-once / open-on-demand shape as RecordDialog.js/
// WatchFolderDialog.js, and only one entry point (the toolbar "+" menu) so
// no reshow-behind logic is needed.
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
