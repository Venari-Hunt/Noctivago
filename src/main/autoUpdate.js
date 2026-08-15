import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

// __UPDATE_TOKEN__ is a build-time constant (see electron.vite.config.js) -
// empty outside the CI release build. electron-updater's GitHub provider
// reads GH_TOKEN from the environment to authenticate against this private
// repo; there's no config field for it, so it has to be set this way before
// the first check.
if (__UPDATE_TOKEN__) process.env.GH_TOKEN = __UPDATE_TOKEN__

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

  autoUpdater.on('error', (err) => {
    // Never surfaced to the user - a failed check (offline, rate-limited,
    // misconfigured token) should be invisible, not an interruption.
    console.error('Auto-update check failed', err)
  })

  autoUpdater.checkForUpdates().catch((err) => console.error('Auto-update check failed', err))
}
