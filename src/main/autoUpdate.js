import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import {
  getSettings,
  setLastRunVersion,
  setAutoUpdateEnabled as persistAutoUpdateEnabled,
  setAutoUpdateIntervalSeconds as persistAutoUpdateIntervalSeconds
} from './settings.js'
import { changelogTextBetween } from './changelog.js'
import { isExportInProgress, whenExportIdle } from './exportState.js'

// __UPDATE_TOKEN__ is a build-time constant (see electron.vite.config.js) -
// empty outside the CI release build. electron-updater's GitHub provider
// reads GH_TOKEN from the environment to authenticate against this private
// repo; there's no config field for it, so it has to be set this way before
// the first check.
if (__UPDATE_TOKEN__) process.env.GH_TOKEN = __UPDATE_TOKEN__

// A packaged app has no visible console, so a failed check used to be
// completely invisible - electron-log writes everything electron-updater
// does (including the raw GitHub request/response) to a file on disk, at
// app.getPath('logs') (main.log) - %APPDATA%\noctivago\logs\main.log on
// Windows (lowercase "noctivago", matching package.json's name field,
// confirmed against where library.js already stores things like loop
// clips - app.name is never overridden to the accented productName
// anywhere in this codebase). `transports.file.level` covers info/warn/
// error; debug would be noisy for normal runs.
log.transports.file.level = 'info'
autoUpdater.logger = log

// Never downloads without asking first - but once the user has said yes to
// that one prompt, the actual install-and-restart happens on its own with
// no second confirmation, per an explicit user request that this shouldn't
// need two separate "are you sure"s.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

// Ambient-sound apps tend to get left running for hours or days at a
// stretch - the original startup-only check meant anyone who doesn't
// happen to restart for some other reason could sit on an old version
// indefinitely without ever learning a new one shipped. Re-checking
// periodically closes that gap without being excessive. Was a hardcoded
// 4-hour constant; now reads getSettings().autoUpdateIntervalSeconds
// (still defaulting to 4 hours - see settings.js) so the Settings menu's
// hh:mm:ss field can actually change it.
let recheckIntervalId = null

// Tracks the version the user already clicked "Not now" on, so the
// periodic re-check doesn't nag them with the same prompt every few hours -
// only a genuinely newer version (or the next app restart, which resets
// this) prompts again. A manual check from Settings always surfaces its
// result regardless of this, since the user explicitly asked.
let dismissedVersion = null

// When autoInstallUpdates is on, an available update no longer downloads
// the instant it's detected - the modal shows a short countdown first so
// there's a window to hit "Not now". The timer runs here in main, not in the
// renderer, because the window is usually minimized to the tray by then and
// Chromium throttles renderer timers hard in that state - the same reason
// sleepTimer.js keeps its countdown in the main process. The renderer only
// shows a cosmetic tick over the same duration.
const AUTO_INSTALL_COUNTDOWN_SECONDS = 5
let autoInstallCountdownId = null

function clearAutoInstallCountdown() {
  if (!autoInstallCountdownId) return
  clearTimeout(autoInstallCountdownId)
  autoInstallCountdownId = null
}

// Set right before a check triggered by the Settings menu's "Check for
// updates" button. The result (found / already current / failed) is then
// pushed to the in-app Update modal instead of staying silent - a plain
// background check still says nothing on those two non-events, an
// explicitly-requested one always shows something.
let manualCheckPending = false

// The renderer's Update modal (src/renderer/core/UpdateModal.js) is driven
// entirely by these - it holds no state of its own beyond what the last
// event told it. `mainWindow` is set once in initAutoUpdate; guarded on
// every send since the window can be destroyed on quit.
let mainWindow = null
let updateState = { status: 'idle', currentVersion: app.getVersion() }

// Set once at init if the app's version changed since its last run (i.e. an
// update just installed and relaunched us) - the renderer pulls this via
// getWhatsNew() when its Update modal wires up and shows a "What's new"
// screen. null on a normal launch or a first-ever launch.
let whatsNew = null

function setState(patch) {
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion() }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

