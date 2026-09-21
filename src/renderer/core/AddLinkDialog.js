// Owns the "add from link" dialog - hands a plain http(s) URL to
// library:addSoundFromUrl over IPC. Main-process side (library.js) tries the
// bundled ffmpeg's own http/https client first (fast, works for a direct
// audio file URL); if that fails, it falls back to yt-dlp for a video-site
// page URL (YouTube, etc. - v0.1.132, owner's own "do it" answer to the
// earlier parked idea).
//
// v0.1.169: a "Max length to download" cap (default 10 min - "so you don't
// download a 10h file since you can loop and crossfade it on the app",
// owner's own words, flagged "takes precedence over anything"), plus a live
// progress bar + verbose log fed by the library:addSoundFromUrlProgress IPC
// channel ("would like a working progress bar + verbose of what's going on").
//
// Same install-once / open-on-demand shape as RecordDialog.js/
// WatchFolderDialog.js, and only one entry point (the toolbar "+" menu) so
// no reshow-behind logic is needed.
let els = null

const DEFAULT_MAX_MINUTES = 10

function resetState() {
  els.url.value = ''
  els.name.value = ''
  els.maxlen.value = String(DEFAULT_MAX_MINUTES)
  els.status.textContent = ''
  els.confirm.disabled = false
  els.progress.classList.add('hidden')
  els.progressFill.classList.remove('indeterminate')
  els.progressFill.style.width = '0%'
  els.log.textContent = ''
}

function appendLog(line) {
  els.log.textContent += (els.log.textContent ? '\n' : '') + line
  els.log.scrollTop = els.log.scrollHeight
}

function handleProgress(update) {
  if (!update) return
  if (update.type === 'progress') {
    els.progressFill.classList.remove('indeterminate')
    els.progressFill.style.width = `${Math.max(0, Math.min(100, update.percent))}%`
    return
  }
  // step / status - a line for the verbose log
  if (update.message) appendLog(update.message)
  if (update.type === 'step') els.status.textContent = update.message
}

// Whether a download is in flight, so Cancel can really stop it rather than
// just hiding the dialog over a job that keeps running.
let downloading = false

async function confirmAdd() {
  const url = els.url.value.trim()
  if (!url) return
  const minutes = Math.max(0, Math.floor(Number(els.maxlen.value) || 0))
  const maxSeconds = minutes > 0 ? minutes * 60 : 0

  els.confirm.disabled = true
  downloading = true
  els.status.textContent = 'Starting…'
  els.log.textContent = ''
  els.progress.classList.remove('hidden')
  els.progressFill.style.width = '0%'
  // Indeterminate until the first real percent arrives (a direct download
  // with no length cap, or yt-dlp's own webpage/format-extraction phase,
  // reports no percentage).
  els.progressFill.classList.add('indeterminate')

  const unsubscribe = window.noctivago.library.onAddSoundFromUrlProgress(handleProgress)
  const name = els.name.value.trim()
  try {
    await window.noctivago.library.addSoundFromUrl({ url, name, maxSeconds })
    els.dialog.classList.add('hidden')
    document.dispatchEvent(new CustomEvent('library:linked'))
  } catch (err) {
    els.progressFill.classList.remove('indeterminate')
    // Strip Electron's own IPC wrapping ("Error invoking remote method
    // '...': Error: ...") and show the message as-is: library.js now returns
    // one finished sentence per failure. It used to be cut at the first "("
    // or ".", which threw away the actual reason - a live stream, a removed
    // video and a sign-in wall all came out reading the same.
    const clean = (err.message || 'Download failed').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
    els.status.textContent = clean
    appendLog(`ERROR: ${clean}`)
    els.confirm.disabled = false
  } finally {
    downloading = false
    unsubscribe()
  }
}

export function installAddLinkDialog() {
  els = {
    dialog: document.getElementById('add-link-dialog'),
    url: document.getElementById('add-link-url'),
    name: document.getElementById('add-link-name'),
    maxlen: document.getElementById('add-link-maxlen'),
    status: document.getElementById('add-link-status'),
    progress: document.getElementById('add-link-progress'),
    progressFill: document.getElementById('add-link-progress-fill'),
    log: document.getElementById('add-link-log'),
    cancel: document.getElementById('add-link-cancel'),
    confirm: document.getElementById('add-link-confirm')
  }

  els.confirm.addEventListener('click', confirmAdd)
  els.cancel.addEventListener('click', () => {
    // Closing used to leave the download running invisibly; a YouTube import
    // can take minutes, so Cancel has to actually stop it.
    if (downloading) window.noctivago.library.cancelAddSoundFromUrl()
    els.dialog.classList.add('hidden')
  })
}

export function openAddLinkDialog() {
  resetState()
  els.dialog.classList.remove('hidden')
}
