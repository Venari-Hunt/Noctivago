import { app, BrowserWindow, shell, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers } from './ipc.js'
import { getPlaybackPathForId, getLoopClipPathForId } from './library.js'
import { registerPluginProtocol } from './plugins/protocol.js'
import { initAutoUpdate } from './autoUpdate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4'
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
    return new Response(Readable.toWeb(nodeStream), { status, headers })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 520,
    title: 'Noctívago',
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

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerSoundProtocol()
  registerPluginProtocol()
  registerIpcHandlers()
  createWindow()
  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
