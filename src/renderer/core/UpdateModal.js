// In-app "Update available" modal - replaces the native OS dialogs that
// autoUpdate.js used to pop for every step of the update flow (found /
// download? / no update / check failed). Holds no state of its own: every
// render is driven either by an update:* IPC event from the main process or
// by a one-off getState() read when the modal is opened directly from
// Settings.
//
// Flow: available -> (Download & install) -> downloading (progress bar) ->
// downloaded -> app restarts to install. Matches the existing
// single-confirmation decision - the one Download click is the only prompt.
// When autoInstallUpdates is on, the 'available' payload carries
// autoCountdownSeconds: the modal shows a short countdown and main starts the
// download on its own when it elapses ("Not now" cancels).
// After the restart, this same modal reopens in a 'whats-new' state (driven
// by autoUpdate.getWhatsNew(), a version-changed-since-last-run check against
// the bundled CHANGELOG) with a rundown of what changed.

let els = null
let renderedStatus = 'idle'
let currentVersion = ''
let offeredVersion = null

// Cosmetic tick for the auto-install countdown (autoInstallUpdates on). The
// real deadline lives in the main process - the window is usually in the tray
// by now, where this interval gets throttled - so this only updates the
// displayed number; "Not now" is what actually cancels it.
let countdownIntervalId = null

function clearCountdown() {
  if (!countdownIntervalId) return
  clearInterval(countdownIntervalId)
  countdownIntervalId = null
}

const TITLES = {
  checking: 'Checking for updates…',
  available: 'Update available',
  downloading: 'Downloading update…',
  downloaded: 'Update ready',
  'not-available': "You're up to date",
  error: 'Update check failed',
  dev: 'Updates unavailable',
  idle: 'Check for updates'
}

