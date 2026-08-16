import { app, BrowserWindow, shell, protocol } from 'electron'
import './devMode.js' // must stay the first local import - see devMode.js
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import log from 'electron-log/main'
import { registerIpcHandlers } from './ipc.js'
import { getPlaybackPathForId, getLoopClipPathForId } from './library.js'
import { registerPluginProtocol } from './plugins/protocol.js'
import { initAutoUpdate } from './autoUpdate.js'
import { getSettings } from './settings.js'
import { initTray, setTrayEnabled, isAppQuitting } from './tray.js'

log.initialize()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Same dev/packaged path split as tray.js's ICON_PATH - electron-builder
// embeds this into the .exe for the installer/taskbar automatically, but an
// explicit icon here is what makes the *dev-mode* window/taskbar show the
// app's own icon instead of the bare Electron default.
const APP_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, '../../resources/icon.ico')

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus'
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sound',
    privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true }
  },
  {
    scheme: 'plugin',
    privileges: { standard: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true }
  }
])

function registerSoundProtocol() {
  protocol.handle('sound', async (request) => {
    const url = new URL(request.url)
    const id = url.hostname
    const variant = url.searchParams.get('variant')
    const filePath = variant === 'clip' ? getLoopClipPathForId(id) : getPlaybackPathForId(id)
    if (!filePath) return new Response('Not found', { status: 404 })

    const stat = await fs.promises.stat(filePath)
    const fileSize = stat.size
    const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'

    let start = 0
    let end = fileSize - 1
    let status = 200
    const headers = new Headers({
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    })

    const range = request.headers.get('range')
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match && (match[1] || match[2])) {
        if (match[1]) start = parseInt(match[1], 10)
        if (match[2]) end = parseInt(match[2], 10)
        end = Math.min(end, fileSize - 1)
        status = 206
        headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      }
    }

    headers.set('Content-Length', String(end - start + 1))

    if (request.method === 'HEAD') {
      return new Response(null, { status, headers })
    }

    const nodeStream = fs.createReadStream(filePath, { start, end })
    // Readable.toWeb propagates a source stream error into the resulting
    // ReadableStream (erroring it, which surfaces as a network/media error
    // to the <audio> element consuming it) - but without this listener too,
    // an unhandled 'error' event on a Node stream is a much noisier failure
    // mode, and we'd have zero visibility into transient I/O errors on long
    // streaming sessions. Logged, not thrown - toWeb already handles the
    // actual propagation.
    nodeStream.on('error', (err) => {
      log.error(`sound:// stream error for ${id} (${filePath}, bytes ${start}-${end})`, err)
    })
    return new Response(Readable.toWeb(nodeStream), { status, headers })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 520,
    // Visually distinct from an installed build at a glance - the window
    // title bar is the one thing always visible regardless of what's on
    // screen, and it was too easy to lose track of which instance (a dev
    // session vs. the real installed app) was actually being looked at.
    title: app.isPackaged ? 'Noctívago' : 'Noctívago (Dev)',
    icon: APP_ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Only intercepts the close when the user has opted into "keep playing in
  // the background" via Settings - otherwise this is a no-op and the window
  // closes/quits exactly like before this feature existed. isAppQuitting()
  // distinguishes a real quit (tray's Quit item, app.quit() from anywhere)
  // from just clicking the window's X button, so there's still a real way
  // to fully exit while the setting is on.
  win.on('close', (event) => {
    if (!isAppQuitting() && getSettings().minimizeToTrayEnabled) {
      event.preventDefault()
      win.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerSoundProtocol()
  registerPluginProtocol()
  registerIpcHandlers()
  const win = createWindow()
  initAutoUpdate()
  initTray(win)
  setTrayEnabled(getSettings().minimizeToTrayEnabled)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
