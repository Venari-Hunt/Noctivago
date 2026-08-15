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

// Never silent: downloads and installs only happen after the user says yes,
// at each step, matching what was asked for (a prompt, not a background
// auto-install).
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

export function initAutoUpdate() {
  // electron-updater only makes sense for an installed, packaged app - it
  // has no meaningful feed to check against a dev build, and would just
  // error on every `npm run dev` startup otherwise.
  if (!app.isPackaged) return

  log.info(`Auto-update: checking (current version ${app.getVersion()}, token present: ${Boolean(__UPDATE_TOKEN__)})`)

  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `Noctívago ${info.version} is available (you have ${app.getVersion()}).`,
      detail: 'Download it now? It will install the next time you restart the app.'
    })
    if (response === 0) autoUpdater.downloadUpdate()
  })

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Noctívago ${info.version} has been downloaded.`,
      detail: 'Restart now to install it?'
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info(`Auto-update: no update available (latest published is ${info.version})`)
  })

  autoUpdater.on('error', (err) => {
    // Never surfaced to the user - a failed check (offline, rate-limited,
    // misconfigured token) should be invisible, not an interruption.
    log.error('Auto-update check failed', err)
  })

  autoUpdater.checkForUpdates().catch((err) => log.error('Auto-update check failed', err))
}