// electron-updater's GitHub provider gives `releaseNotes` as the release
// body string; other providers (and multi-version catch-up) can hand back
// an array of { version, note }. Flatten either into plain display text -
// the modal renders it as-is (textContent, not HTML), so no sanitizing
// needed.
function normalizeNotes(releaseNotes) {
  if (!releaseNotes) return ''
  if (typeof releaseNotes === 'string') return releaseNotes
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((n) => (n && n.note ? `${n.version ? `${n.version}\n` : ''}${n.note}` : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  return String(releaseNotes)
}

function runCheck() {
  // Owner instruction, flagged as taking precedence over anything: the
  // update cycle shouldn't even start while a preset export is baking. A
  // manual "Check for updates" click (Settings) is deliberate user action
  // and still goes through - only the periodic background check defers,
  // since the actual close-the-app risk (quitAndInstall) is guarded
  // separately below regardless of how the check was triggered.
  if (isExportInProgress() && !manualCheckPending) {
    log.info('Auto-update: skipping check - a preset export is running')
    return
  }
  log.info(`Auto-update: checking (current version ${app.getVersion()}, token present: ${Boolean(__UPDATE_TOKEN__)})`)
  autoUpdater.checkForUpdates().catch((err) => log.error('Auto-update check failed', err))
}

function startPeriodicChecks() {
  if (recheckIntervalId) return
  recheckIntervalId = setInterval(runCheck, getSettings().autoUpdateIntervalSeconds * 1000)
}

function stopPeriodicChecks() {
  if (!recheckIntervalId) return
  clearInterval(recheckIntervalId)
  recheckIntervalId = null
}

// Compares the running version against the one persisted last run. Only
// treats a change as "just updated" for a packaged build (a dev build's
// version comes from package.json and changes whenever it's bumped for a
// release, which isn't an update the user did). Always persists the current
// version so the next launch has an accurate baseline.
function detectWhatsNew() {
  const previousVersion = getSettings().lastRunVersion
  const currentVersion = app.getVersion()
  setLastRunVersion(currentVersion)
  if (!app.isPackaged) return
  if (!previousVersion || previousVersion === currentVersion) return

  const notes = changelogTextBetween(previousVersion, currentVersion)
  whatsNew = { version: currentVersion, previousVersion, notes: notes || null }
  log.info(`Auto-update: detected update ${previousVersion} -> ${currentVersion}, showing What's new`)
}

export function initAutoUpdate(win) {
  mainWindow = win
  detectWhatsNew()

  // electron-updater only makes sense for an installed, packaged app - it
  // has no meaningful feed to check against a dev build, and would just
  // error on every `npm run dev` startup otherwise. The Update modal still
  // opens in dev (from Settings) - checkForUpdatesNow() below returns
  // { packaged: false } and the modal shows a "only in the installed app"
  // message rather than spinning forever.
  if (!app.isPackaged) return

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', errorMessage: null })
  })

  autoUpdater.on('update-available', (info) => {
    const notes = normalizeNotes(info.releaseNotes)
    setState({ status: 'available', version: info.version, notes, releaseDate: info.releaseDate })

    const wasManual = manualCheckPending
    manualCheckPending = false

    // A background re-check of a version the user already dismissed this run
    // stays quiet; an explicit "Check for updates" from Settings always
    // surfaces, dismissed or not. Applies to the auto-install path too - a
    // "Not now" on the countdown shouldn't just restart it a few hours later.
    if (info.version === dismissedVersion && !wasManual) return

    // Opt-in Settings toggle - still fully automatic, but the modal now shows
    // a short countdown before the download starts (see
    // AUTO_INSTALL_COUNTDOWN_SECONDS above) so there's a moment to bail.
    // update-downloaded below installs and restarts with no further prompt.
    if (getSettings().autoInstallUpdates) {
      log.info(`Auto-update: ${info.version} available, auto-install countdown started (${AUTO_INSTALL_COUNTDOWN_SECONDS}s)`)
      clearAutoInstallCountdown()
      autoInstallCountdownId = setTimeout(() => {
        autoInstallCountdownId = null
        // A preset export that started during the countdown shouldn't have
        // its window closed out from under it either - wait it out, same
        // guard as the final quitAndInstall step below.
        whenExportIdle(() => {
          log.info(`Auto-update: countdown elapsed, downloading ${info.version}`)
          autoUpdater.downloadUpdate()
        })
      }, AUTO_INSTALL_COUNTDOWN_SECONDS * 1000)
      send('update:available', {
        version: info.version,
        currentVersion: app.getVersion(),
        notes,
        releaseDate: info.releaseDate,
        autoCountdownSeconds: AUTO_INSTALL_COUNTDOWN_SECONDS
      })
      return
    }

    send('update:available', {
      version: info.version,
      currentVersion: app.getVersion(),
      notes,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('download-progress', (p) => {
    setState({
      status: 'downloading',
      progress: {
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total
      }
    })
    send('update:progress', updateState.progress)
  })

  // No second confirmation here on purpose - the one Download click in the
  // modal is the only consent needed; once that's given, install-and-restart
  // just happens. A short delay lets the modal paint its "restarting to
  // install" state first. quitAndInstall()'s two args matter: isSilent=true
  // skips the NSIS installer's own wizard window and isForceRunAfter=true
  // relaunches the app once the silent install finishes.
  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'downloaded', version: info.version })
    send('update:downloaded', { version: info.version })
    // Never quit-and-restart out from under a running export - direct
    // owner instruction, flagged as taking precedence over anything. Guarded
    // twice: once before the paint delay starts, once right before the
    // actual quitAndInstall call, since an export could start in that
    // 1.5s window too.
    whenExportIdle(() => {
      log.info(`Auto-update: ${info.version} downloaded, installing and restarting now`)
      setTimeout(() => {
        whenExportIdle(() => autoUpdater.quitAndInstall(true, true))
      }, 1500)
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setState({ status: 'not-available' })
    log.info(`Auto-update: no update available (latest published is ${info.version})`)
    if (manualCheckPending) {
      manualCheckPending = false
      send('update:not-available', { currentVersion: app.getVersion() })
    }
  })

  autoUpdater.on('error', (err) => {
    // Never surfaced for a background check - a failed check (offline,
    // rate-limited, misconfigured token) should be invisible, not an
    // interruption. A manual check is the one exception.
    setState({ status: 'error', errorMessage: String((err && err.message) || err) })
    log.error('Auto-update check failed', err)
    if (manualCheckPending) {
      manualCheckPending = false
      send('update:error', {
        message: 'Could not check for updates. Check your internet connection and try again later.'
      })
    }
  })

  if (getSettings().autoUpdateEnabled) {
    runCheck()
    startPeriodicChecks()
  }
}

// Settings menu's "Check for updates" button - runs regardless of the
// autoUpdateEnabled setting, since clicking a button asking to check is
// explicit consent by itself, separate from the standing on/off preference.
// Returns { packaged } so the modal can show the right thing in a dev build
// (where no real check ever runs).
export function checkForUpdatesNow() {
  if (!app.isPackaged) return { packaged: false }
  manualCheckPending = true
  setState({ status: 'checking', errorMessage: null })
  runCheck()
  return { packaged: true }
}

// Current known update state, for the modal when it's opened directly from
// Settings after a background check already found (or ruled out) an update -
// so it can render that immediately instead of waiting for a fresh check to
// re-emit.
export function getUpdateState() {
  return { ...updateState, packaged: app.isPackaged }
}

// The renderer's Update modal calls this once on startup - a non-null result
// means an update just installed and it should show the What's-new screen.
// Consume-once: a renderer reload (only really a thing in dev) shouldn't
// pop the screen again.
export function getWhatsNew() {
  const wn = whatsNew
  whatsNew = null
  return wn
}

// On-demand version of the above, for the Settings menu's "What's new"
// button - always returns the current version's changelog entry (never
// consume-once, works in dev too, no previousVersion since this isn't tied
// to an update that just happened). `notes` is null if this version has no
// CHANGELOG.md section yet.
export function getWhatsNewForCurrentVersion() {
  const version = app.getVersion()
  const text = changelogTextBetween(version, version)
  return { version, previousVersion: null, notes: text.length ? text : null }
}

// The modal's "Download & install" button. Safe to call only after an
// update-available; no-ops in a dev build.
export function downloadUpdateNow() {
  if (!app.isPackaged) return { ok: false, reason: 'not-packaged' }
  // "Download & install" pressed during the auto-install countdown - go now,
  // and make sure the pending timer doesn't fire a second downloadUpdate().
  clearAutoInstallCountdown()
  setState({ status: 'downloading', progress: { percent: 0 } })
  autoUpdater.downloadUpdate().catch((err) => log.error('Auto-update download failed', err))
  return { ok: true }
}

// The modal's "Not now" / close-while-an-update-is-offered path - records
// the version so the periodic re-check won't reopen the modal for the same
// one (reset on next app start, or superseded by a newer version).
export function dismissUpdate(version) {
  // "Not now" also cancels a running auto-install countdown - the user opted
  // into automatic updates but still gets to skip this one until next launch.
  clearAutoInstallCountdown()
  if (version) dismissedVersion = version
  setState({ status: 'idle' })
  return { ok: true }
}

// Settings menu's auto-update toggle. Persists regardless of packaged
// state (harmless in dev, and keeps the setting consistent if the same
// userData folder is ever inspected), but only actually starts/stops real
// checks when packaged.
export function setAutoUpdateEnabled(enabled) {
  const settings = persistAutoUpdateEnabled(enabled)
  if (app.isPackaged) {
    if (enabled) {
      runCheck()
      startPeriodicChecks()
    } else {
      stopPeriodicChecks()
      clearAutoInstallCountdown()
    }
  }
  return settings
}

// Restarts the running timer immediately against the new interval, rather
// than waiting for the current interval to elapse once more on the old
// value first - a live change from the Settings field should take effect
// right away, not after one more stale-length wait.
export function setAutoUpdateIntervalSeconds(seconds) {
  const settings = persistAutoUpdateIntervalSeconds(seconds)
  if (app.isPackaged && recheckIntervalId) {
    stopPeriodicChecks()
    startPeriodicChecks()
  }
  return settings
}