function mb(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return ''
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function show() {
  els.modal.classList.remove('hidden')
}

function hide() {
  els.modal.classList.add('hidden')
  clearCountdown()
}

function toggle(el, visible) {
  el.classList.toggle('hidden', !visible)
}

function renderState(state) {
  const status = state.status
  renderedStatus = status
  clearCountdown()
  const cur = state.currentVersion || currentVersion
  if (state.currentVersion) currentVersion = state.currentVersion
  if (status === 'available' && state.version) offeredVersion = state.version

  els.title.textContent =
    status === 'whats-new' ? `What's new in v${state.version}` : TITLES[status] || TITLES.idle

  const messages = {
    checking: 'Looking for a newer version of Noctívago…',
    available: `Noctívago ${state.version} is available. You have ${cur || 'an older version'}.`,
    downloading: 'The app will restart to finish installing once the download completes.',
    downloaded: 'Restarting to finish installing…',
    'not-available': `You already have the latest version${cur ? ` (${cur})` : ''}.`,
    error: state.message || 'Could not check for updates. Check your internet connection and try again later.',
    dev: 'Update checking only works in the installed version of Noctívago.',
    'whats-new': state.previousVersion
      ? `Noctívago updated from ${state.previousVersion} to ${state.version}.`
      : `You're running Noctívago v${state.version}.`,
    idle: ''
  }
  els.message.textContent = messages[status] || ''

  // Auto-install countdown: main sends autoCountdownSeconds alongside an
  // available update when autoInstallUpdates is on. It downloads and installs
  // on its own when the timer (in main) elapses; "Not now" cancels it.
  if (status === 'available' && typeof state.autoCountdownSeconds === 'number') {
    let remaining = state.autoCountdownSeconds
    const paintCountdown = () => {
      els.message.textContent =
        `Noctívago ${state.version || ''} will download and install automatically in ${remaining}s, then restart. Choose "Not now" to skip this update.`
    }
    paintCountdown()
    countdownIntervalId = setInterval(() => {
      remaining = Math.max(0, remaining - 1)
      paintCountdown()
      if (remaining <= 0) clearCountdown()
    }, 1000)
  }

  // The version row is a "from -> to" pair; only meaningful when there's a
  // previous version to show. Opened manually from Settings there isn't one,
  // so the row is hidden and the title/message carry the version instead.
  const showVersionRow =
    status === 'available' || (status === 'whats-new' && state.previousVersion)
  toggle(els.versionRow, showVersionRow)
  if (showVersionRow) {
    els.versionCurrent.textContent =
      (status === 'whats-new' ? state.previousVersion : cur) || '—'
    els.versionNew.textContent = state.version || '—'
  }

  let notes = ''
  if (status === 'available' && state.notes) notes = String(state.notes).trim()
  else if (status === 'whats-new') {
    notes = state.notes
      ? String(state.notes).trim()
      : `You're now on v${state.version}.`
  }
  toggle(els.notesWrapper, Boolean(notes))
  if (notes) els.notes.textContent = notes

  const showProgress = status === 'downloading' || status === 'downloaded'
  toggle(els.progressWrapper, showProgress)
  if (status === 'downloading') {
    const p = state.progress
    const pct = p && typeof p.percent === 'number' ? p.percent : null
    els.progressBar.classList.toggle('indeterminate', pct == null)
    els.progressBar.style.width = pct == null ? '' : `${pct.toFixed(1)}%`
    if (pct == null) {
      els.progressLabel.textContent = 'Starting download…'
    } else {
      const size = p.total ? ` · ${mb(p.transferred)} / ${mb(p.total)}` : ''
      const speed = p.bytesPerSecond ? ` · ${mb(p.bytesPerSecond)}/s` : ''
      els.progressLabel.textContent = `${pct.toFixed(0)}%${size}${speed}`
    }
  } else if (status === 'downloaded') {
    els.progressBar.classList.remove('indeterminate')
    els.progressBar.style.width = '100%'
    els.progressLabel.textContent = ''
  }

  toggle(els.download, status === 'available')
  toggle(els.retry, status === 'error')
  els.close.textContent =
    status === 'available' ? 'Not now' : status === 'downloading' ? 'Hide' : 'Close'
  els.close.disabled = status === 'downloaded'
}

// Opened from Settings ("Check for updates"). Kicks a fresh check and shows
// whatever the main process reports. If a background check already found an
// update, getState() lets us show it right away rather than waiting for the
// new check to re-emit.
export async function openUpdateModal() {
  if (!els) return
  show()
  renderState({ status: 'checking' })

  const result = await window.noctivago.autoUpdate.checkNow()
  if (result && result.packaged === false) {
    renderState({ status: 'dev' })
    return
  }

  const state = await window.noctivago.autoUpdate.getState()
  if (state && ['available', 'downloading', 'downloaded'].includes(state.status)) {
    renderState(state)
  }
}

// Opened from Settings ("What's new"). Shows the current version's changelog
// entry on demand - the same 'whats-new' screen that auto-pops once after an
// update installs, but reachable any time. Works in dev too (unlike the
// update check).
export async function openWhatsNewModal() {
  if (!els) return
  const wn = await window.noctivago.autoUpdate.getWhatsNewCurrent()
  renderState({ status: 'whats-new', ...(wn || {}) })
  show()
}

export function installUpdateModal() {
  els = {
    modal: document.getElementById('update-modal'),
    title: document.getElementById('update-modal-title'),
    message: document.getElementById('update-modal-message'),
    versionRow: document.getElementById('update-version-row'),
    versionCurrent: document.getElementById('update-version-current'),
    versionNew: document.getElementById('update-version-new'),
    notesWrapper: document.getElementById('update-notes-wrapper'),
    notes: document.getElementById('update-notes'),
    progressWrapper: document.getElementById('update-progress-wrapper'),
    progressBar: document.getElementById('update-progress-bar'),
    progressLabel: document.getElementById('update-progress-label'),
    download: document.getElementById('update-download'),
    retry: document.getElementById('update-retry'),
    close: document.getElementById('update-close')
  }

  els.download.addEventListener('click', () => {
    renderState({ status: 'downloading', progress: null })
    window.noctivago.autoUpdate.download()
  })

  els.retry.addEventListener('click', () => {
    openUpdateModal()
  })

  els.close.addEventListener('click', () => {
    // Closing while an update is being offered counts as "Not now" - tell
    // the main process so the periodic re-check doesn't reopen this for the
    // same version.
    if (renderedStatus === 'available' && offeredVersion) {
      window.noctivago.autoUpdate.dismiss(offeredVersion)
    }
    hide()
  })

  window.noctivago.autoUpdate.onEvent(handleEvent)

  // If an update just installed (the app relaunched on a new version), show
  // the What's-new screen. Deferred so a real update:available event from
  // the startup check - which supersedes "here's what changed" - can win if
  // one somehow arrives in the same tick.
  window.noctivago.autoUpdate
    .getWhatsNew()
    .then((wn) => {
      if (wn && els.modal.classList.contains('hidden')) {
        renderState({ status: 'whats-new', ...wn })
        show()
      }
    })
    .catch(() => {})
}

function handleEvent(channel, payload) {
  switch (channel) {
    case 'update:checking':
      renderState({ status: 'checking' })
      break
    case 'update:available':
      renderState({ status: 'available', ...payload })
      show()
      break
    case 'update:progress':
      renderState({ status: 'downloading', progress: payload })
      break
    case 'update:downloaded':
      renderState({ status: 'downloaded', ...payload })
      show()
      break
    case 'update:not-available':
      renderState({ status: 'not-available', ...payload })
      break
    case 'update:error':
      renderState({ status: 'error', ...payload })
      break
    default:
      break
  }
}
