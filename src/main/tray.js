import { Tray, Menu, app, nativeImage } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// electron-builder's `directories.buildResources` (here "resources") only
// feeds build-time assets like the installer icon - it does NOT get copied
// into the shipped app for runtime use on its own, so the tray icon is
// listed explicitly under electron-builder.yml's extraResources and read
// from process.resourcesPath in a packaged build. In dev, __dirname is
// out/main (the build output), so ../../resources resolves back to the
// repo's own resources/ folder.
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'tray-icon.png')
  : path.join(__dirname, '../../resources/tray-icon.png')

let tray = null
let mainWindow = null
let isQuitting = false

// 'before-quit' fires for every real quit path (app.quit(), the tray's own
// Quit item, OS shutdown) before any window's 'close' handler runs - this
// is what lets index.js's close-to-tray intercept tell a real quit apart
// from the user just clicking the window's X button.
app.on('before-quit', () => {
  isQuitting = true
  destroyTray()
})

export function isAppQuitting() {
  return isQuitting
}

function showWindow() {
  mainWindow.show()
  mainWindow.focus()
}

export function initTray(win) {
  mainWindow = win
}

export function setTrayEnabled(enabled) {
  if (enabled && !tray && mainWindow) {
    tray = new Tray(nativeImage.createFromPath(ICON_PATH))
    tray.setToolTip('Noctívago')
    tray.on('click', showWindow)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Noctívago', click: showWindow },
        { label: 'Play / Pause', click: () => mainWindow.webContents.send('tray:togglePlayPause') },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
  } else if (!enabled && tray) {
    tray.destroy()
    tray = null
  }
}

export function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
