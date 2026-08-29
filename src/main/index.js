import { app, BrowserWindow, shell, protocol, screen, session } from 'electron'
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
import { initThumbar } from './thumbar.js'
import { initSleepTimer } from './sleepTimer.js'
import { initWatchFolders, startWatching, stopWatching } from './watchFolders.js'

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

// Electron blocks getUserMedia (microphone/camera) by default unless the
// main process explicitly grants it - a real, documented gotcha (see
// library.js's addRecordedSound for the feature this exists for). Grants
// only 'media' (what an audio-only getUserMedia call actually requests),
// unconditionally: this is trusted first-party renderer code, not arbitrary
// web content, matching the same trust reasoning already applied to
// autoplayPolicy above. Registered on defaultSession before the window
// loads, so it's in place before the renderer could ever call
// getUserMedia. Doesn't (and can't) bypass the OS's own privacy toggle -
// if Windows itself has microphone access disabled, getUserMedia still
// rejects; nothing to grant in-app for that case beyond a clear error
// message where the recording is actually started.
function grantMicrophonePermission() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media')
}

const WINDOW_WIDTH = 480
const WINDOW_HEIGHT = 720

// Dev-only: opens directly on the highest-numbered connected display instead
// of the default (primary, centered) position - the user keeps working
// there (gaming, etc.) while a dev/test session runs, and doesn't want a
// window popping up in the middle of whatever's already on screen there.
// Only applies under `npm run dev` (never a packaged build, where the OS's
// own last-position memory or default centering is exactly what a real user
// expects) and only when more than one display is actually connected - see
// feedback_window_display_placement memory for the full rationale. Computed
// BEFORE window creation (passed as x/y to the BrowserWindow constructor)
// rather than moved after the fact via a separate script, which was the
// prior approach - an after-the-fact move still means the window visibly
// appears on the primary display for a moment first, exactly the
// interruption this exists to avoid, reported directly by the user.
function devWindowPosition() {
  if (app.isPackaged) return {}
  const displays = screen.getAllDisplays()
  if (displays.length < 2) return {}
  const target = displays.reduce((best, d) => (d.bounds.x > best.bounds.x ? d : best))
  return {
    x: Math.round(target.bounds.x + (target.bounds.width - WINDOW_WIDTH) / 2),
    y: Math.round(target.bounds.y + (target.bounds.height - WINDOW_HEIGHT) / 2)
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    ...devWindowPosition(),
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
      nodeIntegration: false,
      // Lets the Mixer resume playback on launch (see resume-on-open in
      // tabs/mixer/index.js) without Chromium's usual "AudioContext.resume()
      // needs a prior user gesture" autoplay restriction blocking it - this
      // is a trusted first-party app the user explicitly asked to auto-
      // resume, not arbitrary embedded web content.
      autoplayPolicy: 'no-user-gesture-required'
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
  grantMicrophonePermission()
  registerIpcHandlers()
  const win = createWindow()
  initAutoUpdate(win)
  initTray(win)
  initThumbar(win)
  initSleepTimer(win)
  setTrayEnabled(getSettings().minimizeToTrayEnabled)
  initWatchFolders(win)
  startWatching()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopWatching)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
