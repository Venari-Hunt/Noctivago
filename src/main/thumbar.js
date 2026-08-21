import { app, nativeImage } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Same dev/packaged path split as tray.js's ICON_PATH - see there for why.
function iconPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, `thumbar-${name}.png`)
    : path.join(__dirname, `../../resources/thumbar-${name}.png`)
}

let mainWindow = null

export function initThumbar(win) {
  mainWindow = win
  setThumbarPlaying(false)
}

// Called whenever the renderer's own play/pause state changes (see
// persistPlayingState in tabs/mixer/index.js, the same hook point that
// already persists wasPlayingOnClose for resume-on-launch) - the button's
// icon/tooltip reflect current state, and clicking it asks the renderer to
// toggle, reusing the exact 'tray:togglePlayPause' channel the system tray's
// own Play/Pause menu item already sends.
export function setThumbarPlaying(playing) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setThumbarButtons([
    {
      tooltip: playing ? 'Pause' : 'Play',
      icon: nativeImage.createFromPath(iconPath(playing ? 'pause' : 'play')),
      click: () => mainWindow.webContents.send('tray:togglePlayPause'),
      flags: []
    }
  ])
}
