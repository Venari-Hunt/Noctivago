import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'

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

export function initAutoUpdate() {
  // electron-updater only makes sense for an installed, packaged app - it
  // has no meaningful feed to check against a dev build, and would just
  // error on every `npm run dev` startup otherwise.
  if (!app.isPackaged) return

  // Tracks the version the user already clicked "Not now" on, so the
  // periodic re-check doesn't nag them with the same prompt every few
  // hours - only a genuinely newer version (or the next app restart, which
  // resets this) prompts again.
  let dismissedVersion = null

  autoUpdater.on('update-available', async (info) => {
    if (info.version === dismissedVersion) return
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
  })

  autoUpdater.on('error', (err) => {
    // Never surfaced to the user - a failed check (offline, rate-limited,
    // misconfigured token) should be invisible, not an interruption.
    log.error('Auto-update check failed', err)
  })

  const runCheck = () => {
    log.info(`Auto-update: checking (current version ${app.getVersion()}, token present: ${Boolean(__UPDATE_TOKEN__)})`)
    autoUpdater.checkForUpdates().catch((err) => log.error('Auto-update check failed', err))
  }

  runCheck()
  setInterval(runCheck, RECHECK_INTERVAL_MS)
}
