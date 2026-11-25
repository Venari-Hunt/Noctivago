import { isAdding, startPendingAdd } from './pendingAdd.js'

// Owns the "add from link" dialog - hands a plain http(s) URL to
// library:addSoundFromUrl over IPC. Main-process side (library.js) tries the
// bundled ffmpeg's own http/https client first (fast, works for a direct
// audio file URL); if that fails, it falls back to yt-dlp for a video-site
// page URL (YouTube, etc. - v0.1.132, owner's own "do it" answer to the
// earlier parked idea).
//
// v0.1.169: a "Max length to download" cap (default 10 min - "so you don't
// download a 10h file since you can loop and crossfade it on the app",
// owner's own words, flagged "takes precedence over anything").
//
// Desktop 2.0 micro-interactions (owner, 2026-11-21, mock row "Add a sound"):
// Add closes the dialog at once and the download fills a placeholder row in
// the library rail (core/pendingAdd.js), which becomes the real row, or keeps
// the failure with Retry and Remove. The row shows the live percent, or each
// step line while there is no percent; the old in-dialog bar and log are gone.
let els = null

const DEFAULT_MAX_MINUTES = 10

function resetState() {
  els.url.value = ''
  els.name.value = ''
  els.maxlen.value = String(DEFAULT_MAX_MINUTES)
  els.status.textContent = ''
  els.confirm.disabled = false
  els.progress.classList.add('hidden')
  els.log.textContent = ''
}

function confirmAdd() {
  const url = els.url.value.trim()
  if (!url) return
  // Main downloads one link at a time (one cancel for "the" download).
  if (isAdding()) {
    els.status.textContent = 'One download at a time: wait for the one in the library list.'
    return
  }
  if (!/^https?:\/\//i.test(url)) {
    els.status.textContent = 'Only http:// and https:// links are supported.'
    return
  }
  const minutes = Math.max(0, Math.floor(Number(els.maxlen.value) || 0))
  const maxSeconds = minutes > 0 ? minutes * 60 : 0
  els.dialog.classList.add('hidden')
  startPendingAdd({ url, name: els.name.value.trim(), maxSeconds })
}

export function installAddLinkDialog() {
  els = {
    dialog: document.getElementById('add-link-dialog'),
    url: document.getElementById('add-link-url'),
    name: document.getElementById('add-link-name'),
    maxlen: document.getElementById('add-link-maxlen'),
    status: document.getElementById('add-link-status'),
    progress: document.getElementById('add-link-progress'),
    log: document.getElementById('add-link-log'),
    cancel: document.getElementById('add-link-cancel'),
    confirm: document.getElementById('add-link-confirm')
  }

  els.confirm.addEventListener('click', confirmAdd)
  els.url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmAdd()
  })
  // Nothing runs inside the dialog any more, so Cancel only closes it; a running
  // download is stopped with Remove on its row.
  els.cancel.addEventListener('click', () => els.dialog.classList.add('hidden'))
}

export function openAddLinkDialog() {
  resetState()
  els.dialog.classList.remove('hidden')
}
