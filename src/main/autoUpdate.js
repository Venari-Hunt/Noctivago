import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import { getSettings, setAutoUpdateEnabled as persistAutoUpdateEnabled } from './settings.js'

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
// indefinitely without ever learning a new one shipped. Re-checking every
// few hours closes that gap without being excessive.
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let recheckIntervalId = null

// Tracks the version the user already clicked "Not now" on, so the
// periodic re-check doesn't nag them with the same prompt every few hours -
// only a genuinely newer version (or the next app restart, which resets
// this) prompts again.
let dismissedVersion = null

// Set right before a check triggered by the Settings menu's "Check for
// updates now" button, so the update-not-available/error handlers know to
// surface a result via dialog. The periodic background check deliberately
// stays silent in both of those cases (a failed/empty background check
// should be invisible, not an interruption) - but a check the user
// explicitly asked for should never look like nothing happened.
let manualCheckPending = false

function runCheck() {
  log.info(`Auto-update: checking (current version ${app.getVersion()}, token present: ${Boolean(__UPDATE_TOKEN__)})`)
  autoUpdater.checkForUpdates().catch((err) => log.error('Auto-update check failed', err))
}

function startPeriodicChecks() {
  if (recheckIntervalId) return
  recheckIntervalId = setInterval(runCheck, RECHECK_INTERVAL_MS)
}

function stopPeriodicChecks() {
  if (!recheckIntervalId) return
  clearInterval(recheckIntervalId)
  recheckIntervalId = null
}

export function initAutoUpdate() {
  // electron-updater only makes sense for an installed, packaged app - it
  // has no meaningful feed to check against a dev build, and would just
  // error on every `npm run dev` startup otherwise.
  if (!app.isPackaged) return

  autoUpdater.on('update-available', async (info) => {
    if (info.version === dismissedVersion) return
    manualCheckPending = false
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `Noctívago ${info.version} is available (you have ${app.getVersion()}).`,
      detail: 'Download it now? It will install automatically and restart the app once the download finishes.'
    })
    if (response === 0) {
      autoUpdater.downloadUpdate()
    } else {
      dismissedVersion = info.version
    }
  })

  // No second confirmation here on purpose - the one Download? prompt above
  // is the only consent needed; once that's given, install-and-restart just
  // happens. quitAndInstall()'s two args matter: isSilent=true skips the
  // NSIS installer's own wizard window (its default is false, which is why
  // v0.1.4's install still showed a visible installer despite this comment
  // already claiming "installs automatically") and isForceRunAfter=true
  // relaunches the app once the silent install finishes, matching what a
  // visible install would have done after the user clicked through it.
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Auto-update: ${info.version} downloaded, installing and restarting now`)
    autoUpdater.quitAndInstall(true, true)
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info(`Auto-update: no update available (latest published is ${info.version})`)
    if (manualCheckPending) {
      manualCheckPending = false
      dialog.showMessageBox({
        type: 'info',
        title: 'No update available',
        message: `You're already on the latest version (${app.getVersion()}).`
      })
    }
  })

  autoUpdater.on('error', (err) => {
    // Never surfaced to the user for a background check - a failed check
    // (offline, rate-limited, misconfigured token) should be invisible, not
    // an interruption. A manual check is the one exception (see
    // manualCheckPending above).
    log.error('Auto-update check failed', err)
    if (manualCheckPending) {
      manualCheckPending = false
      dialog.showMessageBox({
        type: 'error',
        title: 'Update check failed',
        message: 'Could not check for updates. Check your internet connection and try again later.'
      })
    }
  })

  if (getSettings().autoUpdateEnabled) {
    runCheck()
    startPeriodicChecks()
  }
}

// Settings menu's "Check for updates now" - runs regardless of the
// autoUpdateEnabled setting, since clicking a button asking to check is
// explicit consent by itself, separate from the standing on/off preference.
export function checkForUpdatesNow() {
  if (!app.isPackaged) return
  manualCheckPending = true
  runCheck()
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
    }
  }
  return settings
}
